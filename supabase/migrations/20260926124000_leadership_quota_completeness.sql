-- Correct leadership quota completeness without inventing missing data.
--
-- 1. A manually confirmed source is authoritative even when a legacy instructor
--    category cannot be classified automatically.
-- 2. Hourly/contract staff for whom quota_applicability() is FALSE remain in the
--    faculty directory but are not reported as incomplete quota records.
-- 3. The existing leadership implementation is retained as a private base
--    function; the public wrapper only adjusts the completeness count.

CREATE OR REPLACE VIEW faculty_private.home_profiles AS
WITH members AS (
  SELECT l.identity_id, i.*, t.code AS type_code
  FROM public.faculty_identity_links l
  JOIN public.instructors i ON i.id = l.instructor_id
  LEFT JOIN public.instructor_types t ON t.id = i.instructor_type_id
), homes AS (
  SELECT identity_id,
    CASE
      WHEN count(DISTINCT affiliation_college_id) = 1
       AND bool_and(affiliation_college_id IS NOT NULL)
       AND NOT bool_or(
         coalesce(type_code, '') = 'from_other_college'
         AND affiliation_college_id = college_id
       )
      THEN min(affiliation_college_id::text)::uuid
    END AS home_id
  FROM members
  GROUP BY identity_id
), resolved AS (
  SELECT h.identity_id,
    coalesce(d.home_college_id, h.home_id) AS home_college_id,
    d.source_instructor_id AS approved_source,
    d.quota_confirmed,
    d.updated_at AS decision_at
  FROM homes h
  LEFT JOIN public.faculty_home_decisions d USING (identity_id)
)
SELECT
  r.identity_id,
  f.university_id,
  f.university_number,
  r.home_college_id,
  c.name AS home_college_name,
  s.id AS source_instructor_id,
  coalesce(s.full_name_ar, s.full_name) AS full_name,
  s.academic_rank,
  s.employment_type,
  s.is_active,
  s.type_code,
  s.specialization,
  s.max_weekly_hours AS recorded_quota,
  s.administrative_release_hours AS recorded_release,
  CASE
    WHEN r.home_college_id IS NOT NULL
     AND s.max_weekly_hours IS NOT NULL
     AND (
       (r.approved_source IS NOT NULL AND r.quota_confirmed)
       OR (
         faculty_private.quota_applicability(s.type_code, s.employment_type) IS TRUE
         AND r.approved_source IS NULL
         AND s.college_id = r.home_college_id
         AND NOT EXISTS (
           SELECT 1
           FROM members m
           WHERE m.identity_id = r.identity_id
             AND m.college_id = r.home_college_id
             AND (
               m.max_weekly_hours IS DISTINCT FROM s.max_weekly_hours
               OR m.administrative_release_hours IS DISTINCT FROM s.administrative_release_hours
             )
         )
       )
     )
    THEN public.effective_instructor_weekly_quota(
      s.max_weekly_hours,
      s.administrative_release_hours
    )
  END AS quota,
  CASE
    WHEN r.home_college_id IS NULL THEN 'pending'
    WHEN r.approved_source IS NOT NULL THEN 'verified'
    ELSE 'declared'
  END AS affiliation_status,
  r.decision_at
FROM resolved r
JOIN public.faculty_identities f ON f.id = r.identity_id
LEFT JOIN public.colleges c ON c.id = r.home_college_id
LEFT JOIN LATERAL (
  SELECT m.*
  FROM members m
  WHERE m.identity_id = r.identity_id
  ORDER BY
    (m.id = r.approved_source) DESC NULLS LAST,
    (m.college_id = r.home_college_id) DESC NULLS LAST,
    m.is_active DESC,
    m.created_at,
    m.id
  LIMIT 1
) s ON true;

COMMENT ON VIEW faculty_private.home_profiles IS
  'Canonical faculty home profile. A confirmed source is authoritative; automatic quota inference remains fail-closed.';

DO $migration$
BEGIN
  IF to_regprocedure('public.leadership_overview_base(text,text)') IS NULL THEN
    IF to_regprocedure('public.leadership_overview(text,text)') IS NULL THEN
      RAISE EXCEPTION 'leadership_overview(text,text) is required';
    END IF;

    ALTER FUNCTION public.leadership_overview(text,text)
      RENAME TO leadership_overview_base;
  END IF;
END
$migration$;

REVOKE ALL ON FUNCTION public.leadership_overview_base(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leadership_overview_base(text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.leadership_overview(
  p_academic_year text DEFAULT NULL,
  p_term_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_result jsonb;
  v_colleges jsonb;
BEGIN
  v_result := public.leadership_overview_base(
    p_academic_year,
    p_term_type
  );

  SELECT coalesce(
    jsonb_agg(
      CASE
        WHEN college.value->>'incomplete_faculty' IS NULL THEN college.value
        ELSE jsonb_set(
          college.value,
          '{incomplete_faculty}',
          to_jsonb(
            greatest(
              0,
              (college.value->>'incomplete_faculty')::integer
              - coalesce(excluded.non_applicable_count, 0)
            )
          ),
          false
        )
      END
      ORDER BY college.ordinality
    ),
    '[]'::jsonb
  )
  INTO v_colleges
  FROM jsonb_array_elements(
    coalesce(v_result->'colleges', '[]'::jsonb)
  ) WITH ORDINALITY AS college(value, ordinality)
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS non_applicable_count
    FROM faculty_private.home_profiles h
    WHERE h.home_college_id = (college.value->>'college_id')::uuid
      AND h.is_active
      AND faculty_private.quota_applicability(
        h.type_code,
        h.employment_type
      ) IS FALSE
  ) excluded ON true;

  RETURN jsonb_set(v_result, '{colleges}', v_colleges, false);
END
$function$;

COMMENT ON FUNCTION public.leadership_overview(text,text) IS
  'Leadership overview with non-applicable hourly/contract staff excluded from incomplete quota counts.';

REVOKE ALL ON FUNCTION public.leadership_overview(text,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leadership_overview(text,text)
  TO authenticated, service_role;

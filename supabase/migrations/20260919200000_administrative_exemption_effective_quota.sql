-- Administrative-exemption quota semantics and instructor schedule report consistency.
-- Business rule: max_weekly_hours is the base quota. When administrative_release_hours > 0,
-- that value is the approved teaching quota after administrative exemption (not hours to subtract).
-- Example: base 12 + administrative value 3 => effective quota 3.

CREATE OR REPLACE FUNCTION public.effective_instructor_weekly_quota(
  p_base integer,
  p_admin_quota integer
) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_base IS NULL THEN NULL
    WHEN coalesce(p_admin_quota, 0) > 0
      THEN greatest(0, least(p_base, p_admin_quota))
    ELSE greatest(0, p_base)
  END
$$;

CREATE OR REPLACE VIEW faculty_private.home_profiles AS
WITH members AS (
 SELECT l.identity_id,i.*,t.code AS type_code
 FROM public.faculty_identity_links l JOIN public.instructors i ON i.id=l.instructor_id
 LEFT JOIN public.instructor_types t ON t.id=i.instructor_type_id
), homes AS (
 SELECT identity_id,
   CASE WHEN count(DISTINCT affiliation_college_id)=1
     AND bool_and(affiliation_college_id IS NOT NULL)
     AND NOT bool_or(coalesce(type_code,'')='from_other_college' AND affiliation_college_id=college_id)
   THEN min(affiliation_college_id::text)::uuid END AS home_id
 FROM members GROUP BY identity_id
), resolved AS (
 SELECT h.identity_id,coalesce(d.home_college_id,h.home_id) AS home_college_id,
 d.source_instructor_id AS approved_source,d.quota_confirmed,d.updated_at AS decision_at
 FROM homes h LEFT JOIN public.faculty_home_decisions d USING(identity_id)
)
SELECT r.identity_id,f.university_id,f.university_number,r.home_college_id,
 c.name AS home_college_name,s.id AS source_instructor_id,
 coalesce(s.full_name_ar,s.full_name) AS full_name,s.academic_rank,s.employment_type,s.is_active,
 s.type_code,s.specialization,s.max_weekly_hours AS recorded_quota,
 s.administrative_release_hours AS recorded_release,
 CASE WHEN r.home_college_id IS NOT NULL AND (
   (r.approved_source IS NOT NULL AND r.quota_confirmed) OR
   (r.approved_source IS NULL AND s.college_id=r.home_college_id AND NOT EXISTS(
      SELECT 1 FROM members m WHERE m.identity_id=r.identity_id AND m.college_id=r.home_college_id
       AND (m.max_weekly_hours IS DISTINCT FROM s.max_weekly_hours
         OR m.administrative_release_hours IS DISTINCT FROM s.administrative_release_hours))))
   AND s.max_weekly_hours IS NOT NULL
 THEN public.effective_instructor_weekly_quota(s.max_weekly_hours, s.administrative_release_hours) END AS quota,
 CASE WHEN r.home_college_id IS NULL THEN 'pending' WHEN r.approved_source IS NOT NULL THEN 'verified' ELSE 'declared' END AS affiliation_status,
 r.decision_at
FROM resolved r JOIN public.faculty_identities f ON f.id=r.identity_id
LEFT JOIN public.colleges c ON c.id=r.home_college_id
LEFT JOIN LATERAL (
 SELECT m.* FROM members m WHERE m.identity_id=r.identity_id
 ORDER BY (m.id=r.approved_source) DESC NULLS LAST,
   (m.college_id=r.home_college_id) DESC NULLS LAST,m.is_active DESC,m.created_at,m.id LIMIT 1
) s ON true;

COMMENT ON VIEW faculty_private.home_profiles IS
  'Canonical faculty home profile. quota uses administrative_release_hours as the effective teaching quota when > 0.';

CREATE OR REPLACE FUNCTION public.get_college_instructor_schedule_directory(p_college_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '' AS $$
DECLARE v_university uuid; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_college_id IS NULL
  OR NOT public.can_view_college(auth.uid(), p_college_id) THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
 END IF;
 SELECT university_id INTO v_university FROM public.colleges
 WHERE id = p_college_id AND name !~* 'TEST_ONLY';
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;

 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id', h.source_instructor_id, 'identity_id', h.identity_id,
  'record_ids', aliases.ids, 'university_number', h.university_number,
  'full_name', h.full_name, 'college_id', i.college_id,
  'home_college_id', h.home_college_id, 'home_college_name', h.home_college_name,
  'instructor_type_code', h.type_code, 'employment_type', h.employment_type,
  'recorded_quota', h.recorded_quota, 'recorded_release', h.recorded_release,
  'authoritative_quota', h.quota
 ) ORDER BY h.full_name, h.identity_id), '[]'::jsonb) INTO v_result
 FROM faculty_private.home_profiles h
 JOIN public.instructors i ON i.id = h.source_instructor_id
 CROSS JOIN LATERAL (
  SELECT array_agg(l.instructor_id ORDER BY l.instructor_id) AS ids
  FROM public.faculty_identity_links l WHERE l.identity_id = h.identity_id
 ) aliases
 WHERE h.university_id = v_university AND h.full_name !~* 'TEST_ONLY'
  AND (
   (h.home_college_id = p_college_id AND h.is_active)
   OR EXISTS (
    SELECT 1 FROM public.teaching_assignments a
    JOIN public.course_offerings o ON o.id = a.course_offering_id
    LEFT JOIN public.delivery_groups g ON g.id = a.delivery_group_id
    WHERE a.college_id = p_college_id AND o.college_id = p_college_id
     AND a.instructor_id = ANY(aliases.ids) AND a.is_active AND o.is_active
     AND (a.delivery_group_id IS NULL OR (g.active AND NOT coalesce(g.is_obsolete, false)))
   )
   OR EXISTS (
    SELECT 1 FROM public.schedule_sessions s
    JOIN public.schedule_versions v ON v.id = s.schedule_version_id
    WHERE s.college_id = p_college_id AND v.college_id = p_college_id
     AND v.status IN ('draft','review','approved','published')
     AND NOT coalesce(v.disposable_test, false) AND v.name !~* 'TEST_ONLY'
     AND NOT coalesce(s.replaced_by_split, false)
     AND (
      s.instructor_id = ANY(aliases.ids)
      OR EXISTS (
       SELECT 1 FROM public.existing_schedule_source_rows src
       WHERE src.college_id = p_college_id AND src.schedule_session_id = s.id
        AND src.instructor_ids && aliases.ids
      )
     )
   )
  );
 RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_college_instructor_schedule_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_college_instructor_schedule_directory(uuid) TO authenticated;

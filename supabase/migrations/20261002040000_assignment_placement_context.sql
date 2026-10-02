-- Read-only placement context for the teaching-assignment page. A shared
-- member inherits its anchor's days in this version; a group outside a frozen
-- catalogue must not be presented as missing from that version.
CREATE OR REPLACE FUNCTION public.schedule_version_assignment_placement_context(p_version uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO pg_catalog, public, schedule_version_delivery_private
AS $function$
DECLARE
  v_college uuid;
  v_term uuid;
  v_groups jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501';
  END IF;
  SELECT v.college_id,v.academic_term_id INTO v_college,v_term
  FROM public.schedule_versions v WHERE v.id=p_version;
  IF v_college IS NULL OR NOT public.can_view_college(auth.uid(),v_college) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501';
  END IF;

  WITH cohorts AS MATERIALIZED (
    SELECT c.id,row_number() OVER(ORDER BY c.id) AS n
    FROM public.academic_cohorts c
    WHERE c.college_id=v_college AND c.term_id=v_term
  ), batches AS (
    SELECT array_agg(id ORDER BY id) AS ids FROM cohorts GROUP BY (n-1)/100
  ), catalogue AS MATERIALIZED (
    SELECT DISTINCT f.id FROM batches b
    CROSS JOIN LATERAL public.schedule_version_delivery_group_catalog(p_version,b.ids) f
  ), groups AS MATERIALIZED (
    SELECT g.id,g.cohort_id FROM public.delivery_groups g
    JOIN cohorts c ON c.id=g.cohort_id WHERE g.college_id=v_college
  ), links AS MATERIALIZED (
    SELECT l.anchor_group_id,l.member_group_id
    FROM schedule_version_delivery_private.shared_link_facts l
    WHERE l.version_id=p_version AND l.college_id=v_college
    UNION
    -- Same version/operational fallback as schedule_version_student_memberships.
    SELECT l.anchor_group_id,l.member_group_id
    FROM public.shared_lecture_links l JOIN groups g ON g.id=l.anchor_group_id
    WHERE NOT EXISTS (
      SELECT 1 FROM schedule_version_delivery_private.scope sc
      WHERE sc.version_id=p_version AND sc.cohort_id=g.cohort_id
    ) AND NOT EXISTS (
      SELECT 1 FROM schedule_version_delivery_private.partner_group_facts pf
      WHERE pf.version_id=p_version AND pf.group_id=g.id
    )
  ), sessions AS MATERIALIZED (
    SELECT s.delivery_group_id,s.day_of_week
    FROM public.schedule_sessions s
    JOIN public.teaching_assignments a ON a.id=s.teaching_assignment_id AND a.is_active
    WHERE s.schedule_version_id=p_version AND s.college_id=v_college
      AND NOT coalesce(s.replaced_by_split,false)
      AND s.delivery_group_id IS NOT NULL
  ), days AS (
    SELECT s.delivery_group_id AS group_id,s.day_of_week FROM sessions s
    UNION
    SELECT l.member_group_id,s.day_of_week FROM links l
    JOIN sessions s ON s.delivery_group_id=l.anchor_group_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'group_id',g.id,
    'in_version',EXISTS(SELECT 1 FROM catalogue c WHERE c.id=g.id)
      OR EXISTS(SELECT 1 FROM links l WHERE l.member_group_id=g.id)
      OR EXISTS(SELECT 1 FROM sessions s WHERE s.delivery_group_id=g.id),
    'shared_lecture',EXISTS(SELECT 1 FROM links l WHERE l.member_group_id=g.id),
    'days',coalesce((SELECT jsonb_agg(d.day_of_week ORDER BY
      CASE WHEN d.day_of_week=6 THEN 0 ELSE d.day_of_week+1 END)
      FROM days d WHERE d.group_id=g.id),'[]'::jsonb)
  ) ORDER BY g.id),'[]'::jsonb) INTO v_groups FROM groups g;
  RETURN jsonb_build_object('version_id',p_version,'groups',v_groups);
END;
$function$;
REVOKE ALL ON FUNCTION public.schedule_version_assignment_placement_context(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.schedule_version_assignment_placement_context(uuid) TO authenticated;

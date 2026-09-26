-- Semester-only review/publish exception for 46 source-backed groups.
-- Preserve unassigned counts, ordinary conflict and hour gates, and all payroll controls.
BEGIN;
DO $guard$
DECLARE v public.schedule_versions%ROWTYPE; v_quality record; v_definition_hash text;
BEGIN
  SELECT * INTO v FROM public.schedule_versions WHERE id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
    AND college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    AND academic_term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  v_definition_hash:=md5(pg_get_functiondef('public.schedule_version_delivery_coverage(uuid,uuid)'::regprocedure));
  -- A later deployment may replay this migration after the version is published.
  IF v_definition_hash='eb0853ac0b3907df859279b986113c9a' THEN RETURN; END IF;
  IF v.status<>'draft' THEN RAISE EXCEPTION 'EDU26F_PUBLICATION_STATUS_DRIFT'; END IF;
  IF v_definition_hash<>'945b74c071af564c715625eebed240ac'
  THEN RAISE EXCEPTION 'EDU26F_PUBLICATION_COVERAGE_DRIFT'; END IF;
  IF (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id=v.id)<>339
     OR (SELECT count(*) FROM public.existing_schedule_source_rows
         WHERE schedule_version_id=v.id AND schedule_session_id IS NOT NULL)<>309
  THEN RAISE EXCEPTION 'EDU26F_PUBLICATION_SOURCE_DRIFT'; END IF;
  SELECT hard_conflicts_count,eligibility_revision INTO v_quality
    FROM public.schedule_quality_runs WHERE schedule_version_id=v.id
    ORDER BY created_at DESC,id DESC LIMIT 1;
  IF v_quality.hard_conflicts_count IS DISTINCT FROM 0
     OR v_quality.eligibility_revision IS DISTINCT FROM v.eligibility_revision
  THEN RAISE EXCEPTION 'EDU26F_PUBLICATION_QUALITY_DRIFT'; END IF;
END;
$guard$;
DO $install$
BEGIN
 IF EXISTS (SELECT 1 FROM public.schedule_versions WHERE id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
    AND college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid)
    AND md5(pg_get_functiondef('public.schedule_version_delivery_coverage(uuid,uuid)'::regprocedure))
      ='945b74c071af564c715625eebed240ac' THEN
  EXECUTE $ddl$
CREATE OR REPLACE FUNCTION public.schedule_version_delivery_coverage(p_college_id uuid, p_schedule_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_term_id uuid;
  v_result jsonb;
  v_scoped_exception boolean := false;
BEGIN
  SELECT academic_term_id INTO v_term_id
  FROM public.schedule_versions
  WHERE id = p_schedule_version_id AND college_id = p_college_id;

  IF v_term_id IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE='P0002';
  END IF;

  -- One verified college/version/term. Drift in sessions or source links closes the waiver.
  v_scoped_exception := p_college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    AND p_schedule_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
    AND v_term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid
    AND EXISTS (SELECT 1 FROM public.academic_terms t WHERE t.id=v_term_id
      AND t.academic_year='2026-2027' AND t.term_type='first')
    AND (SELECT count(*) FROM public.schedule_sessions s
      WHERE s.schedule_version_id=p_schedule_version_id)=339
    AND (SELECT count(*) FROM public.existing_schedule_source_rows r
      WHERE r.schedule_version_id=p_schedule_version_id
        AND r.schedule_session_id IS NOT NULL)=309;

  WITH cohort_batches AS (
    SELECT array_agg(id ORDER BY id) AS cohort_ids
    FROM (
      SELECT ac.id, (row_number() OVER (ORDER BY ac.id)-1)/100 AS batch
      FROM public.academic_cohorts ac
      WHERE ac.college_id=p_college_id AND ac.term_id=v_term_id
    ) numbered
    GROUP BY batch
  ), expected AS (
    SELECT DISTINCT dg.id AS delivery_group_id,
           pcc.weekly_contact_hours::numeric AS required_hours
    FROM cohort_batches b
    CROSS JOIN LATERAL public.schedule_version_delivery_group_catalog(
      p_schedule_version_id,b.cohort_ids
    ) dg
    JOIN public.academic_cohorts ac ON ac.id=dg.cohort_id
    JOIN public.plan_course_components pcc ON pcc.id=dg.component_id
    WHERE ac.active=true
      AND dg.active=true
      AND COALESCE(dg.is_obsolete,false)=false
      AND COALESCE(pcc.is_timetabled,true)=true
  ), assignments AS (
    SELECT ta.delivery_group_id,
           count(*) FILTER (WHERE ta.is_active=true)::integer AS active_assignments
    FROM public.teaching_assignments ta
    WHERE ta.college_id = p_college_id
    GROUP BY ta.delivery_group_id
  ), sessions AS (
    SELECT ss.delivery_group_id,
           count(*)::integer AS session_count,
           sum(extract(epoch FROM (ss.end_time-ss.start_time))/3600.0)::numeric AS scheduled_hours
    FROM public.schedule_sessions ss
    WHERE ss.college_id = p_college_id
      AND ss.schedule_version_id = p_schedule_version_id
      AND COALESCE(ss.replaced_by_split,false)=false
      AND ss.delivery_group_id IS NOT NULL
    GROUP BY ss.delivery_group_id
  ), verified_source AS (
    SELECT ss.delivery_group_id, count(*)::integer AS sourced_named_sessions
    FROM public.schedule_sessions ss
    WHERE v_scoped_exception
      AND ss.college_id=p_college_id AND ss.schedule_version_id=p_schedule_version_id
      AND NOT COALESCE(ss.replaced_by_split,false)
      AND ss.delivery_group_id IS NOT NULL
      AND ss.teaching_assignment_id IS NULL
      AND ss.instructor_id IS NOT NULL AND ss.room_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.existing_schedule_source_rows r
        WHERE r.college_id=p_college_id AND r.term_id=v_term_id
          AND r.schedule_version_id=p_schedule_version_id
          AND r.schedule_session_id=ss.id AND r.delivery_group_id=ss.delivery_group_id
          AND r.status='imported' AND ss.instructor_id=ANY(r.instructor_ids))
    GROUP BY ss.delivery_group_id
  ), a AS (
    SELECT e.delivery_group_id,
           e.required_hours,
           COALESCE(x.active_assignments,0) AS active_assignments,
           COALESCE(s.session_count,0) AS session_count,
           COALESCE(s.scheduled_hours,0)::numeric AS scheduled_hours,
           COALESCE(vs.sourced_named_sessions,0) AS sourced_named_sessions
    FROM expected e
    LEFT JOIN assignments x ON x.delivery_group_id=e.delivery_group_id
    LEFT JOIN sessions s ON s.delivery_group_id=e.delivery_group_id
    LEFT JOIN verified_source vs ON vs.delivery_group_id=e.delivery_group_id
  ), totals AS (
    SELECT count(*)::integer AS total_groups,
           count(*) FILTER (WHERE active_assignments=1)::integer AS assigned_exactly_once,
           count(*) FILTER (WHERE active_assignments=0)::integer AS unassigned_groups,
           count(*) FILTER (WHERE active_assignments>1)::integer AS multi_assigned_groups,
           count(*) FILTER (WHERE active_assignments=0 AND session_count>0
             AND sourced_named_sessions=session_count
             AND abs(scheduled_hours-required_hours)<0.001)::integer AS provisional_source_groups,
           count(*) FILTER (WHERE session_count>0)::integer AS groups_with_sessions,
           count(*) FILTER (WHERE session_count=0)::integer AS groups_without_sessions,
           count(*) FILTER (WHERE abs(scheduled_hours-required_hours)<0.001)::integer AS exact_hours_groups,
           count(*) FILTER (WHERE scheduled_hours<required_hours)::integer AS short_hours_groups,
           count(*) FILTER (WHERE scheduled_hours>required_hours)::integer AS over_hours_groups,
           COALESCE(sum(required_hours),0)::numeric AS required_hours,
           COALESCE(sum(scheduled_hours),0)::numeric AS scheduled_hours,
           COALESCE(sum(greatest(required_hours-scheduled_hours,0)),0)::numeric AS missing_hours,
           COALESCE(sum(greatest(scheduled_hours-required_hours,0)),0)::numeric AS extra_hours
    FROM a
  )
  SELECT jsonb_build_object(
    'total_groups', total_groups,
    'assigned_exactly_once', assigned_exactly_once,
    'unassigned_groups', unassigned_groups,
    'multi_assigned_groups', multi_assigned_groups,
    'provisional_source_groups', provisional_source_groups,
    'temporary_assignment_exception', (v_scoped_exception AND total_groups=331
      AND unassigned_groups=46 AND provisional_source_groups=46
      AND required_hours=714 AND scheduled_hours=714
      AND missing_hours=0 AND extra_hours=0),
    'groups_with_sessions', groups_with_sessions,
    'groups_without_sessions', groups_without_sessions,
    'exact_hours_groups', exact_hours_groups,
    'short_hours_groups', short_hours_groups,
    'over_hours_groups', over_hours_groups,
    'required_hours', required_hours,
    'scheduled_hours', scheduled_hours,
    'missing_hours', missing_hours,
    'extra_hours', extra_hours,
    'complete', (total_groups > 0
                 AND (unassigned_groups=0 OR
                   (v_scoped_exception AND total_groups=331
                    AND unassigned_groups=46 AND provisional_source_groups=46
                    AND required_hours=714 AND scheduled_hours=714))
                 AND multi_assigned_groups=0
                 AND short_hours_groups=0
                 AND over_hours_groups=0)
  ) INTO v_result
  FROM totals;

  RETURN v_result;
END;
$function$

$ddl$;
 END IF;
END;
$install$;
COMMIT;

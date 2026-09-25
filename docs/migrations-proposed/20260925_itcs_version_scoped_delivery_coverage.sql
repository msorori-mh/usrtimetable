-- Version-scoped coverage and delivery-gap catalogue.
-- Requires 20260925_itcs_version_scoped_catalog.sql. Preserve the existing
-- function signatures and invoker privileges; batches keep RPC cohorts <=100.
-- Idempotent replacement. Apply in a transaction and verify both versions.
CREATE OR REPLACE FUNCTION public.schedule_version_delivery_coverage(p_college_id uuid, p_schedule_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_term_id uuid;
  v_result jsonb;
BEGIN
  SELECT academic_term_id INTO v_term_id
  FROM public.schedule_versions
  WHERE id = p_schedule_version_id AND college_id = p_college_id;

  IF v_term_id IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE='P0002';
  END IF;

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
  ), a AS (
    SELECT e.delivery_group_id,
           e.required_hours,
           COALESCE(x.active_assignments,0) AS active_assignments,
           COALESCE(s.session_count,0) AS session_count,
           COALESCE(s.scheduled_hours,0)::numeric AS scheduled_hours
    FROM expected e
    LEFT JOIN assignments x ON x.delivery_group_id=e.delivery_group_id
    LEFT JOIN sessions s ON s.delivery_group_id=e.delivery_group_id
  ), totals AS (
    SELECT count(*)::integer AS total_groups,
           count(*) FILTER (WHERE active_assignments=1)::integer AS assigned_exactly_once,
           count(*) FILTER (WHERE active_assignments=0)::integer AS unassigned_groups,
           count(*) FILTER (WHERE active_assignments>1)::integer AS multi_assigned_groups,
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
                 AND unassigned_groups=0
                 AND multi_assigned_groups=0
                 AND short_hours_groups=0
                 AND over_hours_groups=0)
  ) INTO v_result
  FROM totals;

  RETURN v_result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.list_schedule_version_delivery_gaps(p_college_id uuid, p_schedule_version_id uuid)
 RETURNS TABLE(delivery_group_id uuid, cohort_id uuid, cohort_code text, program_id uuid, program_name text, program_code text, study_system text, level_id uuid, level_number integer, level_name text, course_code text, course_name text, component_type text, group_code text, group_number integer, expected_students integer, active_assignment_count integer, instructor_names text, required_hours numeric, scheduled_hours numeric, missing_hours numeric, scheduling_state text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH version_ctx AS (
  SELECT academic_term_id AS term_id
  FROM public.schedule_versions
  WHERE id=p_schedule_version_id AND college_id=p_college_id
), cohort_batches AS (
  SELECT array_agg(id ORDER BY id) AS cohort_ids
  FROM (
    SELECT ac.id,(row_number() OVER (ORDER BY ac.id)-1)/100 AS batch
    FROM public.academic_cohorts ac CROSS JOIN version_ctx v
    WHERE ac.college_id=p_college_id AND ac.term_id=v.term_id
  ) numbered
  GROUP BY batch
), expected AS (
  SELECT DISTINCT dg.id delivery_group_id, ac.id cohort_id, ac.code cohort_code,
         ap.id program_id, ap.name program_name, ap.code program_code,
         ac.study_system, al.id level_id, al.level_number, al.name level_name,
         c.code course_code, c.name course_name,
         pcc.component_type, dg.group_code, dg.group_number, dg.expected_students,
         pcc.weekly_contact_hours::numeric required_hours
  FROM cohort_batches b
  CROSS JOIN LATERAL public.schedule_version_delivery_group_catalog(
    p_schedule_version_id,b.cohort_ids
  ) dg
  JOIN public.academic_cohorts ac ON ac.id=dg.cohort_id
  JOIN public.academic_programs ap ON ap.id=ac.program_id
  JOIN public.academic_levels al ON al.id=ac.level_id
  JOIN public.plan_courses pc ON pc.id=dg.plan_course_id
  JOIN public.courses c ON c.id=pc.course_id
  JOIN public.plan_course_components pcc ON pcc.id=dg.component_id
  WHERE ac.active=true
    AND dg.active=true
    AND COALESCE(dg.is_obsolete,false)=false
    AND COALESCE(pcc.is_timetabled,true)=true
), ta AS (
  SELECT x.delivery_group_id,
         count(*) FILTER(WHERE x.is_active=true)::integer active_assignment_count,
         string_agg(DISTINCT i.full_name,'، ' ORDER BY i.full_name) FILTER(WHERE x.is_active=true) instructor_names
  FROM public.teaching_assignments x
  LEFT JOIN public.instructors i ON i.id=x.instructor_id
  WHERE x.college_id=p_college_id
  GROUP BY x.delivery_group_id
), ss AS (
  SELECT x.delivery_group_id,
         sum(extract(epoch FROM (x.end_time-x.start_time))/3600.0)::numeric scheduled_hours
  FROM public.schedule_sessions x
  WHERE x.college_id=p_college_id
    AND x.schedule_version_id=p_schedule_version_id
    AND COALESCE(x.replaced_by_split,false)=false
    AND x.delivery_group_id IS NOT NULL
  GROUP BY x.delivery_group_id
)
SELECT e.delivery_group_id,e.cohort_id,e.cohort_code,e.program_id,e.program_name,e.program_code,
       e.study_system,e.level_id,e.level_number,e.level_name,e.course_code,e.course_name,
       e.component_type,e.group_code,e.group_number,e.expected_students,
       COALESCE(ta.active_assignment_count,0),ta.instructor_names,e.required_hours,
       COALESCE(ss.scheduled_hours,0)::numeric,
       greatest(e.required_hours-COALESCE(ss.scheduled_hours,0),0)::numeric,
       CASE
         WHEN COALESCE(ta.active_assignment_count,0)=0 THEN 'unassigned'
         WHEN COALESCE(ta.active_assignment_count,0)>1 THEN 'multi_assigned'
         WHEN COALESCE(ss.scheduled_hours,0)=0 THEN 'unscheduled'
         WHEN COALESCE(ss.scheduled_hours,0)<e.required_hours THEN 'short_hours'
         WHEN COALESCE(ss.scheduled_hours,0)>e.required_hours THEN 'over_hours'
         ELSE 'complete'
       END scheduling_state
FROM expected e
LEFT JOIN ta ON ta.delivery_group_id=e.delivery_group_id
LEFT JOIN ss ON ss.delivery_group_id=e.delivery_group_id
WHERE COALESCE(ta.active_assignment_count,0)<>1
   OR abs(COALESCE(ss.scheduled_hours,0)-e.required_hours)>=0.001
ORDER BY e.program_name,e.study_system,e.level_number,e.course_code,e.component_type,e.group_number;
$function$;

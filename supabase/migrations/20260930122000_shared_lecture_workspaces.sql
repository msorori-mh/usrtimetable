BEGIN;
SET LOCAL lock_timeout='5s';
-- Keep assignment and scheduling workspaces aligned with participating cohorts.
CREATE OR REPLACE FUNCTION public.list_teaching_assignment_workspace(
  p_college_id uuid,
  p_program_id uuid DEFAULT NULL,
  p_level_id uuid DEFAULT NULL,
  p_term_id uuid DEFAULT NULL,
  p_study_system text DEFAULT NULL,
  p_cohort_id uuid DEFAULT NULL,
  p_component_type text DEFAULT NULL,
  p_assignment_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_college_id IS NULL THEN
    RAISE EXCEPTION 'COLLEGE_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.can_view_college(v_uid, p_college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  WITH base AS MATERIALIZED (
    SELECT
      dg.id AS delivery_group_id,
      dg.college_id,
      dg.cohort_id,
      ac.code AS base_cohort_code,
      ac.program_id,
      ac.level_id,
      ac.term_id,
      ac.study_system,
      dg.plan_course_id,
      dg.component_id AS plan_course_component_id,
      pcc.component_type,
      pcc.weekly_contact_hours AS component_hours,
      pc.course_id,
      c.code AS course_code,
      c.name AS course_name,
      dg.group_number,
      dg.group_code,
      dg.expected_students,
      dg.capacity_limit,
      COALESCE(dg.is_obsolete, false) AS is_obsolete,
      COALESCE(dg.active, true) AS active,
      COALESCE(dg.excluded_from_standard_workload, false) AS excluded_from_standard_workload,
      EXISTS (
        SELECT 1 FROM public.shared_lecture_links sl
        WHERE sl.anchor_group_id = dg.id
      ) AS has_shared_members
    FROM public.delivery_groups dg
    JOIN public.academic_cohorts ac
      ON ac.id = dg.cohort_id AND ac.college_id = dg.college_id
    JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
    JOIN public.plan_courses pc ON pc.id = dg.plan_course_id
    JOIN public.courses c ON c.id = pc.course_id
    WHERE dg.college_id = p_college_id
      AND pcc.component_type IS DISTINCT FROM 'summer_training'
      AND (
        p_program_id IS NULL OR EXISTS (
          SELECT 1
          FROM public.shared_lecture_group_ids(dg.id) ids
          JOIN public.delivery_groups shared_group ON shared_group.id = ids.group_id
          JOIN public.academic_cohorts shared_cohort ON shared_cohort.id = shared_group.cohort_id
          WHERE shared_cohort.program_id = p_program_id
        )
      )
      AND (
        p_level_id IS NULL OR EXISTS (
          SELECT 1
          FROM public.shared_lecture_group_ids(dg.id) ids
          JOIN public.delivery_groups shared_group ON shared_group.id = ids.group_id
          JOIN public.academic_cohorts shared_cohort ON shared_cohort.id = shared_group.cohort_id
          WHERE shared_cohort.level_id = p_level_id
        )
      )
      AND (p_term_id IS NULL OR ac.term_id = p_term_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.shared_lecture_links sl
        WHERE sl.member_group_id = dg.id
      )
      AND (p_component_type IS NULL OR pcc.component_type = p_component_type)
      AND (
        (p_cohort_id IS NULL AND p_study_system IS NULL)
        OR public.shared_lecture_matches(dg.id, p_cohort_id, p_study_system)
      )
  ), assignment_rollup AS MATERIALIZED (
    SELECT
      ta.delivery_group_id,
      count(*)::integer AS assignment_count,
      sum(COALESCE(ta.assigned_component_hours, 0)) AS raw_assigned_hours,
      max(ta.assigned_component_hours) AS single_assigned_hours,
      jsonb_agg(
        jsonb_build_object(
          'assignment_id', ta.id,
          'instructor_id', ta.instructor_id,
          'instructor_name', i.full_name,
          'employee_number', i.employee_number,
          'assigned_component_hours', ta.assigned_component_hours,
          'is_active', ta.is_active,
          'updated_at', ta.updated_at
        ) ORDER BY i.full_name
      ) AS instructors
    FROM public.teaching_assignments ta
    JOIN base b ON b.delivery_group_id = ta.delivery_group_id
    JOIN public.instructors i ON i.id = ta.instructor_id
    WHERE ta.is_active = true
    GROUP BY ta.delivery_group_id
  ), calculated AS MATERIALIZED (
    SELECT
      b.*,
      COALESCE(a.assignment_count, 0) AS assignment_count,
      CASE
        WHEN COALESCE(a.assignment_count, 0) = 1
          THEN COALESCE(a.single_assigned_hours, b.component_hours, 0)
        ELSE COALESCE(a.raw_assigned_hours, 0)
      END AS assigned_hours_total,
      COALESCE(a.instructors, '[]'::jsonb) AS instructors
    FROM base b
    LEFT JOIN assignment_rollup a ON a.delivery_group_id = b.delivery_group_id
  ), finalized AS MATERIALIZED (
    SELECT
      x.*,
      GREATEST(0, COALESCE(x.component_hours, 0) - COALESCE(x.assigned_hours_total, 0)) AS remaining_hours,
      CASE
        WHEN x.assignment_count = 0 THEN 'unassigned'
        WHEN COALESCE(x.assigned_hours_total, 0) > COALESCE(x.component_hours, 0) THEN 'over_allocated'
        WHEN COALESCE(x.assigned_hours_total, 0) < COALESCE(x.component_hours, 0) THEN 'under_allocated'
        ELSE 'fully_allocated'
      END AS allocation_status
    FROM calculated x
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'delivery_group_id', f.delivery_group_id,
        'college_id', f.college_id,
        'cohort_id', f.cohort_id,
        'cohort_code', (
          SELECT string_agg(shared_cohort.code, ' + ' ORDER BY shared_cohort.code)
          FROM public.shared_lecture_group_ids(f.delivery_group_id) ids
          JOIN public.delivery_groups shared_group ON shared_group.id = ids.group_id
          JOIN public.academic_cohorts shared_cohort ON shared_cohort.id = shared_group.cohort_id
        ),
        'program_id', f.program_id,
        'level_id', f.level_id,
        'term_id', f.term_id,
        'study_system', CASE WHEN f.has_shared_members THEN public.shared_lecture_system(f.delivery_group_id) ELSE f.study_system END,
        'plan_course_id', f.plan_course_id,
        'plan_course_component_id', f.plan_course_component_id,
        'component_type', f.component_type,
        'course_id', f.course_id,
        'course_code', f.course_code,
        'course_name', f.course_name,
        'group_number', f.group_number,
        'group_code', CASE
          WHEN f.has_shared_members THEN f.group_code || ' — مدمج ضمن النظام نفسه'
          ELSE f.group_code
        END,
        'expected_students', CASE
          WHEN f.has_shared_members THEN (
            SELECT sum(d.expected_students)::integer
            FROM public.delivery_groups d
            JOIN public.shared_lecture_group_ids(f.delivery_group_id) m ON m.group_id = d.id
          )
          ELSE f.expected_students
        END,
        'capacity_limit', f.capacity_limit,
        'is_obsolete', f.is_obsolete,
        'active', f.active,
        'excluded_from_standard_workload', f.excluded_from_standard_workload,
        'component_hours', f.component_hours,
        'assigned_hours_total', f.assigned_hours_total,
        'remaining_hours', f.remaining_hours,
        'assignment_count', f.assignment_count,
        'is_co_taught', f.assignment_count > 1,
        'allocation_status', f.allocation_status,
        'instructors', f.instructors,
        'conflicts', to_jsonb(array_remove(ARRAY[
          CASE WHEN f.is_obsolete THEN 'OBSOLETE_DELIVERY_GROUP' END,
          CASE WHEN NOT f.active THEN 'INACTIVE_DELIVERY_GROUP' END,
          CASE WHEN f.allocation_status = 'under_allocated' AND f.assignment_count > 0 THEN 'UNDER_ALLOCATED' END,
          CASE WHEN f.allocation_status = 'over_allocated' THEN 'OVER_ALLOCATED' END,
          CASE WHEN f.allocation_status = 'unassigned' THEN 'UNASSIGNED' END
        ], NULL))
      ) ORDER BY f.course_code, f.component_type, f.group_number
    ),
    '[]'::jsonb
  ) INTO v_rows
  FROM finalized f
  WHERE p_assignment_status IS NULL
    OR p_assignment_status = 'all'
    OR (p_assignment_status = 'assigned' AND f.assignment_count > 0)
    OR (p_assignment_status = 'unassigned' AND f.assignment_count = 0)
    OR (p_assignment_status = 'under_allocated' AND f.allocation_status = 'under_allocated')
    OR (p_assignment_status = 'fully_allocated' AND f.allocation_status = 'fully_allocated')
    OR (p_assignment_status = 'obsolete' AND f.is_obsolete)
    OR (p_assignment_status = 'inactive' AND NOT f.active);

  RETURN jsonb_build_object(
    'ok', true,
    'college_id', p_college_id,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'can_manage', public.can_manage_college(v_uid, p_college_id)
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.list_schedule_builder_v2_work_items(p_schedule_version_id uuid, p_program_id uuid DEFAULT NULL::uuid, p_level_id uuid DEFAULT NULL::uuid, p_cohort_id uuid DEFAULT NULL::uuid, p_study_system text DEFAULT NULL::text, p_component_type text DEFAULT NULL::text, p_instructor_id uuid DEFAULT NULL::uuid, p_scheduling_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_schedule_version_id IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_version
  FROM public.schedule_versions
  WHERE id = p_schedule_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_view_college(v_uid, v_version.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(x.row_obj ORDER BY x.course_code, x.component_type, x.group_number, x.instructor_name), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      c.code AS course_code,
      pcc.component_type,
      dg.group_number,
      i.full_name AS instructor_name,
      jsonb_build_object(
        'teaching_assignment_id', ta.id,
        'delivery_group_id', dg.id,
        'cohort_id', ac.id,
        'cohort_code', (SELECT string_agg(c.code, ' + ' ORDER BY c.code) FROM public.shared_lecture_group_ids(dg.id) ids JOIN public.delivery_groups g ON g.id=ids.group_id JOIN public.academic_cohorts c ON c.id=g.cohort_id),
        'program_id', ac.program_id,
        'level_id', ac.level_id,
        'semester_term_id', ac.term_id,
        'study_system', public.shared_lecture_system(dg.id),
        'course_id', c.id,
        'course_code', c.code,
        'course_name', c.name,
        'component_id', pcc.id,
        'component_type', pcc.component_type,
        'group_number', dg.group_number,
        'group_code', dg.group_code,
        'instructor_id', i.id,
        'instructor_name', i.full_name,
        'assigned_component_hours', COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0),
        'component_hours', pcc.weekly_contact_hours,
        'time_unit', 'component_hours_wallclock_equivalent',
        'currently_scheduled_hours', sched.scheduled_hours,
        'remaining_schedule_hours', GREATEST(
          0,
          COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) - sched.scheduled_hours
        ),
        'session_count', sched.session_count,
        'scheduling_status', status.scheduling_status,
        'blocking_reason', status.blocking_reason,
        'can_create_session', status.can_create_session,
        'is_project', (pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false),
        'is_summer_training', (pcc.component_type = 'summer_training'),
        'assignment_active', COALESCE(ta.is_active, true),
        'delivery_group_active', COALESCE(dg.active, true),
        'delivery_group_obsolete', COALESCE(dg.is_obsolete, false),
        'allocation_status', COALESCE(alloc.allocation_json->>'allocation_status', 'unassigned'),
        'course_offering_id', ta.course_offering_id,
        'plan_course_component_id', ta.plan_course_component_id,
        'session_type', ta.session_type,
        'expected_students', COALESCE(ta.expected_students, dg.expected_students, 0),
        'assignment_updated_at', ta.updated_at
      ) AS row_obj
    FROM public.teaching_assignments ta
    JOIN public.operational_delivery_groups dg
      ON dg.id = ta.delivery_group_id
     AND dg.college_id = ta.college_id
    JOIN public.academic_cohorts ac
      ON ac.id = dg.cohort_id
     AND ac.college_id = dg.college_id
    JOIN public.plan_course_components pcc
      ON pcc.id = dg.component_id
     AND pcc.college_id = ta.college_id
    JOIN public.plan_courses pc
      ON pc.id = dg.plan_course_id
     AND pc.college_id = ta.college_id
    JOIN public.courses c
      ON c.id = pc.course_id
     AND c.college_id = ta.college_id
    JOIN public.instructors i
      ON i.id = ta.instructor_id
     AND i.college_id = ta.college_id
    CROSS JOIN LATERAL (
      SELECT public.compute_delivery_group_allocation(dg.id) AS allocation_json
    ) alloc
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(SUM(public._sb_v2_wall_hours(ss.start_time, ss.end_time)), 0) AS scheduled_hours,
        COUNT(*)::integer AS session_count
      FROM public.schedule_sessions ss
      WHERE ss.schedule_version_id = p_schedule_version_id
        AND ss.teaching_assignment_id = ta.id
    ) sched
    CROSS JOIN LATERAL (
      SELECT
        CASE
          WHEN COALESCE(ta.is_active, true) = false THEN 'blocked'
          WHEN COALESCE(dg.active, true) = false THEN 'blocked'
          WHEN COALESCE(dg.is_obsolete, false) THEN 'blocked'
          WHEN pcc.component_type = 'summer_training' THEN 'blocked'
          WHEN pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN 'blocked'
          WHEN sched.scheduled_hours > COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN 'over_scheduled'
          WHEN sched.scheduled_hours <= 0 THEN 'unscheduled'
          WHEN sched.scheduled_hours < COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN 'partially_scheduled'
          ELSE 'scheduled'
        END AS scheduling_status,
        CASE
          WHEN COALESCE(ta.is_active, true) = false THEN 'INACTIVE_ASSIGNMENT'
          WHEN COALESCE(dg.active, true) = false THEN 'INACTIVE_DELIVERY_GROUP'
          WHEN COALESCE(dg.is_obsolete, false) THEN 'OBSOLETE_DELIVERY_GROUP'
          WHEN pcc.component_type = 'summer_training' THEN 'SUMMER_TRAINING_BLOCKED'
          WHEN pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN 'PROJECT_NON_WEEKLY'
          WHEN sched.scheduled_hours > COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN 'OVER_SCHEDULED'
          ELSE NULL
        END AS blocking_reason,
        CASE
          WHEN COALESCE(ta.is_active, true) = false THEN false
          WHEN COALESCE(dg.active, true) = false THEN false
          WHEN COALESCE(dg.is_obsolete, false) THEN false
          WHEN pcc.component_type = 'summer_training' THEN false
          WHEN pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN false
          WHEN sched.scheduled_hours >= COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN false
          ELSE true
        END AS can_create_session
    ) status
    WHERE ta.college_id = v_version.college_id
      AND ta.delivery_group_id IS NOT NULL
      AND ac.term_id = v_version.academic_term_id
      AND public.shared_lecture_matches(dg.id,p_cohort_id,p_study_system)
      AND (p_program_id IS NULL OR ac.program_id = p_program_id)
      AND (p_level_id IS NULL OR ac.level_id = p_level_id)
      AND NOT EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE member_group_id=dg.id)
      AND (p_component_type IS NULL OR pcc.component_type = p_component_type)
      AND (p_instructor_id IS NULL OR ta.instructor_id = p_instructor_id)
      AND (
        p_scheduling_status IS NULL
        OR p_scheduling_status = 'all'
        OR status.scheduling_status = p_scheduling_status
      )
  ) x;

  RETURN jsonb_build_object(
    'ok', true,
    'schedule_version_id', p_schedule_version_id,
    'college_id', v_version.college_id,
    'academic_term_id', v_version.academic_term_id,
    'version_status', v_version.status,
    'version_updated_at', v_version.updated_at,
    'time_unit', 'component_hours_wallclock_equivalent',
    'time_unit_note', 'No formal academic-hour→minutes contract; remaining uses assigned_component_hours vs wall-clock session hours.',
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'can_manage', public.can_manage_college(v_uid, v_version.college_id)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.list_teaching_assignment_workspace(uuid,uuid,uuid,uuid,text,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_teaching_assignment_workspace(uuid,uuid,uuid,uuid,text,uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;

BEGIN;
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
        'cohort_code', (SELECT string_agg(cc.code,' + ' ORDER BY cc.code) FROM public.shared_lecture_group_ids(dg.id) ids JOIN public.delivery_groups gg ON gg.id=ids.group_id JOIN public.academic_cohorts cc ON cc.id=gg.cohort_id),
        'program_id', ac.program_id,
        'level_id', ac.level_id,
        'semester_term_id', ac.term_id,
        'study_system', ac.study_system,
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
        'expected_students', COALESCE(dg.expected_students, 0),
        'assignment_updated_at', ta.updated_at
      ) AS row_obj
    FROM public.teaching_assignments ta
    JOIN public.operational_delivery_group(p_schedule_version_id,ta.delivery_group_id) dg
      ON dg.id = ta.delivery_group_id
     AND (NOT EXISTS (SELECT 1 FROM schedule_version_delivery_private.scope s
       WHERE s.version_id=p_schedule_version_id AND s.cohort_id=dg.cohort_id)
       OR EXISTS (SELECT 1 FROM schedule_version_delivery_private.group_facts f
       WHERE f.version_id=p_schedule_version_id AND f.group_id=dg.id))
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
     AND (
       i.college_id = ta.college_id
       OR public.education_canonical_home_assignment(ta.id, i.id, ta.college_id, dg.id)
       OR EXISTS (
         SELECT 1
         FROM public.faculty_teaching_requests fr
         JOIN public.faculty_identity_links fl
           ON fl.identity_id = fr.identity_id
          AND fl.instructor_id = i.id
         WHERE fr.assignment_id = ta.id
           AND fr.instructor_id = i.id
           AND (fr.home_college_id = i.college_id
             OR EXISTS (
               SELECT 1
               FROM faculty_private.home_profiles hp
               WHERE hp.identity_id = fr.identity_id
                 AND hp.home_college_id = fr.home_college_id
                 AND hp.source_instructor_id = i.id
                 AND hp.is_active
                 AND hp.affiliation_status = 'verified'
             ))
           AND fr.college_id = ta.college_id
           AND fr.delivery_group_id = dg.id
           AND fr.term_id = ac.term_id
           AND fr.status = 'approved'
           AND fr.decided_by IS NOT NULL
           AND fr.decided_at IS NOT NULL
           AND fr.assigned_hours = COALESCE(ta.assigned_component_hours, ta.weekly_hours)
       )
     )
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
      SELECT public.delivery_group_is_current(dg.id,p_schedule_version_id) AS is_current
      OFFSET 0
    ) freshness
    CROSS JOIN LATERAL (
      SELECT
        CASE
          WHEN NOT freshness.is_current THEN 'blocked'
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
          WHEN NOT freshness.is_current THEN 'المجموعات قديمة: تغيّر عدد الطلاب أو سعة/نوع القاعة. أعد توليد مجموعات المحاضرات والمعامل قبل الجدولة.'
          WHEN COALESCE(ta.is_active, true) = false THEN 'INACTIVE_ASSIGNMENT'
          WHEN COALESCE(dg.active, true) = false THEN 'INACTIVE_DELIVERY_GROUP'
          WHEN COALESCE(dg.is_obsolete, false) THEN 'OBSOLETE_DELIVERY_GROUP'
          WHEN pcc.component_type = 'summer_training' THEN 'SUMMER_TRAINING_BLOCKED'
          WHEN pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN 'PROJECT_NON_WEEKLY'
          WHEN sched.scheduled_hours > COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN 'OVER_SCHEDULED'
          ELSE NULL
        END AS blocking_reason,
        CASE
          WHEN NOT freshness.is_current THEN false
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
      AND (p_program_id IS NULL OR EXISTS(SELECT 1 FROM public.shared_lecture_group_ids(dg.id) ids JOIN public.delivery_groups gg ON gg.id=ids.group_id JOIN public.academic_cohorts cc ON cc.id=gg.cohort_id WHERE cc.program_id=p_program_id))
      AND (p_level_id IS NULL OR EXISTS(SELECT 1 FROM public.shared_lecture_group_ids(dg.id) ids JOIN public.delivery_groups gg ON gg.id=ids.group_id JOIN public.academic_cohorts cc ON cc.id=gg.cohort_id WHERE cc.level_id=p_level_id))
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
$function$
COMMIT;

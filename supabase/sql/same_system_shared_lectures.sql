CREATE OR REPLACE FUNCTION public.same_system_lecture_pair(p_anchor uuid, p_member uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $fn$
 SELECT EXISTS (
 SELECT 1 FROM public.delivery_groups a
 JOIN public.delivery_groups b ON b.id=p_member AND b.college_id=a.college_id AND b.cohort_id<>a.cohort_id
 JOIN public.academic_cohorts ca ON ca.id=a.cohort_id
 JOIN public.academic_cohorts cb ON cb.id=b.cohort_id
 JOIN public.plan_courses pa ON pa.id=a.plan_course_id
 JOIN public.plan_courses pb ON pb.id=b.plan_course_id AND pb.course_id=pa.course_id
 JOIN public.plan_course_components xa ON xa.id=a.component_id AND xa.plan_course_id=pa.id
 JOIN public.plan_course_components xb ON xb.id=b.component_id AND xb.plan_course_id=pb.id
 WHERE a.id=p_anchor AND a.id<>b.id AND ca.active AND cb.active
 AND ca.study_system IN ('regular','parallel') AND ca.study_system=cb.study_system
 AND ca.term_id=cb.term_id AND a.active AND b.active AND NOT a.is_obsolete AND NOT b.is_obsolete
 AND xa.component_type='theory' AND xb.component_type='theory'
 AND xa.is_timetabled AND xb.is_timetabled AND xa.weekly_contact_hours>0
 AND xa.weekly_contact_hours=xb.weekly_contact_hours
 AND a.expected_students>0 AND b.expected_students>0
 AND a.expected_students=ca.expected_students AND b.expected_students=cb.expected_students
 AND (SELECT count(*) FROM public.delivery_groups d WHERE d.cohort_id=a.cohort_id AND d.component_id=a.component_id AND d.active AND NOT d.is_obsolete)=1
 AND (SELECT count(*) FROM public.delivery_groups d WHERE d.cohort_id=b.cohort_id AND d.component_id=b.component_id AND d.active AND NOT d.is_obsolete)=1
 AND a.capacity_limit IS NOT NULL AND b.capacity_limit IS NOT NULL
 AND a.expected_students+b.expected_students<=LEAST(a.capacity_limit,b.capacity_limit)
 AND EXISTS(SELECT 1 FROM public.rooms r WHERE r.college_id=a.college_id AND r.is_active AND r.room_type='lecture_hall' AND r.capacity>=a.expected_students+b.expected_students)
 );
$fn$;
REVOKE ALL ON FUNCTION public.same_system_lecture_pair(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.same_system_lecture_pair(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_ss_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  vc uuid;
  oc uuid;
  ic uuid;
  rc uuid;
  sc uuid;
  gc uuid;
  tac uuid;
  ta_active boolean;
  ta_dg uuid;
  ta_instructor uuid;
  ta_offering uuid;
  ta_component uuid;
  ta_cohort uuid;
  dg_college uuid;
  dg_obsolete boolean;
  dg_active boolean;
  dg_cohort uuid;
  dg_component uuid;
  pcc_type text;
  pcc_regular boolean;
  v_ta_link_changing boolean;
  v_dg_link_changing boolean;
BEGIN
  SELECT college_id INTO vc FROM public.schedule_versions WHERE id = NEW.schedule_version_id;
  IF vc IS NULL OR vc <> NEW.college_id THEN RAISE EXCEPTION 'version/college mismatch'; END IF;

  SELECT college_id INTO oc FROM public.course_offerings WHERE id = NEW.course_offering_id;
  IF oc IS NULL OR oc <> NEW.college_id THEN RAISE EXCEPTION 'offering/college mismatch'; END IF;

  SELECT college_id INTO ic FROM public.instructors WHERE id = NEW.instructor_id;
  IF ic IS NULL OR ic <> NEW.college_id THEN RAISE EXCEPTION 'instructor/college mismatch'; END IF;

  IF NEW.room_id IS NOT NULL THEN
    SELECT college_id INTO rc FROM public.rooms WHERE id = NEW.room_id;
    IF rc IS NULL OR rc <> NEW.college_id THEN RAISE EXCEPTION 'room/college mismatch'; END IF;
  END IF;

  IF NEW.section_id IS NOT NULL THEN
    SELECT college_id INTO sc FROM public.sections WHERE id = NEW.section_id;
    IF sc IS NULL OR sc <> NEW.college_id THEN RAISE EXCEPTION 'section/college mismatch'; END IF;
  END IF;

  IF NEW.section_group_id IS NOT NULL THEN
    SELECT college_id INTO gc FROM public.section_groups WHERE id = NEW.section_group_id;
    IF gc IS NULL OR gc <> NEW.college_id THEN RAISE EXCEPTION 'section_group/college mismatch'; END IF;
  END IF;

  v_ta_link_changing := (
    TG_OP = 'INSERT'
    OR OLD.teaching_assignment_id IS DISTINCT FROM NEW.teaching_assignment_id
  );
  v_dg_link_changing := (
    TG_OP = 'INSERT'
    OR OLD.delivery_group_id IS DISTINCT FROM NEW.delivery_group_id
  );

  IF NEW.teaching_assignment_id IS NOT NULL THEN
    SELECT ta.college_id, ta.is_active, ta.delivery_group_id,
           ta.instructor_id, ta.course_offering_id, ta.plan_course_component_id, ta.cohort_id
      INTO tac, ta_active, ta_dg, ta_instructor, ta_offering, ta_component, ta_cohort
    FROM public.teaching_assignments ta
    WHERE ta.id = NEW.teaching_assignment_id;
    IF tac IS NULL OR tac <> NEW.college_id THEN
      RAISE EXCEPTION 'teaching_assignment/college mismatch';
    END IF;
    IF v_ta_link_changing AND COALESCE(ta_active, true) = false THEN
      RAISE EXCEPTION 'INACTIVE_ASSIGNMENT_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_instructor IS DISTINCT FROM NEW.instructor_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_INSTRUCTOR_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_offering IS DISTINCT FROM NEW.course_offering_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_OFFERING_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_dg IS NOT NULL THEN
      SELECT dg.college_id, dg.is_obsolete, dg.active, dg.cohort_id, dg.component_id
        INTO dg_college, dg_obsolete, dg_active, dg_cohort, dg_component
      FROM public.operational_delivery_groups dg
      WHERE dg.id = ta_dg;
      IF dg_college IS NULL THEN
        RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
      END IF;
      IF dg_college <> NEW.college_id THEN
        RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF COALESCE(dg_obsolete, false) THEN
        RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF COALESCE(dg_active, true) = false THEN
        RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      SELECT pcc.component_type, COALESCE(pcc.counts_toward_regular_load, true)
        INTO pcc_type, pcc_regular
      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;
      IF pcc_type = 'summer_training' THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF pcc_type = 'project' AND COALESCE(pcc_regular, true) = false THEN
        RAISE EXCEPTION 'PROJECT_STANDARD_WEEKLY_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.delivery_group_id IS NOT NULL AND NEW.delivery_group_id IS DISTINCT FROM ta_dg THEN
        RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_ASSIGNMENT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.cohort_id IS NOT NULL AND NEW.cohort_id IS DISTINCT FROM dg_cohort THEN
        RAISE EXCEPTION 'SESSION_COHORT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.plan_course_component_id IS NOT NULL
         AND NEW.plan_course_component_id IS DISTINCT FROM dg_component THEN
        RAISE EXCEPTION 'SESSION_COMPONENT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.delivery_group_id IS NOT NULL THEN
    SELECT dg.college_id, dg.is_obsolete, dg.active, dg.cohort_id, dg.component_id
      INTO dg_college, dg_obsolete, dg_active, dg_cohort, dg_component
    FROM public.operational_delivery_groups dg
    WHERE dg.id = NEW.delivery_group_id;
    IF dg_college IS NULL THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF dg_college <> NEW.college_id THEN
      RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing AND COALESCE(dg_obsolete, false) THEN
      RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing AND COALESCE(dg_active, true) = false THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing THEN
      SELECT pcc.component_type, COALESCE(pcc.counts_toward_regular_load, true)
        INTO pcc_type, pcc_regular
      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;
      IF pcc_type = 'summer_training' THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF pcc_type = 'project' AND COALESCE(pcc_regular, true) = false THEN
        RAISE EXCEPTION 'PROJECT_STANDARD_WEEKLY_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=NEW.delivery_group_id) THEN
    IF NOT public.shared_lecture_time_allowed(NEW.college_id,NEW.day_of_week,NEW.start_time,NEW.end_time) THEN
      RAISE EXCEPTION 'SHARED_LECTURE_TIME_WINDOW' USING ERRCODE='23514';
    END IF;
    SELECT c.study_system INTO NEW.study_system FROM public.delivery_groups d JOIN public.academic_cohorts c ON c.id=d.cohort_id WHERE d.id=NEW.delivery_group_id;
    NEW.expected_students := (public.operational_delivery_group(NEW.delivery_group_id)).expected_students;
  END IF;
  RETURN NEW;
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
$function$;

CREATE OR REPLACE FUNCTION public.list_teaching_assignment_workspace(p_college_id uuid, p_program_id uuid DEFAULT NULL::uuid, p_level_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_study_system text DEFAULT NULL::text, p_cohort_id uuid DEFAULT NULL::uuid, p_component_type text DEFAULT NULL::text, p_assignment_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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

  -- summer_training excluded (not weekly assignable)
  WITH group_records AS MATERIALIZED (
    SELECT public.operational_delivery_group(g.id) AS item
    FROM public.delivery_groups g WHERE g.college_id = p_college_id
  ), workspace_groups AS MATERIALIZED (
    SELECT (item).* FROM group_records
  )
  SELECT COALESCE(jsonb_agg(x.row_obj ORDER BY x.course_code, x.component_type, x.group_number), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      c.code AS course_code,
      pcc.component_type,
      dg.group_number,
      jsonb_build_object(
        'delivery_group_id', dg.id,
        'college_id', dg.college_id,
        'cohort_id', dg.cohort_id,
        'cohort_code', (SELECT string_agg(cc.code,' + ' ORDER BY cc.code) FROM public.shared_lecture_group_ids(dg.id) ids JOIN public.delivery_groups gg ON gg.id=ids.group_id JOIN public.academic_cohorts cc ON cc.id=gg.cohort_id),
        'program_id', ac.program_id,
        'level_id', ac.level_id,
        'term_id', ac.term_id,
        'study_system', ac.study_system,
        'plan_course_id', dg.plan_course_id,
        'plan_course_component_id', dg.component_id,
        'component_type', pcc.component_type,
        'course_id', c.id,
        'course_code', c.code,
        'course_name', c.name,
        'group_number', dg.group_number,
        'group_code', dg.group_code,
        'expected_students', dg.expected_students,
        'capacity_limit', dg.capacity_limit,
        'is_obsolete', COALESCE(dg.is_obsolete, false),
        'active', COALESCE(dg.active, true),
        'excluded_from_standard_workload', COALESCE(dg.excluded_from_standard_workload, false),
        'component_hours', pcc.weekly_contact_hours,
        'assigned_hours_total', alloc.assigned_hours_total,
        'remaining_hours', alloc.remaining_hours,
        'assignment_count', alloc.assignment_count,
        'is_co_taught', alloc.is_co_taught,
        'allocation_status', alloc.allocation_status,
        'instructors', COALESCE(instr.instructors, '[]'::jsonb),
        'conflicts', COALESCE(conf.conflicts, '[]'::jsonb)
      ) AS row_obj
    FROM workspace_groups dg
    JOIN public.academic_cohorts ac ON ac.id = dg.cohort_id AND ac.college_id = dg.college_id
    JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
    JOIN public.plan_courses pc ON pc.id = dg.plan_course_id
    JOIN public.courses c ON c.id = pc.course_id
    -- Compute allocation directly once per group; the enclosing RPC checks college access.
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::integer AS assignment_count,
        CASE WHEN COUNT(*) = 1
          THEN COALESCE(MAX(ta.assigned_component_hours), pcc.weekly_contact_hours, 0)
          ELSE COALESCE(SUM(ta.assigned_component_hours), 0)
        END AS assigned_hours_total
      FROM public.teaching_assignments ta
      WHERE ta.delivery_group_id = dg.id AND ta.is_active = TRUE
    ) totals
    CROSS JOIN LATERAL (
      SELECT totals.assignment_count, totals.assigned_hours_total,
        GREATEST(0, COALESCE(pcc.weekly_contact_hours, 0) - totals.assigned_hours_total) AS remaining_hours,
        totals.assignment_count > 1 AS is_co_taught,
        CASE WHEN totals.assignment_count = 0 THEN 'unassigned'
          WHEN totals.assigned_hours_total > COALESCE(pcc.weekly_contact_hours, 0) THEN 'over_allocated'
          WHEN totals.assigned_hours_total < COALESCE(pcc.weekly_contact_hours, 0) THEN 'under_allocated'
          ELSE 'fully_allocated'
        END AS allocation_status
    ) alloc
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'assignment_id', ta.id,
          'instructor_id', ta.instructor_id,
          'instructor_name', i.full_name,
          'employee_number', i.employee_number,
          'assigned_component_hours', ta.assigned_component_hours,
          'is_active', ta.is_active,
          'updated_at', ta.updated_at
        )
        ORDER BY i.full_name
      ) AS instructors
      FROM public.teaching_assignments ta
      JOIN public.instructors i ON i.id = ta.instructor_id
      WHERE ta.delivery_group_id = dg.id
        AND ta.is_active = TRUE
    ) instr ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(c_code) AS conflicts
      FROM (
        SELECT 'OBSOLETE_DELIVERY_GROUP' AS c_code
        WHERE COALESCE(dg.is_obsolete, false)
        UNION ALL
        SELECT 'INACTIVE_DELIVERY_GROUP' AS c_code
        WHERE COALESCE(dg.active, true) = false
        UNION ALL
        SELECT 'UNDER_ALLOCATED'
        WHERE alloc.allocation_status = 'under_allocated' AND alloc.assignment_count > 0
        UNION ALL
        SELECT 'OVER_ALLOCATED'
        WHERE alloc.allocation_status = 'over_allocated'
        UNION ALL
        SELECT 'UNASSIGNED'
        WHERE alloc.allocation_status = 'unassigned'
      ) z
    ) conf ON TRUE
    WHERE dg.college_id = p_college_id
      AND pcc.component_type IS DISTINCT FROM 'summer_training'
      AND public.shared_lecture_matches(dg.id,p_cohort_id,p_study_system)
      AND (p_program_id IS NULL OR EXISTS(SELECT 1 FROM public.shared_lecture_group_ids(dg.id) ids JOIN public.delivery_groups gg ON gg.id=ids.group_id JOIN public.academic_cohorts cc ON cc.id=gg.cohort_id WHERE cc.program_id=p_program_id))
      AND (p_level_id IS NULL OR EXISTS(SELECT 1 FROM public.shared_lecture_group_ids(dg.id) ids JOIN public.delivery_groups gg ON gg.id=ids.group_id JOIN public.academic_cohorts cc ON cc.id=gg.cohort_id WHERE cc.level_id=p_level_id))
      AND (p_term_id IS NULL OR ac.term_id = p_term_id)
      AND NOT EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE member_group_id=dg.id)
      AND (p_component_type IS NULL OR pcc.component_type = p_component_type)
      AND (
        p_assignment_status IS NULL
        OR p_assignment_status = 'all'
        OR (p_assignment_status = 'assigned' AND alloc.assignment_count > 0)
        OR (p_assignment_status = 'unassigned' AND alloc.assignment_count = 0)
        OR (p_assignment_status = 'under_allocated' AND alloc.allocation_status = 'under_allocated')
        OR (p_assignment_status = 'fully_allocated' AND alloc.allocation_status = 'fully_allocated')
        OR (p_assignment_status = 'obsolete' AND COALESCE(dg.is_obsolete, false))
        OR (p_assignment_status = 'inactive' AND COALESCE(dg.active, true) = false)
      )
  ) x;

  RETURN jsonb_build_object(
    'ok', true,
    'college_id', p_college_id,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'can_manage', public.can_manage_college(v_uid, p_college_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.operational_delivery_group(p_group uuid)
 RETURNS delivery_groups
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE g public.delivery_groups%ROWTYPE; total integer;
BEGIN
  SELECT * INTO g FROM public.delivery_groups WHERE id=p_group;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE member_group_id=p_group) THEN
    g.active := false;
    g.is_obsolete := true;
  ELSIF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=p_group) THEN
    SELECT sum(d.expected_students)::integer INTO total FROM public.delivery_groups d
      JOIN public.shared_lecture_group_ids(p_group) m ON m.group_id=d.id;
    g.expected_students := total;
    g.group_code := g.group_code || ' — مدمج ضمن النظام نفسه';
  END IF;
  RETURN g;
END;
$function$;

CREATE OR REPLACE FUNCTION public.shared_lecture_candidates(p_college uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $fn$
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
 'anchor_group_id',a.id,'member_group_id',b.id,'course_name',course.name,
 'anchor_cohort_code',ca.code,'member_cohort_code',cb.code,
 'study_system',ca.study_system,'total_students',a.expected_students+b.expected_students,
 'weekly_hours',p.weekly_contact_hours) ORDER BY course.name),'[]'::jsonb)
 FROM public.delivery_groups a
 JOIN public.plan_courses pc ON pc.id=a.plan_course_id
 JOIN public.plan_courses pc2 ON pc2.course_id=pc.course_id
 JOIN public.delivery_groups b ON b.plan_course_id=pc2.id AND a.id<b.id
 JOIN public.academic_cohorts ca ON ca.id=a.cohort_id
 JOIN public.academic_cohorts cb ON cb.id=b.cohort_id
 JOIN public.plan_course_components p ON p.id=a.component_id
 JOIN public.courses course ON course.id=pc.course_id
 WHERE a.college_id=p_college AND public.can_manage_college(auth.uid(),p_college)
 AND public.same_system_lecture_pair(a.id,b.id)
 AND NOT EXISTS(SELECT 1 FROM public.shared_lecture_links l WHERE l.anchor_group_id IN(a.id,b.id) OR l.member_group_id IN(a.id,b.id))
 AND NOT EXISTS(SELECT 1 FROM public.teaching_assignments t WHERE t.delivery_group_id IN(a.id,b.id) AND t.is_active)
 AND NOT EXISTS(SELECT 1 FROM public.schedule_sessions s WHERE s.delivery_group_id IN(a.id,b.id));
$fn$;
CREATE OR REPLACE FUNCTION public.unmerge_shared_lecture(p_member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE l public.shared_lecture_links%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 PERFORM pg_catalog.pg_advisory_xact_lock(9262,1);
 SELECT * INTO l FROM public.shared_lecture_links WHERE member_group_id=p_member FOR UPDATE;
 IF NOT FOUND OR NOT public.can_manage_college(auth.uid(),l.college_id) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.delivery_groups WHERE id=l.anchor_group_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.schedule_sessions WHERE delivery_group_id=l.anchor_group_id)
 THEN RAISE EXCEPTION 'SHARED_LECTURE_SCHEDULED' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.teaching_assignments WHERE delivery_group_id=l.anchor_group_id AND is_active)
 THEN RAISE EXCEPTION 'SHARED_LECTURE_ACTIVE_ASSIGNMENTS_EXIST' USING ERRCODE='23514'; END IF;
 DELETE FROM public.shared_lecture_links WHERE member_group_id=p_member;
 INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
 VALUES(auth.uid(),'unmerge_shared_lecture','delivery_groups',l.anchor_group_id,l.college_id,to_jsonb(l));
 RETURN jsonb_build_object('ok',true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_shared_lecture_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE a public.delivery_groups%ROWTYPE; b public.delivery_groups%ROWTYPE;
 ca public.academic_cohorts%ROWTYPE; cb public.academic_cohorts%ROWTYPE; n integer;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(9262,1);
 SELECT * INTO a FROM public.delivery_groups WHERE id=NEW.anchor_group_id FOR UPDATE;
 SELECT * INTO b FROM public.delivery_groups WHERE id=NEW.member_group_id FOR UPDATE;
 SELECT * INTO ca FROM public.academic_cohorts WHERE id=a.cohort_id;
 SELECT * INTO cb FROM public.academic_cohorts WHERE id=b.cohort_id;
 IF a.college_id IS DISTINCT FROM NEW.college_id OR b.college_id IS DISTINCT FROM NEW.college_id
 OR NOT public.same_system_lecture_pair(a.id,b.id)
 THEN RAISE EXCEPTION 'SHARED_LECTURE_CONTEXT_MISMATCH' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=a.id AND member_group_id<>b.id)
 THEN RAISE EXCEPTION 'SHARED_LECTURE_PAIR_ONLY' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_sessions WHERE delivery_group_id IN(a.id,b.id))
 THEN RAISE EXCEPTION 'SHARED_LECTURE_SCHEDULED' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.shared_lecture_links l WHERE l.member_group_id=NEW.anchor_group_id OR l.anchor_group_id=NEW.member_group_id)
 THEN RAISE EXCEPTION 'SHARED_LECTURE_CHAIN_FORBIDDEN' USING ERRCODE='23514'; END IF;
 SELECT a.expected_students+b.expected_students+COALESCE(sum(g.expected_students),0) INTO n
 FROM public.shared_lecture_links l JOIN public.delivery_groups g ON g.id=l.member_group_id
 WHERE l.anchor_group_id=a.id AND l.member_group_id<>b.id;
 IF n>LEAST(a.capacity_limit,b.capacity_limit) OR a.capacity_limit IS NULL OR b.capacity_limit IS NULL
 THEN RAISE EXCEPTION 'SHARED_LECTURE_CAPACITY_EXCEEDED' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM public.teaching_assignments WHERE delivery_group_id IN(a.id,b.id) AND is_active)
 THEN RAISE EXCEPTION 'SHARED_LECTURE_ACTIVE_ASSIGNMENTS_EXIST' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$function$;

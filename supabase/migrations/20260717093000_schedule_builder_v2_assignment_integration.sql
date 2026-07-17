-- =============================================================================
-- PHASE-9.5 — Schedule Builder V2 Assignment Integration Foundation
-- CREATED / NOT APPLIED
--
-- Adds:
--   * list_schedule_builder_v2_work_items (read model)
--   * create_schedule_session_from_assignment_v2 (manual create, draft only)
--   * V2 scheduling guards for ensure_ss_college + move/validate paths
--   * supporting indexes / grants
--
-- NO backfill. NO generator invocation. NO operational session inserts.
-- NO schedule_version creation. NO import. NO data mutation on apply.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) Index for assignment scheduling lookups
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_schedule_sessions_ta_version
  ON public.schedule_sessions (teaching_assignment_id, schedule_version_id)
  WHERE teaching_assignment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schedule_sessions_dg_version
  ON public.schedule_sessions (delivery_group_id, schedule_version_id)
  WHERE delivery_group_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 1) Wall-clock hours helper (no invented academic-hour conversion)
--    Session duration is wall-clock; assigned_component_hours is the workload unit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sb_v2_wall_hours(
  p_start time,
  p_end time
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN 0::numeric
    ELSE ROUND((EXTRACT(EPOCH FROM (p_end - p_start)) / 3600.0)::numeric, 4)
  END;
$$;

REVOKE ALL ON FUNCTION public._sb_v2_wall_hours(time, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sb_v2_wall_hours(time, time) TO service_role;

COMMENT ON FUNCTION public._sb_v2_wall_hours(time, time) IS
  'PHASE-9.5 internal: wall-clock hours between start/end. No academic-hour conversion.';

-- ---------------------------------------------------------------------------
-- 2) Scheduled hours for one assignment on one version (exclude optional session)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sb_v2_scheduled_hours_for_assignment(
  p_schedule_version_id uuid,
  p_teaching_assignment_id uuid,
  p_exclude_session_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(public._sb_v2_wall_hours(ss.start_time, ss.end_time)), 0)
  FROM public.schedule_sessions ss
  WHERE ss.schedule_version_id = p_schedule_version_id
    AND ss.teaching_assignment_id = p_teaching_assignment_id
    AND (p_exclude_session_id IS NULL OR ss.id <> p_exclude_session_id);
$$;

REVOKE ALL ON FUNCTION public._sb_v2_scheduled_hours_for_assignment(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sb_v2_scheduled_hours_for_assignment(uuid, uuid, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3) V2 assignment/group schedulability guard (returns jsonb error or ok)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sb_v2_assignment_guard(
  p_teaching_assignment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ta public.teaching_assignments%ROWTYPE;
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
BEGIN
  IF p_teaching_assignment_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'is_v2', false);
  END IF;

  SELECT * INTO v_ta
  FROM public.teaching_assignments
  WHERE id = p_teaching_assignment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ASSIGNMENT_NOT_FOUND');
  END IF;

  -- Legacy rows without delivery_group are not Phase 9.5 V2 work items
  IF v_ta.delivery_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'is_v2', false, 'teaching_assignment_id', v_ta.id);
  END IF;

  IF COALESCE(v_ta.is_active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INACTIVE_ASSIGNMENT', 'is_v2', true);
  END IF;

  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = v_ta.delivery_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DELIVERY_GROUP_NOT_FOUND', 'is_v2', true);
  END IF;
  IF COALESCE(v_dg.is_obsolete, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OBSOLETE_DELIVERY_GROUP', 'is_v2', true);
  END IF;
  IF COALESCE(v_dg.active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INACTIVE_DELIVERY_GROUP', 'is_v2', true);
  END IF;

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'COMPONENT_NOT_FOUND', 'is_v2', true);
  END IF;
  IF v_pcc.component_type = 'summer_training' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SUMMER_TRAINING_BLOCKED', 'is_v2', true);
  END IF;
  IF v_pcc.component_type = 'project' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PROJECT_NON_WEEKLY', 'is_v2', true);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'is_v2', true,
    'teaching_assignment_id', v_ta.id,
    'delivery_group_id', v_dg.id,
    'component_type', v_pcc.component_type
  );
END;
$$;

REVOKE ALL ON FUNCTION public._sb_v2_assignment_guard(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sb_v2_assignment_guard(uuid) TO service_role;

COMMENT ON FUNCTION public._sb_v2_assignment_guard(uuid) IS
  'PHASE-9.5 internal: active V2 assignment + delivery group + summer/project gates.';

-- ---------------------------------------------------------------------------
-- 4) Delivery-group / cohort peer overlap (create + move)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sb_v2_delivery_group_overlap(
  p_schedule_version_id uuid,
  p_delivery_group_id uuid,
  p_cohort_id uuid,
  p_day_of_week integer,
  p_start_time time,
  p_end_time time,
  p_exclude_session_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_peer record;
  v_conflicts jsonb := '[]'::jsonb;
BEGIN
  IF p_delivery_group_id IS NULL AND p_cohort_id IS NULL THEN
    RETURN v_conflicts;
  END IF;

  FOR v_peer IN
    SELECT ss.id, ss.delivery_group_id, ss.cohort_id
    FROM public.schedule_sessions ss
    WHERE ss.schedule_version_id = p_schedule_version_id
      AND ss.day_of_week = p_day_of_week
      AND ss.start_time < p_end_time
      AND p_start_time < ss.end_time
      AND (p_exclude_session_id IS NULL OR ss.id <> p_exclude_session_id)
      AND (
        (p_delivery_group_id IS NOT NULL AND ss.delivery_group_id = p_delivery_group_id)
        OR (p_cohort_id IS NOT NULL AND ss.cohort_id = p_cohort_id)
      )
  LOOP
    v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
      'code', 'delivery_group_conflict',
      'severity', 'hard',
      'message_ar', 'تعارض مجموعة التدريس / الدفعة: توجد جلسة متداخلة لنفس المجموعة.',
      'message_en', 'Delivery group / cohort conflict: overlapping session for the same group.',
      'related_session_id', v_peer.id,
      'metadata', jsonb_build_object(
        'delivery_group_id', v_peer.delivery_group_id,
        'cohort_id', v_peer.cohort_id
      )
    ));
  END LOOP;

  RETURN v_conflicts;
END;
$$;

REVOKE ALL ON FUNCTION public._sb_v2_delivery_group_overlap(uuid, uuid, uuid, integer, time, time, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sb_v2_delivery_group_overlap(uuid, uuid, uuid, integer, time, time, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5) list_schedule_builder_v2_work_items
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_schedule_builder_v2_work_items(
  p_schedule_version_id uuid,
  p_program_id uuid DEFAULT NULL,
  p_level_id uuid DEFAULT NULL,
  p_cohort_id uuid DEFAULT NULL,
  p_study_system text DEFAULT NULL,
  p_component_type text DEFAULT NULL,
  p_instructor_id uuid DEFAULT NULL,
  p_scheduling_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
        'cohort_code', ac.code,
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
        'is_project', (pcc.component_type = 'project'),
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
    JOIN public.delivery_groups dg
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
          WHEN pcc.component_type = 'project' THEN 'blocked'
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
          WHEN pcc.component_type = 'project' THEN 'PROJECT_NON_WEEKLY'
          WHEN sched.scheduled_hours > COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN 'OVER_SCHEDULED'
          ELSE NULL
        END AS blocking_reason,
        CASE
          WHEN COALESCE(ta.is_active, true) = false THEN false
          WHEN COALESCE(dg.active, true) = false THEN false
          WHEN COALESCE(dg.is_obsolete, false) THEN false
          WHEN pcc.component_type IN ('summer_training', 'project') THEN false
          WHEN sched.scheduled_hours >= COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN false
          ELSE true
        END AS can_create_session
    ) status
    WHERE ta.college_id = v_version.college_id
      AND ta.delivery_group_id IS NOT NULL
      AND ac.term_id = v_version.academic_term_id
      AND (p_cohort_id IS NULL OR ac.id = p_cohort_id)
      AND (p_program_id IS NULL OR ac.program_id = p_program_id)
      AND (p_level_id IS NULL OR ac.level_id = p_level_id)
      AND (p_study_system IS NULL OR ac.study_system = p_study_system)
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
$$;

REVOKE ALL ON FUNCTION public.list_schedule_builder_v2_work_items(uuid, uuid, uuid, uuid, text, text, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_schedule_builder_v2_work_items(uuid, uuid, uuid, uuid, text, text, uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.list_schedule_builder_v2_work_items(uuid, uuid, uuid, uuid, text, text, uuid, text) IS
  'PHASE-9.5: deterministic V2 schedulable work items for a schedule version. can_view_college. No PII beyond instructor name.';

-- ---------------------------------------------------------------------------
-- 6) create_schedule_session_from_assignment_v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_schedule_session_from_assignment_v2(
  p_schedule_version_id uuid,
  p_teaching_assignment_id uuid,
  p_day_of_week integer,
  p_start_time time,
  p_end_time time,
  p_room_id uuid,
  p_expected_version_updated_at timestamptz,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_ta public.teaching_assignments%ROWTYPE;
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_guard jsonb;
  v_bundle jsonb;
  v_dg_conflicts jsonb;
  v_session public.schedule_sessions%ROWTYPE;
  v_probe_id uuid := gen_random_uuid();
  v_assigned numeric;
  v_scheduled numeric;
  v_proposed numeric;
  v_blocking_len integer;
  v_warning_len integer;
  v_offering_id uuid;
  v_offering_term_id uuid;
  v_cohort_term_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'stale', false,
      'message_ar', 'يجب تسجيل الدخول.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_schedule_version_id IS NULL OR p_teaching_assignment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ARGS', 'stale', false,
      'message_ar', 'معرّف النسخة والتكليف مطلوبان.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_day_of_week IS NULL OR p_day_of_week < 0 OR p_day_of_week > 6 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_DAY', 'stale', false,
      'message_ar', 'يوم غير صالح.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_start_time IS NULL OR p_end_time IS NULL OR p_end_time <= p_start_time THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TIME_RANGE', 'stale', false,
      'message_ar', 'نطاق الوقت غير صالح.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_room_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROOM_REQUIRED', 'stale', false,
      'message_ar', 'القاعة مطلوبة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  -- Lock version first (concurrency + draft gate)
  SELECT * INTO v_version
  FROM public.schedule_versions
  WHERE id = p_schedule_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'stale', false,
      'message_ar', 'نسخة الجدول غير موجودة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF NOT public.can_manage_college(v_uid, v_version.college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN_COLLEGE', 'stale', false,
      'message_ar', 'لا تملك صلاحية إدارة هذه الكلية.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_version.status IS DISTINCT FROM 'draft' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', CASE
        WHEN v_version.status = 'published' THEN 'VERSION_PUBLISHED'
        WHEN v_version.status = 'archived' THEN 'VERSION_ARCHIVED'
        ELSE 'VERSION_LOCKED'
      END,
      'stale', false,
      'message_ar', 'الإنشاء اليدوي مسموح لنسخ المسودة فقط.',
      'blocking_conflicts', '[]'::jsonb,
      'warnings', '[]'::jsonb
    );
  END IF;

  IF p_expected_version_updated_at IS NULL
     OR v_version.updated_at IS DISTINCT FROM p_expected_version_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_VERSION', 'stale', true,
      'message_ar', 'تغيّرت نسخة الجدول. أعد التحميل ثم حاول مجددًا.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  -- Lock assignment (over-scheduling race protection)
  SELECT * INTO v_ta
  FROM public.teaching_assignments
  WHERE id = p_teaching_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ASSIGNMENT_NOT_FOUND', 'stale', false,
      'message_ar', 'التكليف غير موجود.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_ta.college_id <> v_version.college_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CROSS_COLLEGE_FORBIDDEN', 'stale', false,
      'message_ar', 'التكليف لا ينتمي لنفس كلية النسخة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_ta.delivery_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_V2_ASSIGNMENT', 'stale', false,
      'message_ar', 'هذا المسار مخصص لتكليفات V2 المرتبطة بمجموعة تدريس.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  v_guard := public._sb_v2_assignment_guard(v_ta.id);
  IF COALESCE((v_guard->>'ok')::boolean, false) = false THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', COALESCE(v_guard->>'code', 'ASSIGNMENT_BLOCKED'),
      'stale', false,
      'message_ar', 'التكليف غير قابل للجدولة حاليًا.',
      'blocking_conflicts', '[]'::jsonb,
      'warnings', '[]'::jsonb,
      'guard', v_guard
    );
  END IF;

  SELECT * INTO v_dg
  FROM public.delivery_groups
  WHERE id = v_ta.delivery_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DELIVERY_GROUP_NOT_FOUND', 'stale', false,
      'message_ar', 'مجموعة التدريس غير موجودة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;

  -- Re-validate offering compatibility
  v_offering_id := public.resolve_offering_for_delivery_group(v_dg.id);
  IF v_offering_id IS NULL OR v_offering_id IS DISTINCT FROM v_ta.course_offering_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OFFERING_COMPATIBILITY', 'stale', false,
      'message_ar', 'عرض المقرر غير متوافق مع مجموعة التدريس.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT co.term_id INTO v_offering_term_id
  FROM public.course_offerings co
  WHERE co.id = v_offering_id
    AND co.college_id = v_version.college_id;

  SELECT ac.term_id INTO v_cohort_term_id
  FROM public.academic_cohorts ac
  WHERE ac.id = v_dg.cohort_id
    AND ac.college_id = v_version.college_id;

  IF v_offering_term_id IS DISTINCT FROM v_version.academic_term_id
     OR v_cohort_term_id IS DISTINCT FROM v_version.academic_term_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CROSS_TERM_FORBIDDEN', 'stale', false,
      'message_ar', 'التكليف لا ينتمي إلى الفصل الأكاديمي لنسخة الجدول.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  -- Identity consistency
  IF v_ta.instructor_id IS NULL
     OR v_ta.cohort_id IS DISTINCT FROM v_dg.cohort_id
     OR v_ta.plan_course_component_id IS DISTINCT FROM v_dg.component_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ASSIGNMENT_IDENTITY_MISMATCH', 'stale', false,
      'message_ar', 'عدم تطابق بيانات التكليف مع مجموعة التدريس.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  v_assigned := COALESCE(v_ta.assigned_component_hours, v_pcc.weekly_contact_hours, 0);
  v_proposed := public._sb_v2_wall_hours(p_start_time, p_end_time);
  v_scheduled := public._sb_v2_scheduled_hours_for_assignment(
    p_schedule_version_id, v_ta.id, NULL
  );

  IF v_scheduled + v_proposed > v_assigned THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'OVER_SCHEDULED',
      'stale', false,
      'message_ar', 'تجاوز الساعات المكلف بها لهذا المدرس.',
      'blocking_conflicts', jsonb_build_array(jsonb_build_object(
        'code', 'over_scheduled',
        'severity', 'hard',
        'message_ar', 'تجاوز الساعات المكلف بها.',
        'metadata', jsonb_build_object(
          'assigned_component_hours', v_assigned,
          'currently_scheduled_hours', v_scheduled,
          'proposed_hours', v_proposed
        )
      )),
      'warnings', '[]'::jsonb
    );
  END IF;

  -- Reuse existing conflict helpers (probe id excludes nothing real)
  v_bundle := public._collect_schedule_session_move_conflicts(
    v_probe_id,
    v_version.college_id,
    p_schedule_version_id,
    v_ta.instructor_id,
    v_ta.section_id,
    v_ta.course_offering_id,
    v_ta.id,
    COALESCE(
      (SELECT ac.study_system FROM public.academic_cohorts ac WHERE ac.id = v_dg.cohort_id),
      'regular'
    ),
    COALESCE(v_ta.expected_students, v_dg.expected_students, 0),
    p_day_of_week,
    p_start_time,
    p_end_time,
    p_room_id
  );

  v_dg_conflicts := public._sb_v2_delivery_group_overlap(
    p_schedule_version_id,
    v_dg.id,
    v_dg.cohort_id,
    p_day_of_week,
    p_start_time,
    p_end_time,
    NULL
  );

  IF jsonb_array_length(v_dg_conflicts) > 0 THEN
    v_bundle := jsonb_set(
      v_bundle,
      '{blocking_conflicts}',
      COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb) || v_dg_conflicts
    );
  END IF;

  v_blocking_len := jsonb_array_length(COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb));
  v_warning_len := jsonb_array_length(COALESCE(v_bundle->'warnings', '[]'::jsonb));

  IF v_blocking_len > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'BLOCKED_CONFLICTS',
      'stale', false,
      'message_ar', 'توجد تعارضات مانعة.',
      'blocking_conflicts', v_bundle->'blocking_conflicts',
      'warnings', v_bundle->'warnings',
      'approved_exceptions', v_bundle->'approved_exceptions'
    );
  END IF;

  IF v_warning_len > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'BLOCKED_WARNINGS',
      'stale', false,
      'message_ar', 'توجد تحذيرات غير محلولة. الحفظ غير مسموح حاليًا.',
      'blocking_conflicts', v_bundle->'blocking_conflicts',
      'warnings', v_bundle->'warnings',
      'approved_exceptions', v_bundle->'approved_exceptions'
    );
  END IF;

  INSERT INTO public.schedule_sessions (
    college_id,
    schedule_version_id,
    course_offering_id,
    teaching_assignment_id,
    delivery_group_id,
    cohort_id,
    plan_course_component_id,
    instructor_id,
    section_id,
    room_id,
    day_of_week,
    start_time,
    end_time,
    session_type,
    study_system,
    expected_students,
    source_type
  ) VALUES (
    v_version.college_id,
    p_schedule_version_id,
    v_ta.course_offering_id,
    v_ta.id,
    v_dg.id,
    v_dg.cohort_id,
    v_dg.component_id,
    v_ta.instructor_id,
    v_ta.section_id,
    p_room_id,
    p_day_of_week,
    p_start_time,
    p_end_time,
    COALESCE(v_ta.session_type, 'lecture'),
    COALESCE(
      (SELECT ac.study_system FROM public.academic_cohorts ac WHERE ac.id = v_dg.cohort_id),
      'regular'
    ),
    COALESCE(v_ta.expected_students, v_dg.expected_students, 0),
    'manual'
  )
  RETURNING * INTO v_session;

  -- Bump version updated_at for optimistic concurrency consumers
  UPDATE public.schedule_versions
  SET updated_at = now()
  WHERE id = p_schedule_version_id
  RETURNING * INTO v_version;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    'schedule_session_created_from_assignment',
    'schedule_sessions',
    v_session.id,
    v_version.college_id,
    jsonb_build_object(
      'schedule_session_id', v_session.id,
      'schedule_version_id', p_schedule_version_id,
      'teaching_assignment_id', v_ta.id,
      'delivery_group_id', v_dg.id,
      'instructor_id', v_ta.instructor_id,
      'room_id', p_room_id,
      'day_of_week', p_day_of_week,
      'start_time', p_start_time,
      'end_time', p_end_time,
      'note', NULLIF(btrim(COALESCE(p_note, '')), ''),
      'proposed_hours', v_proposed,
      'assigned_component_hours', v_assigned
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'CREATED',
    'stale', false,
    'session', jsonb_build_object(
      'id', v_session.id,
      'day_of_week', v_session.day_of_week,
      'start_time', v_session.start_time,
      'end_time', v_session.end_time,
      'room_id', v_session.room_id,
      'teaching_assignment_id', v_session.teaching_assignment_id,
      'delivery_group_id', v_session.delivery_group_id,
      'updated_at', v_session.updated_at
    ),
    'schedule_version_updated_at', v_version.updated_at,
    'scheduling_summary', jsonb_build_object(
      'assigned_component_hours', v_assigned,
      'currently_scheduled_hours', v_scheduled + v_proposed,
      'remaining_schedule_hours', GREATEST(0, v_assigned - (v_scheduled + v_proposed)),
      'session_count', (
        SELECT COUNT(*)::integer FROM public.schedule_sessions ss
        WHERE ss.schedule_version_id = p_schedule_version_id
          AND ss.teaching_assignment_id = v_ta.id
      )
    ),
    'blocking_conflicts', '[]'::jsonb,
    'warnings', '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_schedule_session_from_assignment_v2(
  uuid, uuid, integer, time, time, uuid, timestamptz, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_schedule_session_from_assignment_v2(
  uuid, uuid, integer, time, time, uuid, timestamptz, text
) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_schedule_session_from_assignment_v2(
  uuid, uuid, integer, time, time, uuid, timestamptz, text
) IS
  'PHASE-9.5: create one manual draft session from active V2 assignment. Atomic. Conflict reuse. Audit. No generator.';

-- ---------------------------------------------------------------------------
-- 7) Hardened ensure_ss_college (preserve legacy; tighten V2 inserts/link changes)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_ss_college()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
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
      FROM public.delivery_groups dg
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
      SELECT pcc.component_type INTO pcc_type
      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;
      IF pcc_type = 'summer_training' THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF pcc_type = 'project' THEN
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
    FROM public.delivery_groups dg
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
      SELECT pcc.component_type INTO pcc_type
      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;
      IF pcc_type = 'summer_training' THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF pcc_type = 'project' THEN
        RAISE EXCEPTION 'PROJECT_STANDARD_WEEKLY_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_ss_college() IS
  'PHASE-9.5: college integrity + V2 inactive/obsolete/summer/project/mismatch guards on new/changed links. Legacy unrelated updates preserved.';

-- ---------------------------------------------------------------------------
-- 8) Wrap move/validate with V2 activity + over-schedule + DG overlap
--     External signatures unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_schedule_session_move(
  p_session_id uuid,
  p_expected_updated_at timestamptz,
  p_target_day_of_week integer,
  p_target_start_time time,
  p_target_end_time time,
  p_target_room_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.schedule_sessions%ROWTYPE;
  v_version_status text;
  v_bundle jsonb;
  v_guard jsonb;
  v_dg_conflicts jsonb;
  v_assigned numeric;
  v_scheduled numeric;
  v_proposed numeric;
  v_blocking_len integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'code', 'UNAUTHORIZED', 'stale', false,
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb, 'approved_exceptions', '[]'::jsonb,
      'normalized_proposal', NULL);
  END IF;

  SELECT * INTO v_session FROM public.schedule_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'code', 'NOT_FOUND', 'stale', false,
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb, 'approved_exceptions', '[]'::jsonb,
      'normalized_proposal', NULL);
  END IF;

  IF NOT public.can_manage_college(v_uid, v_session.college_id) THEN
    RETURN jsonb_build_object('valid', false, 'code', 'FORBIDDEN_COLLEGE', 'stale', false,
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb, 'approved_exceptions', '[]'::jsonb,
      'normalized_proposal', NULL);
  END IF;

  SELECT status INTO v_version_status
  FROM public.schedule_versions WHERE id = v_session.schedule_version_id;
  IF v_version_status IN ('published', 'archived') THEN
    RETURN jsonb_build_object('valid', false, 'code', 'VERSION_LOCKED', 'stale', false,
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb, 'approved_exceptions', '[]'::jsonb,
      'normalized_proposal', NULL);
  END IF;

  IF p_expected_updated_at IS NULL OR v_session.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('valid', false, 'code', 'STALE_SESSION', 'stale', true,
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb, 'approved_exceptions', '[]'::jsonb,
      'normalized_proposal', NULL);
  END IF;

  IF v_session.teaching_assignment_id IS NOT NULL THEN
    v_guard := public._sb_v2_assignment_guard(v_session.teaching_assignment_id);
    IF COALESCE((v_guard->>'is_v2')::boolean, false)
       AND COALESCE((v_guard->>'ok')::boolean, false) = false THEN
      RETURN jsonb_build_object(
        'valid', false,
        'code', COALESCE(v_guard->>'code', 'ASSIGNMENT_BLOCKED'),
        'stale', false,
        'message_ar', 'تكليف V2 غير نشط أو محظور؛ لا يمكن تحريك الجلسة.',
        'blocking_conflicts', '[]'::jsonb,
        'warnings', '[]'::jsonb,
        'approved_exceptions', '[]'::jsonb,
        'normalized_proposal', NULL
      );
    END IF;

    IF COALESCE((v_guard->>'is_v2')::boolean, false) THEN
      SELECT COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0)
        INTO v_assigned
      FROM public.teaching_assignments ta
      LEFT JOIN public.plan_course_components pcc ON pcc.id = ta.plan_course_component_id
      WHERE ta.id = v_session.teaching_assignment_id;
      v_proposed := public._sb_v2_wall_hours(p_target_start_time, p_target_end_time);
      v_scheduled := public._sb_v2_scheduled_hours_for_assignment(
        v_session.schedule_version_id, v_session.teaching_assignment_id, v_session.id
      );
      IF v_scheduled + v_proposed > v_assigned THEN
        RETURN jsonb_build_object(
          'valid', false,
          'code', 'OVER_SCHEDULED',
          'stale', false,
          'message_ar', 'تجاوز الساعات المكلف بها.',
          'blocking_conflicts', jsonb_build_array(jsonb_build_object(
            'code', 'over_scheduled', 'severity', 'hard',
            'message_ar', 'تجاوز الساعات المكلف بها.'
          )),
          'warnings', '[]'::jsonb,
          'approved_exceptions', '[]'::jsonb,
          'normalized_proposal', NULL
        );
      END IF;
    END IF;
  END IF;

  v_bundle := public._collect_schedule_session_move_conflicts(
    v_session.id,
    v_session.college_id,
    v_session.schedule_version_id,
    v_session.instructor_id,
    v_session.section_id,
    v_session.course_offering_id,
    v_session.teaching_assignment_id,
    v_session.study_system,
    v_session.expected_students,
    p_target_day_of_week,
    p_target_start_time,
    p_target_end_time,
    p_target_room_id
  );

  IF v_session.delivery_group_id IS NOT NULL THEN
    v_dg_conflicts := public._sb_v2_delivery_group_overlap(
      v_session.schedule_version_id,
      v_session.delivery_group_id,
      v_session.cohort_id,
      p_target_day_of_week,
      p_target_start_time,
      p_target_end_time,
      v_session.id
    );
    IF jsonb_array_length(v_dg_conflicts) > 0 THEN
      v_bundle := jsonb_set(
        v_bundle,
        '{blocking_conflicts}',
        COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb) || v_dg_conflicts
      );
    END IF;
  END IF;

  v_blocking_len := jsonb_array_length(COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb));

  RETURN jsonb_build_object(
    'valid', v_blocking_len = 0 AND jsonb_array_length(COALESCE(v_bundle->'warnings', '[]'::jsonb)) = 0,
    'code', CASE WHEN v_blocking_len > 0 THEN 'BLOCKED_CONFLICTS' ELSE NULL END,
    'stale', false,
    'blocking_conflicts', COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb),
    'warnings', COALESCE(v_bundle->'warnings', '[]'::jsonb),
    'approved_exceptions', COALESCE(v_bundle->'approved_exceptions', '[]'::jsonb),
    'normalized_proposal', jsonb_build_object(
      'day_of_week', p_target_day_of_week,
      'start_time', p_target_start_time,
      'end_time', p_target_end_time,
      'room_id', p_target_room_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.move_or_reschedule_schedule_session(
  p_session_id uuid,
  p_expected_updated_at timestamptz,
  p_target_day_of_week integer,
  p_target_start_time time,
  p_target_end_time time,
  p_target_room_id uuid,
  p_change_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session public.schedule_sessions%ROWTYPE;
  v_version_status text;
  v_bundle jsonb;
  v_guard jsonb;
  v_dg_conflicts jsonb;
  v_before jsonb;
  v_after jsonb;
  v_blocking_len integer;
  v_warning_len integer;
  v_assigned numeric;
  v_scheduled numeric;
  v_proposed numeric;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'stale', false,
      'message_ar', 'يجب تسجيل الدخول.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_target_day_of_week IS NULL OR p_target_day_of_week < 0 OR p_target_day_of_week > 6 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_DAY', 'stale', false,
      'message_ar', 'يوم غير صالح.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_target_start_time IS NULL OR p_target_end_time IS NULL OR p_target_end_time <= p_target_start_time THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TIME_RANGE', 'stale', false,
      'message_ar', 'نطاق الوقت غير صالح.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT * INTO v_session
  FROM public.schedule_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'stale', false,
      'message_ar', 'الجلسة غير موجودة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF NOT public.can_manage_college(v_uid, v_session.college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN_COLLEGE', 'stale', false,
      'message_ar', 'لا تملك صلاحية إدارة هذه الكلية.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT status INTO v_version_status
  FROM public.schedule_versions
  WHERE id = v_session.schedule_version_id
  FOR UPDATE;

  IF v_version_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'stale', false,
      'message_ar', 'نسخة الجدول غير موجودة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_version_status IN ('published', 'archived') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_LOCKED', 'stale', false,
      'message_ar', 'هذه النسخة غير قابلة للتعديل.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF COALESCE(v_session.is_locked, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SESSION_LOCKED', 'stale', false,
      'message_ar', 'هذه الجلسة مقفلة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_expected_updated_at IS NULL OR v_session.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_SESSION', 'stale', true,
      'message_ar', 'تغيّرت الجلسة من تحميلها. أعد التحميل ثم حاول مجددًا.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_session.day_of_week = p_target_day_of_week
     AND v_session.start_time = p_target_start_time
     AND v_session.end_time = p_target_end_time
     AND v_session.room_id IS NOT DISTINCT FROM p_target_room_id
  THEN
    RETURN jsonb_build_object(
      'ok', true,
      'code', 'NOOP',
      'stale', false,
      'session', jsonb_build_object(
        'id', v_session.id,
        'day_of_week', v_session.day_of_week,
        'start_time', v_session.start_time,
        'end_time', v_session.end_time,
        'room_id', v_session.room_id,
        'updated_at', v_session.updated_at
      ),
      'blocking_conflicts', '[]'::jsonb,
      'warnings', '[]'::jsonb
    );
  END IF;

  IF v_session.teaching_assignment_id IS NOT NULL THEN
    -- Lock assignment for race-safe over-schedule recheck
    PERFORM 1 FROM public.teaching_assignments
      WHERE id = v_session.teaching_assignment_id FOR UPDATE;

    v_guard := public._sb_v2_assignment_guard(v_session.teaching_assignment_id);
    IF COALESCE((v_guard->>'is_v2')::boolean, false)
       AND COALESCE((v_guard->>'ok')::boolean, false) = false THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', COALESCE(v_guard->>'code', 'ASSIGNMENT_BLOCKED'),
        'stale', false,
        'message_ar', 'تكليف V2 غير نشط أو محظور؛ لا يمكن تحريك الجلسة.',
        'blocking_conflicts', '[]'::jsonb,
        'warnings', '[]'::jsonb
      );
    END IF;

    IF COALESCE((v_guard->>'is_v2')::boolean, false) THEN
      SELECT COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0)
        INTO v_assigned
      FROM public.teaching_assignments ta
      LEFT JOIN public.plan_course_components pcc ON pcc.id = ta.plan_course_component_id
      WHERE ta.id = v_session.teaching_assignment_id;
      v_proposed := public._sb_v2_wall_hours(p_target_start_time, p_target_end_time);
      v_scheduled := public._sb_v2_scheduled_hours_for_assignment(
        v_session.schedule_version_id, v_session.teaching_assignment_id, v_session.id
      );
      IF v_scheduled + v_proposed > v_assigned THEN
        RETURN jsonb_build_object(
          'ok', false,
          'code', 'OVER_SCHEDULED',
          'stale', false,
          'message_ar', 'تجاوز الساعات المكلف بها.',
          'blocking_conflicts', jsonb_build_array(jsonb_build_object(
            'code', 'over_scheduled', 'severity', 'hard',
            'message_ar', 'تجاوز الساعات المكلف بها.'
          )),
          'warnings', '[]'::jsonb
        );
      END IF;
    END IF;
  END IF;

  v_bundle := public._collect_schedule_session_move_conflicts(
    v_session.id,
    v_session.college_id,
    v_session.schedule_version_id,
    v_session.instructor_id,
    v_session.section_id,
    v_session.course_offering_id,
    v_session.teaching_assignment_id,
    v_session.study_system,
    v_session.expected_students,
    p_target_day_of_week,
    p_target_start_time,
    p_target_end_time,
    p_target_room_id
  );

  IF v_session.delivery_group_id IS NOT NULL THEN
    v_dg_conflicts := public._sb_v2_delivery_group_overlap(
      v_session.schedule_version_id,
      v_session.delivery_group_id,
      v_session.cohort_id,
      p_target_day_of_week,
      p_target_start_time,
      p_target_end_time,
      v_session.id
    );
    IF jsonb_array_length(v_dg_conflicts) > 0 THEN
      v_bundle := jsonb_set(
        v_bundle,
        '{blocking_conflicts}',
        COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb) || v_dg_conflicts
      );
    END IF;
  END IF;

  v_blocking_len := jsonb_array_length(COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb));
  v_warning_len := jsonb_array_length(COALESCE(v_bundle->'warnings', '[]'::jsonb));

  IF v_blocking_len > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'BLOCKED_CONFLICTS',
      'stale', false,
      'message_ar', 'توجد تعارضات مانعة. لم يُحفظ التغيير.',
      'blocking_conflicts', v_bundle->'blocking_conflicts',
      'warnings', v_bundle->'warnings',
      'approved_exceptions', v_bundle->'approved_exceptions'
    );
  END IF;

  IF v_warning_len > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'BLOCKED_WARNINGS',
      'stale', false,
      'message_ar', 'توجد تحذيرات غير محلولة. الحفظ غير مسموح حاليًا.',
      'blocking_conflicts', v_bundle->'blocking_conflicts',
      'warnings', v_bundle->'warnings',
      'approved_exceptions', v_bundle->'approved_exceptions'
    );
  END IF;

  v_before := jsonb_build_object(
    'day_of_week', v_session.day_of_week,
    'start_time', v_session.start_time,
    'end_time', v_session.end_time,
    'room_id', v_session.room_id,
    'updated_at', v_session.updated_at
  );

  UPDATE public.schedule_sessions
  SET
    day_of_week = p_target_day_of_week,
    start_time = p_target_start_time,
    end_time = p_target_end_time,
    room_id = p_target_room_id
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  v_after := jsonb_build_object(
    'day_of_week', v_session.day_of_week,
    'start_time', v_session.start_time,
    'end_time', v_session.end_time,
    'room_id', v_session.room_id,
    'updated_at', v_session.updated_at
  );

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    'move_or_reschedule',
    'schedule_sessions',
    p_session_id,
    v_session.college_id,
    jsonb_build_object(
      'before', v_before,
      'after', v_after,
      'change_reason', NULLIF(btrim(COALESCE(p_change_reason, '')), ''),
      'approved_exceptions', COALESCE(v_bundle->'approved_exceptions', '[]'::jsonb)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'SAVED',
    'stale', false,
    'session', v_after || jsonb_build_object('id', p_session_id),
    'blocking_conflicts', '[]'::jsonb,
    'warnings', '[]'::jsonb,
    'approved_exceptions', COALESCE(v_bundle->'approved_exceptions', '[]'::jsonb)
  );
END;
$$;

COMMIT;

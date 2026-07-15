-- PHASE-6: Clean Schedule Builder UAT fixture (SOURCE ONLY — do not auto-apply).
-- Marker: SCHEDULE_BUILDER_PHASE6_UAT
-- Creates at most: 1 section, 1 offering↔link, 1 draft version, 1 source session.
-- Does NOT create section_subgroups, does NOT call the capacity-split approve RPC, does NOT publish.
-- Selects master context at apply time (migration executor). Idempotent on fixed UAT IDs.

BEGIN;

DO $$
DECLARE
  c_marker constant text := 'SCHEDULE_BUILDER_PHASE6_UAT';
  c_version_name constant text := 'UAT — Schedule Builder Phase 6';
  c_section_number constant text := 'UAT-SB-P6';

  -- Fixed UAT entity IDs (idempotent)
  c_section_id constant uuid := '6a015200-0001-4000-8000-000000000001';
  c_cos_id     constant uuid := '6a015200-0001-4000-8000-000000000002';
  c_version_id constant uuid := '6a015200-0001-4000-8000-000000000003';
  c_session_id constant uuid := '6a015200-0001-4000-8000-000000000004';

  v_college_id uuid;
  v_term_id uuid;
  v_course_id uuid;
  v_course_code text;
  v_course_name text;
  v_department_id uuid;
  v_department_name text;
  v_program_id uuid;
  v_program_name text;
  v_offering_id uuid;
  v_ta_id uuid;
  v_instructor_id uuid;
  v_instructor_name text;
  v_session_type text;
  v_required_room_type text;
  v_study_system text;
  v_room_id uuid;
  v_room_code text;
  v_room_type text;
  v_room_capacity integer;
  v_expected integer;
  v_threshold integer;
  v_groups integer;
  v_group_sizes integer[];
  v_prev_expected integer;
  v_prev_status text;
  v_prev_updated timestamptz;
  v_prev_ta_section_id uuid;
  v_prev_ta_section_number text;
  v_executed_at timestamptz := clock_timestamp();
BEGIN
  -- Idempotent success if fixture already fully present with marker
  IF EXISTS (
    SELECT 1 FROM public.schedule_versions
    WHERE id = c_version_id AND notes = c_marker AND name = c_version_name AND status = 'draft'
  ) AND EXISTS (
    SELECT 1 FROM public.schedule_sessions WHERE id = c_session_id AND schedule_version_id = c_version_id
  ) AND EXISTS (
    SELECT 1 FROM public.sections WHERE id = c_section_id AND section_number = c_section_number
  ) THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (
      NULL,
      c_marker,
      'schedule_versions',
      c_version_id,
      (SELECT college_id FROM public.schedule_versions WHERE id = c_version_id),
      jsonb_build_object(
        'operation', c_marker,
        'phase', 'create',
        'result', 'idempotent_noop',
        'actor', 'migration_executor',
        'executed_at', v_executed_at
      )
    );
    RAISE NOTICE 'UAT fixture already present — idempotent noop';
    RETURN;
  END IF;

  -- Reject conflicting leftover UAT-named rows without our fixed IDs/marker
  IF EXISTS (
    SELECT 1 FROM public.schedule_versions
    WHERE name = c_version_name AND (id <> c_version_id OR coalesce(notes, '') <> c_marker)
  ) THEN
    RAISE EXCEPTION 'UAT_FIXTURE_CONFLICT'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.sections WHERE id = c_section_id)
     OR EXISTS (SELECT 1 FROM public.schedule_versions WHERE id = c_version_id)
     OR EXISTS (SELECT 1 FROM public.schedule_sessions WHERE id = c_session_id) THEN
    RAISE EXCEPTION 'UAT_FIXTURE_CONFLICT'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Prefer documented forensic course CY-L1-004 + lecture TA + lecture_hall room;
  -- fallback: first complete lecture/lab chain with matching active room.
  SELECT
    ta.college_id,
    co.term_id,
    co.course_id,
    c.code,
    c.name,
    c.department_id,
    d.name,
    co.program_id,
    p.name,
    co.id,
    ta.id,
    ta.instructor_id,
    i.full_name,
    ta.session_type,
    coalesce(nullif(ta.required_room_type, ''), CASE WHEN ta.session_type = 'lab' THEN 'computer_lab' ELSE 'lecture_hall' END),
    coalesce(co.study_system, 'regular')
  INTO
    v_college_id, v_term_id, v_course_id, v_course_code, v_course_name,
    v_department_id, v_department_name, v_program_id, v_program_name,
    v_offering_id, v_ta_id, v_instructor_id, v_instructor_name,
    v_session_type, v_required_room_type, v_study_system
  FROM public.teaching_assignments ta
  JOIN public.course_offerings co ON co.id = ta.course_offering_id
  JOIN public.courses c ON c.id = co.course_id
  JOIN public.instructors i ON i.id = ta.instructor_id
  LEFT JOIN public.departments d ON d.id = c.department_id
  LEFT JOIN public.academic_programs p ON p.id = co.program_id
  WHERE ta.session_type IN ('lecture', 'lab')
    AND co.is_active IS DISTINCT FROM false
    AND c.department_id IS NOT NULL
    AND co.program_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.college_id = ta.college_id
        AND r.is_active = true
        AND r.capacity > 0
        AND r.room_type = coalesce(nullif(ta.required_room_type, ''), CASE WHEN ta.session_type = 'lab' THEN 'computer_lab' ELSE 'lecture_hall' END)
    )
  ORDER BY
    CASE WHEN c.code = 'CY-L1-004' AND ta.session_type = 'lecture' THEN 0 ELSE 1 END,
    CASE WHEN ta.session_type = 'lecture' THEN 0 ELSE 1 END,
    CASE WHEN coalesce(ta.required_room_type, '') IN ('lecture_hall', 'computer_lab') THEN 0 ELSE 1 END,
    ta.created_at NULLS LAST,
    ta.id
  LIMIT 1;

  IF v_ta_id IS NULL OR v_offering_id IS NULL THEN
    RAISE EXCEPTION 'CLEAN_UAT_MASTER_CONTEXT_INCOMPLETE'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT r.id, r.code, r.room_type, r.capacity
  INTO v_room_id, v_room_code, v_room_type, v_room_capacity
  FROM public.rooms r
  WHERE r.college_id = v_college_id
    AND r.is_active = true
    AND r.capacity > 0
    AND r.room_type = v_required_room_type
  ORDER BY
    CASE WHEN r.code = 'Q1' THEN 0 ELSE 1 END,
    CASE WHEN r.capacity BETWEEN 30 AND 60 THEN 0 ELSE 1 END,
    r.capacity ASC,
    r.code,
    r.id
  LIMIT 1;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'CLEAN_UAT_MASTER_CONTEXT_INCOMPLETE'
      USING ERRCODE = 'check_violation';
  END IF;

  -- expected_students = 2 * (capacity + 5) → clear two balanced groups, always > capacity+5
  v_threshold := v_room_capacity + 5;
  v_expected := 2 * v_threshold;
  v_groups := 2;
  v_group_sizes := ARRAY[v_threshold, v_threshold];

  SELECT co.expected_students, co.enrollment_count_status, co.enrollment_count_updated_at
  INTO v_prev_expected, v_prev_status, v_prev_updated
  FROM public.course_offerings co
  WHERE co.id = v_offering_id;

  SELECT ta.section_id, ta.section_number
  INTO v_prev_ta_section_id, v_prev_ta_section_number
  FROM public.teaching_assignments ta
  WHERE ta.id = v_ta_id;

  -- 1) UAT section
  INSERT INTO public.sections (
    id, college_id, course_id, term_id, section_number, capacity, study_system
  ) VALUES (
    c_section_id, v_college_id, v_course_id, v_term_id, c_section_number,
    v_room_capacity, v_study_system
  );

  -- 2) Offering↔section link
  INSERT INTO public.course_offering_sections (
    id, college_id, course_offering_id, section_id, expected_students, section_number
  ) VALUES (
    c_cos_id, v_college_id, v_offering_id, c_section_id, v_expected, c_section_number
  );

  -- Point TA at UAT section (nullable column; restore null on cleanup if was null)
  UPDATE public.teaching_assignments
  SET section_id = c_section_id,
      section_number = c_section_number
  WHERE id = v_ta_id;

  -- 3) Draft schedule version
  INSERT INTO public.schedule_versions (
    id, college_id, academic_term_id, name, status, notes
  ) VALUES (
    c_version_id, v_college_id, v_term_id, c_version_name, 'draft', c_marker
  );

  -- 4) Enrollment confirmed for UAT only
  UPDATE public.course_offerings
  SET expected_students = v_expected,
      enrollment_count_status = 'confirmed',
      enrollment_count_updated_at = v_executed_at
  WHERE id = v_offering_id;

  -- 5) Single source session
  INSERT INTO public.schedule_sessions (
    id, college_id, schedule_version_id, course_offering_id, teaching_assignment_id,
    instructor_id, room_id, section_id, day_of_week, start_time, end_time,
    session_type, study_system, expected_students, source_type, replaced_by_split, is_locked
  ) VALUES (
    c_session_id, v_college_id, c_version_id, v_offering_id, v_ta_id,
    v_instructor_id, v_room_id, c_section_id, 0, '08:00'::time, '10:00'::time,
    v_session_type, v_study_system, v_expected, 'manual', false, false
  );

  -- Guard: exactly one session on this version; no subgroups created
  IF (SELECT COUNT(*) FROM public.schedule_sessions WHERE schedule_version_id = c_version_id) <> 1 THEN
    RAISE EXCEPTION 'UAT_FIXTURE_SESSION_COUNT_INVALID'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.section_subgroups WHERE section_id = c_section_id
  ) THEN
    RAISE EXCEPTION 'UAT_FIXTURE_UNEXPECTED_SUBGROUPS'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (SELECT status FROM public.schedule_versions WHERE id = c_version_id) <> 'draft' THEN
    RAISE EXCEPTION 'UAT_FIXTURE_NOT_DRAFT'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    NULL,
    c_marker,
    'schedule_versions',
    c_version_id,
    v_college_id,
    jsonb_build_object(
      'operation', c_marker,
      'phase', 'create',
      'result', 'success',
      'actor', 'migration_executor',
      'owner_confirmed_uat_only', true,
      'enrollment_confirmed_for_uat_only', true,
      'ids', jsonb_build_object(
        'section_id', c_section_id,
        'course_offering_section_id', c_cos_id,
        'schedule_version_id', c_version_id,
        'schedule_session_id', c_session_id,
        'course_offering_id', v_offering_id,
        'teaching_assignment_id', v_ta_id,
        'instructor_id', v_instructor_id,
        'room_id', v_room_id,
        'course_id', v_course_id,
        'program_id', v_program_id,
        'department_id', v_department_id,
        'college_id', v_college_id,
        'term_id', v_term_id
      ),
      'labels', jsonb_build_object(
        'version_name', c_version_name,
        'section_number', c_section_number,
        'course_code', v_course_code,
        'course_name', v_course_name,
        'program_name', v_program_name,
        'department_name', v_department_name,
        'instructor_name', v_instructor_name,
        'room_code', v_room_code,
        'room_type', v_room_type,
        'session_type', v_session_type,
        'required_room_type', v_required_room_type
      ),
      'enrollment_previous', jsonb_build_object(
        'expected_students', v_prev_expected,
        'enrollment_count_status', v_prev_status,
        'enrollment_count_updated_at', v_prev_updated
      ),
      'teaching_assignment_previous', jsonb_build_object(
        'section_id', v_prev_ta_section_id,
        'section_number', v_prev_ta_section_number
      ),
      'enrollment_uat', jsonb_build_object(
        'expected_students', v_expected,
        'enrollment_count_status', 'confirmed',
        'enrollment_count_updated_at', v_executed_at,
        'capacity', v_room_capacity,
        'threshold_capacity_plus_5', v_threshold,
        'proposed_groups', v_groups,
        'proposed_group_sizes', to_jsonb(v_group_sizes)
      ),
      'created_counts', jsonb_build_object(
        'sections', 1,
        'course_offering_sections', 1,
        'schedule_versions', 1,
        'schedule_sessions', 1,
        'section_subgroups', 0
      ),
      'executed_at', v_executed_at
    )
  );

  RAISE NOTICE 'UAT fixture created version=% session=% room=% expected=%',
    c_version_id, c_session_id, v_room_code, v_expected;
END $$;

COMMIT;

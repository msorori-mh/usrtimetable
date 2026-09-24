-- PHASE-6: Isolated Schedule Builder UAT chain
BEGIN;

DO $$
DECLARE
  c_marker constant text := 'SCHEDULE_BUILDER_PHASE6_ISOLATED_UAT';
  c_version_name constant text := 'UAT — Schedule Builder Phase 6';
  c_section_number constant text := 'UAT-ISO-P6';

  c_offering_id constant uuid := '6a015203-0001-4000-8000-000000000001';
  c_ta_id       constant uuid := '6a015203-0001-4000-8000-000000000002';
  c_section_id  constant uuid := '6a015203-0001-4000-8000-000000000003';
  c_cos_id      constant uuid := '6a015203-0001-4000-8000-000000000004';
  c_version_id  constant uuid := '6a015203-0001-4000-8000-000000000005';
  c_session_id  constant uuid := '6a015203-0001-4000-8000-000000000006';

  v_term_id uuid;
  v_term_name text;
  v_college_id uuid;
  v_course_id uuid;
  v_course_code text;
  v_course_name text;
  v_department_id uuid;
  v_department_name text;
  v_program_id uuid;
  v_program_name text;
  v_instructor_id uuid;
  v_instructor_name text;
  v_session_type text := 'lecture';
  v_required_room_type text := 'lecture_hall';
  v_study_system text := 'regular';
  v_room_id uuid;
  v_room_code text;
  v_room_type text;
  v_room_capacity integer;
  v_threshold integer;
  v_expected integer;
  v_groups integer := 2;
  v_group_sizes integer[];
  v_executed_at timestamptz := clock_timestamp();
  v_present integer;
BEGIN
  SELECT (
    (SELECT COUNT(*) FROM public.course_offerings WHERE id = c_offering_id) +
    (SELECT COUNT(*) FROM public.teaching_assignments WHERE id = c_ta_id) +
    (SELECT COUNT(*) FROM public.sections WHERE id = c_section_id) +
    (SELECT COUNT(*) FROM public.course_offering_sections WHERE id = c_cos_id) +
    (SELECT COUNT(*) FROM public.schedule_versions WHERE id = c_version_id) +
    (SELECT COUNT(*) FROM public.schedule_sessions WHERE id = c_session_id)
  )::integer INTO v_present;

  IF v_present = 6
     AND EXISTS (SELECT 1 FROM public.schedule_versions WHERE id = c_version_id AND notes = c_marker AND name = c_version_name AND status = 'draft')
     AND EXISTS (SELECT 1 FROM public.course_offerings WHERE id = c_offering_id AND notes = c_marker) THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (NULL, c_marker, 'schedule_versions', c_version_id,
      (SELECT college_id FROM public.schedule_versions WHERE id = c_version_id),
      jsonb_build_object('operation', c_marker, 'phase', 'create', 'result', 'idempotent_noop', 'actor', 'migration_executor', 'executed_at', v_executed_at));
    RAISE NOTICE 'Isolated UAT fixture already present — idempotent noop';
    RETURN;
  END IF;

  IF v_present > 0 AND v_present < 6 THEN
    RAISE EXCEPTION 'UAT_FIXTURE_PARTIAL_STATE_FOUND' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.schedule_versions WHERE name = c_version_name AND (id <> c_version_id OR coalesce(notes, '') <> c_marker)) THEN
    RAISE EXCEPTION 'UAT_FIXTURE_MARKER_CONFLICT' USING ERRCODE = 'check_violation';
  END IF;

  SELECT t.id, t.name, t.college_id
  INTO v_term_id, v_term_name, v_college_id
  FROM public.academic_terms t
  WHERE EXISTS (SELECT 1 FROM public.courses c WHERE c.college_id = t.college_id AND c.department_id IS NOT NULL)
    AND EXISTS (SELECT 1 FROM public.instructors i WHERE i.college_id = t.college_id AND i.is_active IS DISTINCT FROM false)
    AND EXISTS (SELECT 1 FROM public.rooms r WHERE r.college_id = t.college_id AND r.is_active = true AND r.capacity > 0 AND r.room_type = 'lecture_hall')
  ORDER BY t.is_active DESC, t.start_date DESC NULLS LAST, t.created_at DESC NULLS LAST, t.id
  LIMIT 1;

  IF v_term_id IS NULL THEN
    RAISE EXCEPTION 'ISOLATED_UAT_MASTER_CHAIN_INCOMPLETE' USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.id, c.code, c.name, c.department_id, d.name
  INTO v_course_id, v_course_code, v_course_name, v_department_id, v_department_name
  FROM public.courses c
  LEFT JOIN public.departments d ON d.id = c.department_id
  WHERE c.college_id = v_college_id AND c.department_id IS NOT NULL
  ORDER BY CASE WHEN c.code = 'CY-L1-004' THEN 0 ELSE 1 END, c.code, c.id
  LIMIT 1;

  SELECT p.id, p.name
  INTO v_program_id, v_program_name
  FROM public.academic_programs p
  WHERE p.college_id = v_college_id
    AND (v_department_id IS NULL OR p.department_id = v_department_id OR p.department_id IS NOT NULL)
  ORDER BY CASE WHEN p.department_id = v_department_id THEN 0 ELSE 1 END, p.code, p.id
  LIMIT 1;

  SELECT i.id, i.full_name
  INTO v_instructor_id, v_instructor_name
  FROM public.instructors i
  WHERE i.college_id = v_college_id AND i.is_active IS DISTINCT FROM false
  ORDER BY CASE WHEN i.id = 'fc4a0d70-7dba-4fc1-8726-26f207ed1ff2'::uuid THEN 0 ELSE 1 END, i.full_name, i.id
  LIMIT 1;

  SELECT r.id, r.code, r.room_type, r.capacity
  INTO v_room_id, v_room_code, v_room_type, v_room_capacity
  FROM public.rooms r
  WHERE r.college_id = v_college_id AND r.is_active = true AND r.capacity > 0 AND r.room_type = v_required_room_type
  ORDER BY CASE WHEN r.code = 'Q1' THEN 0 ELSE 1 END,
           CASE WHEN r.capacity BETWEEN 30 AND 60 THEN 0 ELSE 1 END,
           r.capacity ASC, r.code, r.id
  LIMIT 1;

  IF v_course_id IS NULL OR v_instructor_id IS NULL OR v_room_id IS NULL THEN
    RAISE EXCEPTION 'ISOLATED_UAT_MASTER_CHAIN_INCOMPLETE' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.academic_terms t
    JOIN public.courses c ON c.id = v_course_id AND c.college_id = t.college_id
    JOIN public.rooms r ON r.id = v_room_id AND r.college_id = t.college_id
    JOIN public.instructors i ON i.id = v_instructor_id AND i.college_id = t.college_id
    WHERE t.id = v_term_id
  ) THEN
    RAISE EXCEPTION 'ISOLATED_UAT_MASTER_CHAIN_INCOMPLETE' USING ERRCODE = 'check_violation';
  END IF;

  v_threshold := v_room_capacity + 5;
  v_expected := 2 * v_threshold;
  v_group_sizes := ARRAY[v_threshold, v_threshold];

  INSERT INTO public.course_offerings (
    id, college_id, term_id, course_id, program_id, study_system, status,
    expected_students, enrollment_count_status, enrollment_count_updated_at,
    is_active, notes
  ) VALUES (
    c_offering_id, v_college_id, v_term_id, v_course_id, v_program_id, v_study_system, 'draft',
    v_expected, 'confirmed', v_executed_at, true, c_marker
  );

  INSERT INTO public.teaching_assignments (
    id, college_id, course_offering_id, instructor_id, session_type,
    required_room_type, weekly_hours, expected_students, section_id, section_number, notes
  ) VALUES (
    c_ta_id, v_college_id, c_offering_id, v_instructor_id, v_session_type,
    v_required_room_type, 2, v_expected, NULL, NULL, c_marker
  );

  INSERT INTO public.sections (
    id, college_id, course_id, term_id, section_number, capacity, study_system
  ) VALUES (
    c_section_id, v_college_id, v_course_id, v_term_id, c_section_number, v_room_capacity, v_study_system
  );

  INSERT INTO public.course_offering_sections (
    id, college_id, course_offering_id, section_id, expected_students, section_number
  ) VALUES (
    c_cos_id, v_college_id, c_offering_id, c_section_id, v_expected, c_section_number
  );

  UPDATE public.teaching_assignments
  SET section_id = c_section_id, section_number = c_section_number
  WHERE id = c_ta_id;

  INSERT INTO public.schedule_versions (
    id, college_id, academic_term_id, name, status, notes
  ) VALUES (
    c_version_id, v_college_id, v_term_id, c_version_name, 'draft', c_marker
  );

  INSERT INTO public.schedule_sessions (
    id, college_id, schedule_version_id, course_offering_id, teaching_assignment_id,
    instructor_id, room_id, section_id, day_of_week, start_time, end_time,
    session_type, study_system, expected_students, source_type,
    replaced_by_split, section_subgroup_id, split_source_session_id, is_locked
  ) VALUES (
    c_session_id, v_college_id, c_version_id, c_offering_id, c_ta_id,
    v_instructor_id, v_room_id, c_section_id, 0, '08:00'::time, '10:00'::time,
    v_session_type, v_study_system, v_expected, 'manual',
    false, NULL, NULL, false
  );

  IF (SELECT COUNT(*) FROM public.schedule_sessions WHERE schedule_version_id = c_version_id) <> 1 THEN
    RAISE EXCEPTION 'UAT_FIXTURE_SESSION_COUNT_INVALID' USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.section_subgroups WHERE section_id = c_section_id) THEN
    RAISE EXCEPTION 'UAT_FIXTURE_UNEXPECTED_SUBGROUPS' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.course_offerings co
    JOIN public.academic_terms t ON t.id = co.term_id
    WHERE co.id = c_offering_id AND t.college_id = co.college_id
  ) THEN
    RAISE EXCEPTION 'UAT_FIXTURE_TERM_REFERENCE_INVALID' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    NULL, c_marker, 'schedule_versions', c_version_id, v_college_id,
    jsonb_build_object(
      'operation', c_marker, 'marker', c_marker, 'phase', 'create', 'result', 'success',
      'actor', 'migration_executor', 'uses_legacy_offering', false,
      'academic_term_id', v_term_id, 'college_id', v_college_id, 'course_id', v_course_id,
      'course_offering_id', c_offering_id, 'teaching_assignment_id', c_ta_id,
      'instructor_id', v_instructor_id, 'section_id', c_section_id,
      'course_offering_section_id', c_cos_id, 'schedule_version_id', c_version_id,
      'schedule_session_id', c_session_id, 'room_id', v_room_id,
      'room_code', v_room_code, 'room_type', v_room_type, 'room_capacity', v_room_capacity,
      'expected_students', v_expected, 'enrollment_count_status', 'confirmed',
      'threshold', v_threshold, 'proposed_groups_count', v_groups,
      'proposed_group_sizes', to_jsonb(v_group_sizes),
      'labels', jsonb_build_object(
        'term_name', v_term_name, 'course_code', v_course_code, 'course_name', v_course_name,
        'department_name', v_department_name, 'program_name', v_program_name,
        'instructor_name', v_instructor_name, 'version_name', c_version_name,
        'section_number', c_section_number
      ),
      'created_counts', jsonb_build_object(
        'course_offerings', 1, 'teaching_assignments', 1, 'sections', 1,
        'course_offering_sections', 1, 'schedule_versions', 1, 'schedule_sessions', 1,
        'section_subgroups', 0
      ),
      'created_at', v_executed_at
    )
  );

  RAISE NOTICE 'Isolated UAT created offering=% version=% room=% expected=%',
    c_offering_id, c_version_id, v_room_code, v_expected;
END $$;

COMMIT;
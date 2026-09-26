-- Align two existing Islamic Studies sessions with the imported final timetable.
-- This touches the specified draft and term only. It creates no curriculum,
-- course, group, assignment, or extra contact hours.
BEGIN;

DO $education_verified_moves$
DECLARE
  v_version public.schedule_versions%ROWTYPE;
  v_term public.academic_terms%ROWTYPE;
  v_source public.existing_schedule_source_rows%ROWTYPE;
  v_session public.schedule_sessions%ROWTYPE;
  v_spec record;
  v_match record;
  v_conflicts jsonb;
  v_affected integer;
BEGIN
  -- New installations do not carry the historical Education draft.
  IF NOT EXISTS (SELECT 1 FROM public.schedule_versions
                 WHERE id = '7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid)
  THEN RETURN; END IF;
  SELECT * INTO STRICT v_version FROM public.schedule_versions
    WHERE id = '7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid FOR UPDATE;
  SELECT * INTO STRICT v_term FROM public.academic_terms
    WHERE id = v_version.academic_term_id;
  IF v_version.status <> 'draft'
    OR v_version.college_id <> '1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    OR v_term.id <> '93705393-609d-4605-ae94-9572cd8b2090'::uuid
    OR v_term.college_id <> v_version.college_id
    OR v_term.academic_year <> '2026-2027' OR v_term.term_type <> 'first'
    OR NOT public.existing_schedule_intake_enabled(v_version.college_id, v_term.id)
    OR NOT EXISTS (SELECT 1 FROM public.colleges c
      WHERE c.id = v_version.college_id AND btrim(c.name) = 'كلية التربية والعلوم')
  THEN RAISE EXCEPTION 'EDUCATION_FIRST_TERM_DRAFT_REQUIRED'; END IF;

  FOR v_spec IN SELECT * FROM (VALUES
    ('EDU-2026F-ISL-R09-L4', '55c27fad-a8fb-46b8-914c-800def2ca13b'::uuid,
      '2026-09-25 14:00:15.443088+00'::timestamptz, 4, 'أساسيات البحث التربوي', 'أساسيات بحث تربوي',
      'ردمان', 'ق13', 1, '08:00'::time, '10:00'::time, 'ق20'),
    ('EDU-2026F-ISL-R18-L2', '599abe9e-38b8-4f2e-a092-33ce2b375cd4'::uuid,
      '2026-09-25 14:00:12.554019+00'::timestamptz, 2, 'مناهج عامة', 'مناهج عامة',
      'إسماعيل', 'ق20', 1, '10:00'::time, '12:00'::time, 'المدمجة')
  ) AS spec(source_id, session_id, old_updated_at, level_number, course_name, source_fragment,
            surname, old_room, old_day, old_start, old_end, target_room)
  LOOP
    SELECT * INTO STRICT v_source FROM public.existing_schedule_source_rows
      WHERE schedule_version_id = v_version.id AND college_id = v_version.college_id
        AND term_id = v_term.id AND source_id = v_spec.source_id
        AND source_file = 'جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx'
      FOR UPDATE;
    SELECT * INTO STRICT v_session FROM public.schedule_sessions
      WHERE id = v_spec.session_id AND schedule_version_id = v_version.id
        AND college_id = v_version.college_id FOR UPDATE;

    SELECT o.program_id, o.term_id, o.course_id, o.is_active AS offering_active,
           c.name AS course_name, i.full_name AS teacher, r.name AS current_room,
           cohort.program_id AS cohort_program_id, cohort.term_id AS cohort_term_id,
           cohort.study_plan_id, cohort.expected_students AS cohort_students,
           cohort.active AS cohort_active, lvl.level_number,
           pc.id AS plan_course_id, pc.study_plan_id AS plan_study_plan_id,
           comp.id AS component_id, comp.required_room_type_id,
           comp.weekly_contact_hours, comp.component_type,
           dg.active AS group_active, dg.is_obsolete AS group_obsolete,
           ta.is_active AS assignment_active, ta.assigned_component_hours,
           target.id AS target_room_id, target.room_type_id AS target_room_type_id,
           target.capacity AS room_capacity, target.is_active AS room_active,
           target.available_days, target.available_start_time, target.available_end_time
      INTO STRICT v_match
      FROM public.course_offerings o
      JOIN public.courses c ON c.id = o.course_id
      JOIN public.instructors i ON i.id = v_session.instructor_id
      JOIN public.rooms r ON r.id = v_session.room_id
      JOIN public.academic_cohorts cohort ON cohort.id = v_session.cohort_id
      JOIN public.academic_levels lvl ON lvl.id = cohort.level_id
      JOIN public.plan_course_components comp ON comp.id = v_session.plan_course_component_id
      JOIN public.plan_courses pc ON pc.id = comp.plan_course_id
      JOIN public.delivery_groups dg ON dg.id = v_session.delivery_group_id
      JOIN public.teaching_assignments ta ON ta.id = v_session.teaching_assignment_id
      JOIN public.rooms target ON target.college_id = v_version.college_id
        AND target.name = v_spec.target_room
     WHERE o.id = v_session.course_offering_id;

    IF v_source.level_number IS DISTINCT FROM v_spec.level_number
       OR v_source.raw_course NOT LIKE '%' || v_spec.source_fragment || '%'
       OR v_source.raw_teacher NOT LIKE '%' || v_spec.surname || '%'
       OR v_source.day_of_week IS NULL OR v_source.start_time IS NULL
       OR v_source.end_time IS NULL
       OR v_source.end_time - v_source.start_time <> interval '2 hours'
       OR (v_spec.target_room = 'ق20' AND trim(v_source.raw_room) <> '20')
       OR (v_spec.target_room = 'المدمجة' AND trim(v_source.raw_room) <> 'المدمجة')
       OR v_match.program_id <> 'e4f8630f-a049-43bd-8d33-c33447b72753'::uuid
       OR v_match.program_id IS DISTINCT FROM v_match.cohort_program_id
       OR v_match.term_id IS DISTINCT FROM v_term.id
       OR v_match.cohort_term_id IS DISTINCT FROM v_term.id
       OR v_match.level_number IS DISTINCT FROM v_source.level_number
       OR v_match.course_name IS DISTINCT FROM v_spec.course_name
       OR v_match.teacher NOT LIKE '%' || v_spec.surname || '%'
       OR v_match.study_plan_id IS DISTINCT FROM v_match.plan_study_plan_id
       OR v_match.course_id IS DISTINCT FROM
          (SELECT course_id FROM public.plan_courses WHERE id = v_match.plan_course_id)
       OR v_match.component_type <> 'theory'
       OR v_match.weekly_contact_hours <> 2
       OR v_match.assigned_component_hours <> 2
       OR v_session.study_system <> 'regular'
       OR v_session.is_locked OR v_session.replaced_by_split
       OR v_match.offering_active IS NOT TRUE OR v_match.cohort_active IS NOT TRUE
       OR v_match.group_active IS NOT TRUE OR v_match.group_obsolete IS TRUE
       OR v_match.assignment_active IS NOT TRUE OR v_match.room_active IS NOT TRUE
       OR v_match.room_capacity < v_session.expected_students
       OR v_match.required_room_type_id IS DISTINCT FROM v_match.target_room_type_id
       OR (v_match.available_days IS NOT NULL
           AND NOT v_source.day_of_week = ANY(v_match.available_days))
       OR v_source.start_time < v_match.available_start_time
       OR v_source.end_time > v_match.available_end_time
       OR EXISTS (SELECT 1 FROM public.existing_schedule_source_rows other
          WHERE other.schedule_session_id = v_session.id AND other.id <> v_source.id)
       OR EXISTS (SELECT 1 FROM public.shared_lecture_links l
          WHERE l.anchor_group_id = v_session.delivery_group_id
             OR l.member_group_id = v_session.delivery_group_id)
       OR EXISTS (SELECT 1 FROM public.existing_schedule_source_rows other
          WHERE other.schedule_version_id = v_version.id
            AND other.source_file = v_source.source_file
            AND other.level_number = v_source.level_number
            AND other.day_of_week = v_source.day_of_week
            AND other.start_time < v_source.end_time
            AND other.end_time > v_source.start_time AND other.id <> v_source.id)
    THEN RAISE EXCEPTION 'EDUCATION_MOVE_SOURCE_OR_MODEL_DRIFT: %', v_spec.source_id; END IF;

    IF v_source.schedule_session_id = v_session.id
       AND v_session.day_of_week = v_source.day_of_week
       AND v_session.start_time = v_source.start_time
       AND v_session.end_time = v_source.end_time
       AND v_session.room_id = v_match.target_room_id
       AND v_source.plan_course_id = v_match.plan_course_id
       AND v_source.component_id = v_match.component_id
       AND v_source.delivery_group_id = v_session.delivery_group_id
    THEN CONTINUE; END IF;

    IF v_source.schedule_session_id IS NOT NULL OR v_source.status <> 'pending'
       OR v_session.updated_at IS DISTINCT FROM v_spec.old_updated_at
       OR v_session.day_of_week <> v_spec.old_day
       OR v_session.start_time <> v_spec.old_start OR v_session.end_time <> v_spec.old_end
       OR v_match.current_room <> v_spec.old_room
       OR EXISTS (SELECT 1 FROM public.schedule_sessions peer
          WHERE peer.schedule_version_id = v_version.id AND peer.id <> v_session.id
            AND peer.cohort_id = v_session.cohort_id
            AND peer.day_of_week = v_source.day_of_week
            AND peer.start_time < v_source.end_time
            AND peer.end_time > v_source.start_time)
    THEN RAISE EXCEPTION 'EDUCATION_MOVE_ALREADY_CHANGED: %', v_spec.source_id; END IF;

    v_conflicts := public._collect_schedule_session_move_conflicts(
       v_session.id, v_session.college_id, v_version.id, v_session.instructor_id,
       v_session.section_id, v_session.course_offering_id,
       v_session.teaching_assignment_id, v_session.study_system,
       v_session.expected_students, v_source.day_of_week::integer,
       v_source.start_time, v_source.end_time, v_match.target_room_id);
    IF jsonb_array_length(COALESCE(v_conflicts->'blocking_conflicts','[]'::jsonb)) <> 0
       OR jsonb_array_length(COALESCE(v_conflicts->'warnings','[]'::jsonb)) <> 0
    THEN RAISE EXCEPTION 'EDUCATION_MOVE_CONFLICT: % (%)', v_spec.source_id, v_conflicts; END IF;

    UPDATE public.schedule_sessions
       SET day_of_week = v_source.day_of_week, start_time = v_source.start_time,
           end_time = v_source.end_time, room_id = v_match.target_room_id
     WHERE id = v_session.id AND updated_at = v_spec.old_updated_at;
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected <> 1 THEN RAISE EXCEPTION 'EDUCATION_MOVE_STALE: %', v_spec.source_id; END IF;
    UPDATE public.existing_schedule_source_rows
       SET study_plan_id = v_match.study_plan_id, plan_course_id = v_match.plan_course_id,
           component_id = v_match.component_id, cohort_id = v_session.cohort_id,
           delivery_group_id = v_session.delivery_group_id,
           teaching_assignment_id = v_session.teaching_assignment_id,
           instructor_ids = ARRAY[v_session.instructor_id], room_id = v_match.target_room_id,
           schedule_session_id = v_session.id, status = 'imported',
           pending_reasons = ARRAY[]::text[]
     WHERE id = v_source.id;
  END LOOP;
END;
$education_verified_moves$;

COMMIT;

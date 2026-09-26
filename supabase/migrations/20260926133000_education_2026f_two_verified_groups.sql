-- Two existing, unscheduled Education groups in the 2026/27 first-term draft.
-- Their original timetable cells, plan components and group identities are
-- preserved. Provisional instructor corrections are recorded on source rows.
BEGIN;

DO $education_two_groups$
DECLARE
  v_version public.schedule_versions%ROWTYPE;
  v_term public.academic_terms%ROWTYPE;
  v_source public.existing_schedule_source_rows%ROWTYPE;
  v_group public.delivery_groups%ROWTYPE;
  v_assignment public.teaching_assignments%ROWTYPE;
  v_spec record;
  v_context record;
  v_session public.schedule_sessions%ROWTYPE;
  v_session_id uuid;
  v_count integer;
BEGIN
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
     OR NOT EXISTS (SELECT 1 FROM public.colleges c WHERE c.id = v_version.college_id
                    AND btrim(c.name) = 'كلية التربية والعلوم')
  THEN RAISE EXCEPTION 'EDUCATION_FIRST_TERM_DRAFT_REQUIRED'; END IF;

  FOR v_spec IN SELECT * FROM (VALUES
    ('EDU-SOURCE-2026-S1-20260922-S0172',
     '9a9e8e5a-90d4-45b4-8005-b8cb41e799d4'::uuid,
     'ff64de50-8027-4342-b5e7-11f9cef67cad'::uuid,
     '005f05fa-cbe8-4d4a-81e3-1712086bacdf'::uuid,
     '00e344d0-bb02-4da8-a6c7-ad548bbfd93e'::uuid,
     '00e344d0-bb02-4da8-a6c7-ad548bbfd93e'::uuid,
     '2026-09-25 23:37:48.95998+00'::timestamptz,
     'جدول_الفصل_الأول_2026_ـ_2027م-2.docx',
     'مهارات اللغة الانجليزية 1', 'القردعي', 1, 1,
     '12:00'::time, '14:00'::time, 'theory', 'lecture'),
    ('EDU-SOURCE-2026-S1-20260922-S0134',
     '079486bc-7e10-4cfa-b19a-eeeac52306bb'::uuid,
     '99984fd2-1635-4cde-be0e-c4626dce11bc'::uuid,
     '26bb2435-dd59-4dd9-9efa-9735a92ae7aa'::uuid,
     '26bb2435-dd59-4dd9-9efa-9735a92ae7aa'::uuid,
     'c81efcf2-5312-5e81-a754-67d1a9c7901f'::uuid,
     '2026-09-25 22:19:13.345694+00'::timestamptz,
     'جدول قسم علوم الحياة للفصل الأول2026-2027م.docx',
     'فيزياء عملي', 'معمل الفيزياء', 1, 3,
     '10:00'::time, '12:00'::time, 'practical', 'lab')
  ) AS x(source_id, group_id, assignment_id, old_teacher_id,
         old_assignment_teacher_id, target_teacher_id,
         old_assignment_updated_at, source_file,
         source_course, room_name, level_number, day_of_week,
         starts, ends, component_type, session_type)
  LOOP
    SELECT * INTO STRICT v_source FROM public.existing_schedule_source_rows
     WHERE schedule_version_id = v_version.id AND college_id = v_version.college_id
       AND term_id = v_term.id AND source_id = v_spec.source_id
       AND source_file = v_spec.source_file FOR UPDATE;
    SELECT * INTO STRICT v_group FROM public.delivery_groups
     WHERE id = v_spec.group_id AND college_id = v_version.college_id FOR UPDATE;
    SELECT * INTO STRICT v_assignment FROM public.teaching_assignments
     WHERE id = v_spec.assignment_id AND college_id = v_version.college_id
       AND delivery_group_id = v_group.id FOR UPDATE;
    SELECT o.id AS offering_id, o.college_id AS offering_college_id,
           o.term_id AS offering_term_id, o.program_id AS offering_program_id,
           o.level_id AS offering_level_id, o.course_id AS offering_course_id,
           o.plan_course_id AS offering_plan_course_id,
           o.study_plan_id AS offering_study_plan_id,
           o.study_system AS offering_study_system, o.is_active AS offering_active,
           cohort.program_id, cohort.level_id, cohort.study_plan_id,
           cohort.term_id, cohort.active AS cohort_active, lvl.level_number,
           pc.course_id AS plan_course_course_id, pc.study_plan_id AS plan_study_plan_id,
           comp.component_type, comp.weekly_contact_hours,
           comp.required_room_type_id,
           room.id AS room_id, room.room_type_id, room.capacity,
           room.is_active AS room_active, room.available_days,
           room.available_start_time, room.available_end_time,
           teacher.is_active AS teacher_active,
           teacher.availability_status AS teacher_availability,
           teacher.college_id AS teacher_college_id
      INTO STRICT v_context
      FROM public.course_offerings o
      JOIN public.academic_cohorts cohort ON cohort.id = v_group.cohort_id
      JOIN public.academic_levels lvl ON lvl.id = cohort.level_id
      JOIN public.plan_courses pc ON pc.id = v_group.plan_course_id
      JOIN public.plan_course_components comp ON comp.id = v_group.component_id
      JOIN public.rooms room ON room.college_id = v_version.college_id
        AND room.name = v_spec.room_name
      JOIN public.instructors teacher ON teacher.id = v_spec.target_teacher_id
     WHERE o.id = v_assignment.course_offering_id;

    IF v_source.raw_course IS DISTINCT FROM v_spec.source_course
       OR v_source.level_number IS DISTINCT FROM v_spec.level_number
       OR v_source.day_of_week IS DISTINCT FROM v_spec.day_of_week
       OR v_source.start_time IS DISTINCT FROM v_spec.starts
       OR v_source.end_time IS DISTINCT FROM v_spec.ends
       OR v_source.room_id IS DISTINCT FROM v_context.room_id
       OR v_source.cohort_id IS DISTINCT FROM v_group.cohort_id
       OR v_source.plan_course_id IS DISTINCT FROM v_group.plan_course_id
       OR v_source.component_id IS DISTINCT FROM v_group.component_id
       OR v_group.active IS NOT TRUE OR v_group.is_obsolete IS TRUE
       OR v_group.expected_students IS NULL OR v_group.expected_students < 1
       OR v_context.cohort_active IS NOT TRUE
       OR v_context.offering_active IS NOT TRUE
       OR v_context.room_active IS NOT TRUE
       OR v_context.teacher_active IS NOT TRUE
       OR v_context.teacher_availability IS DISTINCT FROM 'available'
       OR v_context.teacher_college_id IS NULL
       OR v_context.term_id IS DISTINCT FROM v_term.id
       OR v_context.offering_term_id IS DISTINCT FROM v_term.id
       OR v_context.offering_college_id IS DISTINCT FROM v_version.college_id
       OR v_context.offering_program_id IS DISTINCT FROM v_context.program_id
       OR v_context.offering_level_id IS DISTINCT FROM v_context.level_id
       OR v_context.offering_course_id IS DISTINCT FROM v_context.plan_course_course_id
       OR v_context.offering_plan_course_id IS DISTINCT FROM v_group.plan_course_id
       OR v_context.offering_study_plan_id IS DISTINCT FROM v_context.study_plan_id
       OR v_context.plan_study_plan_id IS DISTINCT FROM v_context.study_plan_id
       OR v_context.level_number IS DISTINCT FROM v_spec.level_number
       OR v_context.offering_study_system IS DISTINCT FROM 'regular'
       OR v_context.component_type IS DISTINCT FROM v_spec.component_type
       OR v_context.weekly_contact_hours IS DISTINCT FROM 2
       OR v_context.required_room_type_id IS DISTINCT FROM v_context.room_type_id
       OR v_context.capacity < v_group.expected_students
       OR (v_context.available_days IS NOT NULL AND
           NOT v_spec.day_of_week = ANY(v_context.available_days))
       OR v_spec.starts < v_context.available_start_time
       OR v_spec.ends > v_context.available_end_time
       OR v_assignment.cohort_id IS DISTINCT FROM v_group.cohort_id
       OR v_assignment.plan_course_component_id IS DISTINCT FROM v_group.component_id
       OR v_assignment.assigned_component_hours IS DISTINCT FROM 2
       OR v_assignment.weekly_hours IS DISTINCT FROM 2
       OR v_assignment.is_active IS NOT TRUE
       OR EXISTS (SELECT 1 FROM public.shared_lecture_links sl
                  WHERE sl.member_group_id = v_group.id OR sl.anchor_group_id = v_group.id)
    THEN RAISE EXCEPTION 'EDUCATION_GROUP_SOURCE_MODEL_DRIFT: %', v_spec.source_id; END IF;

    IF v_source.schedule_session_id IS NOT NULL THEN
      SELECT * INTO STRICT v_session FROM public.schedule_sessions
       WHERE id = v_source.schedule_session_id AND schedule_version_id = v_version.id;
      IF v_source.status <> 'imported' OR v_source.delivery_group_id <> v_group.id
         OR v_source.teaching_assignment_id <> v_assignment.id
         OR v_source.instructor_ids <> ARRAY[v_spec.target_teacher_id]
         OR v_assignment.instructor_id <> v_spec.target_teacher_id
         OR v_session.delivery_group_id <> v_group.id
         OR v_session.teaching_assignment_id <> v_assignment.id
         OR v_session.instructor_id <> v_spec.target_teacher_id
         OR v_session.room_id <> v_context.room_id
         OR v_session.day_of_week <> v_spec.day_of_week
         OR v_session.start_time <> v_spec.starts OR v_session.end_time <> v_spec.ends
      THEN RAISE EXCEPTION 'EDUCATION_EXISTING_GROUP_LINK_DRIFT: %', v_spec.source_id; END IF;
      CONTINUE;
    END IF;

    IF v_source.status <> 'pending' OR v_source.delivery_group_id IS NOT NULL
       OR v_source.teaching_assignment_id IS NOT NULL
       OR v_source.instructor_ids <> ARRAY[v_spec.old_teacher_id]
       OR v_assignment.instructor_id <> v_spec.old_assignment_teacher_id
       OR v_assignment.updated_at IS DISTINCT FROM v_spec.old_assignment_updated_at
       OR EXISTS (SELECT 1 FROM public.schedule_sessions s
          WHERE s.schedule_version_id = v_version.id AND s.delivery_group_id = v_group.id)
       OR EXISTS (SELECT 1 FROM public.schedule_sessions s
          WHERE s.schedule_version_id = v_version.id
            AND s.day_of_week = v_spec.day_of_week
            AND s.start_time < v_spec.ends AND s.end_time > v_spec.starts
            AND (s.cohort_id = v_group.cohort_id
              OR s.room_id = v_context.room_id
              OR s.instructor_id = v_spec.target_teacher_id))
       OR EXISTS (SELECT 1 FROM public.schedule_sessions s
          JOIN public.schedule_versions other_v ON other_v.id = s.schedule_version_id
          JOIN public.academic_terms other_t ON other_t.id = other_v.academic_term_id
          WHERE s.college_id <> v_version.college_id
            AND s.instructor_id = v_spec.target_teacher_id
            AND other_v.status IN ('draft','published')
            AND other_t.academic_year = v_term.academic_year
            AND other_t.term_type = v_term.term_type
            AND s.day_of_week = v_spec.day_of_week
            AND s.start_time < v_spec.ends AND s.end_time > v_spec.starts)
    THEN RAISE EXCEPTION 'EDUCATION_GROUP_SLOT_OR_ASSIGNMENT_DRIFT: %', v_spec.source_id; END IF;

    IF v_spec.old_assignment_teacher_id <> v_spec.target_teacher_id THEN
      UPDATE public.teaching_assignments SET instructor_id = v_spec.target_teacher_id
       WHERE id = v_assignment.id AND updated_at = v_spec.old_assignment_updated_at;
      GET DIAGNOSTICS v_count = ROW_COUNT;
      IF v_count <> 1 THEN RAISE EXCEPTION 'EDUCATION_ASSIGNMENT_STALE: %', v_spec.source_id; END IF;
    END IF;

    INSERT INTO public.schedule_sessions
      (college_id, schedule_version_id, course_offering_id,
       teaching_assignment_id, instructor_id, room_id, cohort_id,
       plan_course_component_id, delivery_group_id, study_system,
       day_of_week, start_time, end_time, session_type, expected_students,
       source_type)
    VALUES (v_version.college_id, v_version.id, v_context.offering_id,
            v_assignment.id, v_spec.target_teacher_id, v_context.room_id,
            v_group.cohort_id, v_group.component_id, v_group.id, 'regular',
            v_spec.day_of_week, v_spec.starts, v_spec.ends,
            v_spec.session_type, v_group.expected_students, 'manual')
    RETURNING id INTO v_session_id;

    UPDATE public.existing_schedule_source_rows
       SET instructor_ids = ARRAY[v_spec.target_teacher_id],
           delivery_group_id = v_group.id,
           teaching_assignment_id = v_assignment.id,
           schedule_session_id = v_session_id, status = 'imported',
           pending_reasons = ARRAY[]::text[],
           notes = (COALESCE(v_source.notes, '{}')::jsonb || jsonb_build_object(
             'execution_correction_20260926', jsonb_build_object(
               'previous_provisional_instructor_id', v_spec.old_teacher_id,
               'operational_instructor_id', v_spec.target_teacher_id,
               'reason', CASE WHEN v_spec.component_type = 'practical'
                  THEN 'Published cross-college session overlaps provisional theory instructor; adjacent physics lab assistant is available.'
                  ELSE 'Later active assignment for this exact group supersedes the provisional department-level name.' END,
               'source_instructor_text_preserved', true,
               'term_exception_only', true)))::text
     WHERE id = v_source.id AND schedule_session_id IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    IF v_count <> 1 THEN RAISE EXCEPTION 'EDUCATION_SOURCE_STALE: %', v_spec.source_id; END IF;
  END LOOP;
END;
$education_two_groups$;

SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

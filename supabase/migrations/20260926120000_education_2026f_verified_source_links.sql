-- The Education source timetable may be reconciled only with its 2026/27 first-term draft.
-- This one row has a unique, already scheduled session with the same program,
-- level, instructor, room, day and time. No course, credit, group or session is created.
BEGIN;

DO $education_2026f$
DECLARE
  v_version public.schedule_versions%ROWTYPE;
  v_term public.academic_terms%ROWTYPE;
  v_source public.existing_schedule_source_rows%ROWTYPE;
  v_match record;
  v_matches integer;
  v_spec record;
BEGIN
  -- Fresh installations have no historical Education draft to reconcile.
  IF NOT EXISTS (SELECT 1 FROM public.schedule_versions
                 WHERE id = '7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid)
  THEN RETURN; END IF;
  SELECT * INTO STRICT v_version FROM public.schedule_versions
   WHERE id = '7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid FOR UPDATE;
  SELECT * INTO STRICT v_term FROM public.academic_terms
   WHERE id = v_version.academic_term_id;
  IF v_version.status <> 'draft'
     OR v_term.college_id <> v_version.college_id
     OR v_term.academic_year <> '2026-2027'
     OR v_term.term_type <> 'first'
     OR NOT EXISTS (
       SELECT 1 FROM public.colleges c
       WHERE c.id = v_version.college_id AND btrim(c.name) = 'كلية التربية والعلوم'
     )
     OR NOT public.existing_schedule_intake_enabled(v_version.college_id, v_term.id)
  THEN
    RAISE EXCEPTION 'EDUCATION_FIRST_TERM_DRAFT_REQUIRED';
  END IF;

  -- The source row IDs, exact windows, and teacher surnames come from the
  -- imported Chemistry timetable. The session's program and level are checked
  -- through the actual offering and cohort, not guessed from its course owner.
  FOR v_spec IN SELECT * FROM (VALUES
    ('EDU-2026F-CHEM-R11-L3', 3, 1, '12:00'::time, '14:00'::time, '7', 'خاتم', 'استراتيجيات')
  ) AS x(source_id, level_number, day_of_week, starts, ends, room_number, surname, course_fragment)
  LOOP
    SELECT * INTO STRICT v_source FROM public.existing_schedule_source_rows
     WHERE college_id = v_version.college_id
       AND term_id = v_term.id
       AND schedule_version_id = v_version.id
       AND source_id = v_spec.source_id
       AND source_file = 'كيمياء.docx'
     FOR UPDATE;
    IF v_source.level_number IS DISTINCT FROM v_spec.level_number
       OR v_source.day_of_week IS DISTINCT FROM v_spec.day_of_week
       OR v_source.start_time IS DISTINCT FROM v_spec.starts
       OR v_source.end_time IS DISTINCT FROM v_spec.ends
       OR trim(v_source.raw_room) IS DISTINCT FROM v_spec.room_number
       OR v_source.raw_teacher NOT LIKE '%' || v_spec.surname || '%'
       OR v_source.raw_course NOT LIKE '%' || v_spec.course_fragment || '%'
    THEN
      RAISE EXCEPTION 'EDUCATION_SOURCE_DRIFT: %', v_spec.source_id;
    END IF;

    SELECT count(*) INTO v_matches
      FROM public.schedule_sessions s
      JOIN public.course_offerings o ON o.id = s.course_offering_id
      JOIN public.academic_programs p ON p.id = o.program_id
      JOIN public.academic_cohorts cohort ON cohort.id = s.cohort_id
      JOIN public.academic_levels lvl ON lvl.id = cohort.level_id
      JOIN public.courses course ON course.id = o.course_id
      JOIN public.instructors i ON i.id = s.instructor_id
      JOIN public.rooms room ON room.id = s.room_id
      JOIN public.plan_course_components component ON component.id = s.plan_course_component_id
      JOIN public.plan_courses pc ON pc.id = component.plan_course_id
     WHERE s.schedule_version_id = v_version.id
       AND s.college_id = v_version.college_id
       AND o.college_id = v_version.college_id
       AND o.term_id = v_term.id
       AND p.college_id = v_version.college_id
       AND p.id = cohort.program_id
       AND p.name LIKE '%كيمياء%'
       AND cohort.term_id = v_term.id
       AND lvl.level_number = v_spec.level_number
       AND course.name LIKE '%' || v_spec.course_fragment || '%'
       AND i.full_name LIKE '%' || v_spec.surname || '%'
       AND (room.code = 'ق' || v_spec.room_number
            OR room.name = 'ق' || v_spec.room_number
            OR room.code = v_spec.room_number
            OR regexp_replace(room.name, '[^0-9]', '', 'g') = v_spec.room_number)
       AND s.day_of_week = v_spec.day_of_week
       AND s.start_time = v_spec.starts
       AND s.end_time = v_spec.ends
       AND s.delivery_group_id IS NOT NULL
       AND s.teaching_assignment_id IS NOT NULL
       AND pc.study_plan_id = cohort.study_plan_id
       AND pc.course_id = o.course_id
       AND NOT EXISTS (
         SELECT 1 FROM public.existing_schedule_source_rows other
         WHERE other.schedule_session_id = s.id AND other.id <> v_source.id
       );
    IF v_matches <> 1 THEN
      RAISE EXCEPTION 'EDUCATION_SESSION_MATCH_NOT_UNIQUE: % (%)', v_spec.source_id, v_matches;
    END IF;

    SELECT s.id AS session_id, s.cohort_id, s.delivery_group_id,
           s.teaching_assignment_id, s.plan_course_component_id AS component_id,
           s.instructor_id, s.room_id, pc.id AS plan_course_id,
           pc.study_plan_id
      INTO STRICT v_match
      FROM public.schedule_sessions s
      JOIN public.course_offerings o ON o.id = s.course_offering_id
      JOIN public.academic_programs p ON p.id = o.program_id
      JOIN public.academic_cohorts cohort ON cohort.id = s.cohort_id
      JOIN public.academic_levels lvl ON lvl.id = cohort.level_id
      JOIN public.courses course ON course.id = o.course_id
      JOIN public.instructors i ON i.id = s.instructor_id
      JOIN public.rooms room ON room.id = s.room_id
      JOIN public.plan_course_components component ON component.id = s.plan_course_component_id
      JOIN public.plan_courses pc ON pc.id = component.plan_course_id
     WHERE s.schedule_version_id = v_version.id
       AND s.college_id = v_version.college_id
       AND o.college_id = v_version.college_id
       AND o.term_id = v_term.id
       AND p.college_id = v_version.college_id
       AND p.id = cohort.program_id
       AND p.name LIKE '%كيمياء%'
       AND cohort.term_id = v_term.id
       AND lvl.level_number = v_spec.level_number
       AND course.name LIKE '%' || v_spec.course_fragment || '%'
       AND i.full_name LIKE '%' || v_spec.surname || '%'
       AND (room.code = 'ق' || v_spec.room_number
            OR room.name = 'ق' || v_spec.room_number
            OR room.code = v_spec.room_number
            OR regexp_replace(room.name, '[^0-9]', '', 'g') = v_spec.room_number)
       AND s.day_of_week = v_spec.day_of_week
       AND s.start_time = v_spec.starts
       AND s.end_time = v_spec.ends
       AND s.delivery_group_id IS NOT NULL
       AND s.teaching_assignment_id IS NOT NULL
       AND pc.study_plan_id = cohort.study_plan_id
       AND pc.course_id = o.course_id
       AND NOT EXISTS (
         SELECT 1 FROM public.existing_schedule_source_rows other
         WHERE other.schedule_session_id = s.id AND other.id <> v_source.id
       )
     FOR UPDATE OF s;

    IF v_source.schedule_session_id IS NOT NULL THEN
      IF v_source.schedule_session_id IS DISTINCT FROM v_match.session_id
         OR v_source.study_plan_id IS DISTINCT FROM v_match.study_plan_id
         OR v_source.plan_course_id IS DISTINCT FROM v_match.plan_course_id
         OR v_source.component_id IS DISTINCT FROM v_match.component_id
         OR v_source.delivery_group_id IS DISTINCT FROM v_match.delivery_group_id
      THEN
        RAISE EXCEPTION 'EDUCATION_EXISTING_LINK_DRIFT: %', v_spec.source_id;
      END IF;
      CONTINUE;
    END IF;

    UPDATE public.existing_schedule_source_rows
       SET study_plan_id = v_match.study_plan_id,
           plan_course_id = v_match.plan_course_id,
           component_id = v_match.component_id,
           cohort_id = v_match.cohort_id,
           delivery_group_id = v_match.delivery_group_id,
           teaching_assignment_id = v_match.teaching_assignment_id,
           instructor_ids = ARRAY[v_match.instructor_id],
           room_id = v_match.room_id,
           schedule_session_id = v_match.session_id,
           status = 'imported',
           pending_reasons = ARRAY[]::text[]
     WHERE id = v_source.id;
  END LOOP;
END;
$education_2026f$;

COMMIT;

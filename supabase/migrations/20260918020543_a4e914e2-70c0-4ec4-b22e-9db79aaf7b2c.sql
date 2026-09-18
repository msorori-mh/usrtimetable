
CREATE OR REPLACE FUNCTION public.import_existing_schedule_intake(p_version uuid, p_base_year integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_ver public.schedule_versions%ROWTYPE;
  r record;
  v_program uuid; v_level uuid; v_course uuid; v_plan uuid;
  v_entry integer; v_cohort uuid; v_offering uuid; v_group uuid; v_ta uuid; v_session uuid;
  v_comp public.plan_course_components%ROWTYPE;
  v_seq integer; v_code text; v_stype text;
  v_anchor_session uuid; v_anchor_group uuid;
  v_groups integer := 0; v_sessions integer := 0; v_tas integer := 0; v_shared integer := 0; v_rows integer := 0;
  v_inst uuid; v_first boolean;
BEGIN
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERSION_NOT_FOUND'; END IF;
  IF auth.uid() IS NOT NULL AND NOT public.can_manage_college(auth.uid(), v_ver.college_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF v_ver.status <> 'draft' THEN RAISE EXCEPTION 'VERSION_NOT_DRAFT'; END IF;
  IF NOT public.existing_schedule_intake_enabled(v_ver.college_id, v_ver.academic_term_id) THEN
    RAISE EXCEPTION 'EXISTING_SCHEDULE_INTAKE_DISABLED';
  END IF;
  IF p_base_year IS NULL THEN RAISE EXCEPTION 'BASE_YEAR_REQUIRED'; END IF;

  FOR r IN
    SELECT s.* FROM public.existing_schedule_source_rows s
    WHERE s.college_id = v_ver.college_id
      AND s.term_id = v_ver.academic_term_id
      AND s.schedule_session_id IS NULL
      AND s.plan_course_id IS NOT NULL
      AND s.component_id IS NOT NULL
      AND COALESCE(array_length(s.instructor_ids,1),0) >= 1
      AND s.day_of_week IS NOT NULL AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL
      AND s.level_number IS NOT NULL
    ORDER BY (s.shared_key IS NULL) DESC, s.shared_key, s.source_id
  LOOP
    SELECT pc.course_id, pc.level_id, pc.study_plan_id INTO v_course, v_level, v_plan
    FROM public.plan_courses pc WHERE pc.id = r.plan_course_id;
    SELECT program_id INTO v_program FROM public.study_plans WHERE id = v_plan;
    SELECT * INTO v_comp FROM public.plan_course_components WHERE id = r.component_id;
    IF v_program IS NULL OR v_level IS NULL OR v_comp.id IS NULL THEN CONTINUE; END IF;

    v_entry := p_base_year - (r.level_number - 1);

    SELECT id INTO v_cohort FROM public.academic_cohorts
    WHERE program_id = v_program AND level_id = v_level AND study_system = 'regular'
      AND entry_year = v_entry AND term_id = v_ver.academic_term_id;
    IF v_cohort IS NULL THEN
      INSERT INTO public.academic_cohorts
        (college_id, program_id, level_id, study_system, entry_year, term_id,
         expected_students, count_status, code, active)
      VALUES (v_ver.college_id, v_program, v_level, 'regular', v_entry, v_ver.academic_term_id,
         0, 'estimated', 'EX-L' || r.level_number || '-' || v_entry, true)
      RETURNING id INTO v_cohort;
    END IF;

    SELECT id INTO v_offering FROM public.course_offerings
    WHERE term_id = v_ver.academic_term_id AND course_id = v_course AND plan_course_id = r.plan_course_id
      AND college_id = v_ver.college_id;
    IF v_offering IS NULL THEN
      INSERT INTO public.course_offerings
        (college_id, term_id, course_id, program_id, level_id, expected_students, sections_count,
         is_active, study_plan_id, plan_course_id, status, study_system, enrollment_count_status, notes)
      VALUES (v_ver.college_id, v_ver.academic_term_id, v_course, v_program, v_level, 0, 1,
         true, v_plan, r.plan_course_id, 'draft', 'regular', 'unverified',
         'مُنشأ من إدخال الجداول القائمة')
      RETURNING id INTO v_offering;
    END IF;

    SELECT count(*)::int + 1 INTO v_seq FROM public.delivery_groups
    WHERE component_id = r.component_id AND cohort_id = v_cohort;
    v_code := 'EX' || v_seq;
    INSERT INTO public.delivery_groups
      (college_id, cohort_id, plan_course_id, component_id, group_code, expected_students,
       group_number, active, is_obsolete)
    VALUES (v_ver.college_id, v_cohort, r.plan_course_id, r.component_id, v_code, 0, v_seq, true, false)
    RETURNING id INTO v_group;
    v_groups := v_groups + 1;

    v_stype := CASE v_comp.component_type WHEN 'practical' THEN 'lab'
                                          WHEN 'tutorial' THEN 'tutorial'
                                          ELSE 'lecture' END;

    v_anchor_session := NULL; v_anchor_group := NULL;
    IF r.shared_key IS NOT NULL THEN
      SELECT s.schedule_session_id, s.delivery_group_id INTO v_anchor_session, v_anchor_group
      FROM public.existing_schedule_source_rows s
      WHERE s.college_id = r.college_id AND s.term_id = r.term_id AND s.shared_key = r.shared_key
        AND s.schedule_session_id IS NOT NULL AND NOT s.shared_member
      ORDER BY s.source_id LIMIT 1;
    END IF;

    IF v_anchor_session IS NOT NULL AND v_anchor_group IS NOT NULL THEN
      INSERT INTO public.shared_lecture_links (member_group_id, anchor_group_id, college_id)
      VALUES (v_group, v_anchor_group, v_ver.college_id)
      ON CONFLICT (member_group_id) DO NOTHING;
      UPDATE public.existing_schedule_source_rows SET
        cohort_id = v_cohort, delivery_group_id = v_group,
        schedule_session_id = v_anchor_session, shared_member = true,
        status = 'shared_member', schedule_version_id = p_version,
        pending_reasons = '{}',
        notes = COALESCE(notes,'') || ' | عضوية مشتركة في جلسة واحدة'
      WHERE id = r.id;
      v_shared := v_shared + 1;
      v_rows := v_rows + 1;
      CONTINUE;
    END IF;

    v_ta := NULL; v_first := true; v_session := NULL;
    FOREACH v_inst IN ARRAY r.instructor_ids LOOP
      INSERT INTO public.teaching_assignments
        (college_id, course_offering_id, instructor_id, section_number, session_type, weekly_hours,
         required_room_type, notes, expected_students, cohort_id, plan_course_component_id,
         delivery_group_id, assigned_component_hours, is_active)
      VALUES (v_ver.college_id, v_offering, v_inst, v_code, v_stype, v_comp.weekly_contact_hours,
         NULL,
         CASE WHEN v_first THEN 'إدخال جدول قائم' ELSE 'إدخال جدول قائم — تدريس مشترك بانتظار توزيع النصاب' END,
         0, v_cohort, r.component_id, v_group, NULL, true)
      RETURNING id INTO v_ta;
      v_tas := v_tas + 1;
      IF v_first THEN
        INSERT INTO public.schedule_sessions
          (college_id, schedule_version_id, course_offering_id, teaching_assignment_id, instructor_id,
           room_id, study_system, day_of_week, start_time, end_time, session_type, expected_students,
           source_type, cohort_id, plan_course_component_id, delivery_group_id)
        VALUES (v_ver.college_id, p_version, v_offering, v_ta, v_inst, r.room_id, 'regular',
           r.day_of_week, r.start_time, r.end_time, v_stype, 0, 'manual', v_cohort, r.component_id, v_group)
        RETURNING id INTO v_session;
        v_sessions := v_sessions + 1;
        v_first := false;
      END IF;
    END LOOP;

    UPDATE public.existing_schedule_source_rows SET
      cohort_id = v_cohort, delivery_group_id = v_group, teaching_assignment_id = v_ta,
      schedule_session_id = v_session, status = 'imported', schedule_version_id = p_version,
      pending_reasons = CASE WHEN r.room_id IS NULL
        THEN (SELECT array_agg(DISTINCT x) FROM unnest(r.pending_reasons || ARRAY['قاعة بانتظار التحديد']) x)
        ELSE r.pending_reasons END
    WHERE id = r.id;
    v_rows := v_rows + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'rows_imported', v_rows, 'sessions', v_sessions, 'delivery_groups', v_groups,
    'teaching_assignments', v_tas, 'shared_memberships', v_shared,
    'pending', (SELECT count(*) FROM public.existing_schedule_source_rows s
                WHERE s.college_id = v_ver.college_id AND s.term_id = v_ver.academic_term_id
                  AND s.schedule_session_id IS NULL)
  );
END; $$;

REVOKE ALL ON FUNCTION public.import_existing_schedule_intake(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_existing_schedule_intake(uuid, integer) TO authenticated;

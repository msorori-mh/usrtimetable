-- Source-derived courses, offerings and groups for the 2026/27 first term.
-- Existing plan entities serve only as schema links. The imported timetable
-- supplies every course name, level, component and weekly contact hour.
BEGIN;
DO $education_rows$
DECLARE
  v_college constant uuid := '1ee291b2-bec9-43d3-b42b-5a4f46946399';
  v_term constant uuid := '93705393-609d-4605-ae94-9572cd8b2090';
  v_version constant uuid := '7430bad7-2de7-5c90-9368-b214a199d6c3';
  v_src public.existing_schedule_source_rows%ROWTYPE;
  v_program uuid;
  v_plan uuid;
  v_department uuid;
  v_level integer;
  v_level_id uuid;
  v_cohort public.academic_cohorts%ROWTYPE;
  v_room public.rooms%ROWTYPE;
  v_room_name text;
  v_component text;
  v_hours numeric;
  v_theory integer;
  v_practical integer;
  v_code text;
  v_course public.courses%ROWTYPE;
  v_pc public.plan_courses%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_offering public.course_offerings%ROWTYPE;
  v_group public.delivery_groups%ROWTYPE;
  v_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schedule_versions WHERE id=v_version)
  THEN RETURN; END IF;
  PERFORM 1 FROM public.schedule_versions WHERE id=v_version AND
    college_id=v_college AND academic_term_id=v_term AND status='draft' FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
      SELECT 1 FROM public.academic_terms WHERE id=v_term AND college_id=v_college
        AND academic_year='2026-2027' AND term_type='first')
    OR NOT public.existing_schedule_intake_enabled(v_college,v_term)
  THEN RAISE EXCEPTION 'EDU26F_SOURCE_DRAFT_REQUIRED'; END IF;
  SELECT count(*) INTO v_count FROM public.existing_schedule_source_rows
   WHERE college_id=v_college AND term_id=v_term AND schedule_version_id=v_version
     AND source_file IN ('كيمياء.docx',
       'جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx')
     AND schedule_session_id IS NOT NULL;
  IF v_count<10 OR v_count>72 THEN
    RAISE EXCEPTION 'EDU26F_EXISTING_LINKS_DRIFT: %',v_count;
  END IF;
  FOR v_src IN SELECT * FROM public.existing_schedule_source_rows WHERE
    college_id=v_college AND term_id=v_term AND schedule_version_id=v_version
    AND source_file IN ('كيمياء.docx',
      'جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx')
    AND schedule_session_id IS NULL ORDER BY source_id FOR UPDATE
  LOOP
    v_program := CASE WHEN v_src.source_file='كيمياء.docx'
      THEN 'bedd99b9-58d0-4907-8b5c-1a1ceed748ab'::uuid
      ELSE 'e4f8630f-a049-43bd-8d33-c33447b72753'::uuid END;
    v_plan := CASE WHEN v_src.source_file='كيمياء.docx'
      THEN 'bb674bac-24ad-53b8-ae64-30ac31542485'::uuid
      ELSE 'b6438dad-c618-575a-9eed-dba9d42be1b5'::uuid END;
    v_level := CASE WHEN v_src.source_id='EDU-2026F-ISL-R13-L2' THEN 1
      WHEN v_src.source_id IN ('EDU-2026F-ISL-R13-L3',
        'EDU-2026F-ISL-R14-L3','EDU-2026F-ISL-R19-L3') THEN 2
      ELSE v_src.level_number END;
    IF v_src.status<>'pending' OR v_src.raw_course IS NULL OR
       v_src.day_of_week IS NULL OR v_src.start_time IS NULL OR
       v_src.end_time IS NULL OR v_src.end_time<=v_src.start_time
    THEN RAISE EXCEPTION 'EDU26F_BAD_SOURCE_ROW: %',v_src.source_id; END IF;
    SELECT department_id INTO STRICT v_department FROM public.academic_programs
      WHERE id=v_program AND college_id=v_college AND NOT is_archived;
    SELECT id INTO STRICT v_level_id FROM public.academic_levels WHERE
      program_id=v_program AND college_id=v_college AND level_number=v_level;
    SELECT * INTO STRICT v_cohort FROM public.academic_cohorts WHERE
      term_id=v_term AND program_id=v_program AND level_id=v_level_id
      AND study_plan_id=v_plan AND study_system='regular' AND existing_schedule;
    IF NOT v_cohort.active THEN RAISE EXCEPTION 'EDU26F_COHORT_INACTIVE: %',v_src.source_id; END IF;

    v_room_name := CASE
      WHEN btrim(v_src.raw_room) ~ '^[0-9]+$' THEN 'ق'||btrim(v_src.raw_room)
      WHEN regexp_replace(coalesce(v_src.raw_room,''),'[[:space:].]','','g')='شط'
           OR regexp_replace(coalesce(v_src.raw_room,''),'[[:space:].]','','g')='شطلاب'
        THEN 'ق ش ط'
      WHEN regexp_replace(coalesce(v_src.raw_room,''),'[[:space:].]','','g')='مك'
        THEN 'معمل الكيمياء'
      WHEN v_src.raw_room='معمل أحيا' THEN 'معمل الأحياء'
      ELSE btrim(v_src.raw_room) END;
    SELECT * INTO STRICT v_room FROM public.rooms WHERE
      college_id=v_college AND name=v_room_name AND is_active;
    v_component := CASE WHEN v_room.name LIKE 'معمل %' THEN 'practical'
                        ELSE 'theory' END;
    v_hours := extract(epoch FROM (v_src.end_time-v_src.start_time))/3600;
    v_theory := CASE WHEN v_component='theory' THEN v_hours::integer ELSE 0 END;
    v_practical := CASE WHEN v_component='practical' THEN v_hours::integer ELSE 0 END;
    v_code := 'EDU-26F-SRC-'||v_src.source_id;

    INSERT INTO public.courses
      (college_id,department_id,code,name,credit_hours,theory_hours,practical_hours)
    VALUES (v_college,v_department,v_code,btrim(v_src.raw_course),NULL,
      v_theory,v_practical)
    ON CONFLICT (college_id,code) DO NOTHING;
    SELECT * INTO STRICT v_course FROM public.courses WHERE
      college_id=v_college AND code=v_code;
    IF v_course.department_id<>v_department OR v_course.name<>btrim(v_src.raw_course)
      OR v_course.credit_hours IS NOT NULL
      OR v_course.theory_hours<>v_theory
      OR v_course.practical_hours<>v_practical
    THEN RAISE EXCEPTION 'EDU26F_COURSE_DRIFT: %',v_src.source_id; END IF;

    INSERT INTO public.plan_courses
      (college_id,study_plan_id,course_id,level_id,semester,
       lectures_per_week,labs_per_week,lecture_session_duration,lab_session_duration)
    VALUES (v_college,v_plan,v_course.id,v_level_id,1,
      CASE WHEN v_component='theory' THEN 1 ELSE 0 END,
      CASE WHEN v_component='practical' THEN 1 ELSE 0 END,
      v_theory,v_practical)
    ON CONFLICT (study_plan_id,course_id) DO NOTHING;
    SELECT * INTO STRICT v_pc FROM public.plan_courses WHERE
      study_plan_id=v_plan AND course_id=v_course.id;
    IF v_pc.level_id<>v_level_id OR v_pc.semester<>1 OR
       (v_pc.lectures_per_week=1) IS DISTINCT FROM (v_theory>0) OR
       (v_pc.labs_per_week=1) IS DISTINCT FROM (v_practical>0)
    THEN RAISE EXCEPTION 'EDU26F_PLAN_BRIDGE_DRIFT: %',v_src.source_id; END IF;

    INSERT INTO public.plan_course_components
      (college_id,plan_course_id,component_type,weekly_contact_hours,required_room_type_id)
    VALUES (v_college,v_pc.id,v_component,v_hours,v_room.room_type_id)
    ON CONFLICT (plan_course_id,component_type) DO NOTHING;
    SELECT * INTO STRICT v_pcc FROM public.plan_course_components WHERE
      plan_course_id=v_pc.id AND component_type=v_component;
    IF v_pcc.weekly_contact_hours<>v_hours OR
       v_pcc.required_room_type_id<>v_room.room_type_id
    THEN RAISE EXCEPTION 'EDU26F_COMPONENT_DRIFT: %',v_src.source_id; END IF;

    SELECT * INTO v_offering FROM public.course_offerings WHERE
      college_id=v_college AND term_id=v_term AND course_id=v_course.id
      AND program_id=v_program AND level_id=v_level_id AND study_system='regular';
    IF NOT FOUND THEN
      INSERT INTO public.course_offerings
        (college_id,term_id,course_id,program_id,level_id,study_plan_id,
         plan_course_id,study_system,expected_students,enrollment_count_status,
         existing_schedule,notes)
      VALUES (v_college,v_term,v_course.id,v_program,v_level_id,v_plan,v_pc.id,
        'regular',v_cohort.expected_students,'unverified',true,
        'استثناء الفصل الأول 2026-2027؛ المصدر: '||v_src.source_file||
        ' / '||v_src.source_cell||' / '||v_src.source_id)
      RETURNING * INTO v_offering;
    END IF;
    IF v_offering.plan_course_id<>v_pc.id OR v_offering.study_plan_id<>v_plan
      OR NOT v_offering.is_active OR NOT v_offering.existing_schedule
    THEN RAISE EXCEPTION 'EDU26F_OFFERING_DRIFT: %',v_src.source_id; END IF;

    SELECT * INTO v_group FROM public.delivery_groups WHERE
      cohort_id=v_cohort.id AND component_id=v_pcc.id AND group_code=v_src.source_id;
    IF NOT FOUND THEN
      INSERT INTO public.delivery_groups
        (college_id,cohort_id,plan_course_id,component_id,group_code,
         expected_students,active)
      VALUES (v_college,v_cohort.id,v_pc.id,v_pcc.id,v_src.source_id,
        v_cohort.expected_students,true) RETURNING * INTO v_group;
    END IF;
    IF v_group.plan_course_id<>v_pc.id OR v_group.college_id<>v_college OR
       NOT v_group.active OR v_group.is_obsolete
    THEN RAISE EXCEPTION 'EDU26F_GROUP_DRIFT: %',v_src.source_id; END IF;
    IF v_src.delivery_group_id IS NOT NULL AND v_src.delivery_group_id<>v_group.id
    THEN RAISE EXCEPTION 'EDU26F_SOURCE_GROUP_DRIFT: %',v_src.source_id; END IF;
    UPDATE public.existing_schedule_source_rows SET
      study_plan_id=v_plan,plan_course_id=v_pc.id,component_id=v_pcc.id,
      cohort_id=v_cohort.id,delivery_group_id=v_group.id,room_id=v_room.id,
      pending_reasons=ARRAY[
        'مجموعة ومقرر مشتقان من ملف الجدول لهذا الفصل؛ الجلسة تحتاج مطابقة المدرس والقاعات والتعارضات'
      ],
      notes=CASE WHEN v_src.delivery_group_id IS NULL THEN
        COALESCE(v_src.notes,'') || E'\n' ||
        'استثناء الفصل الأول 2026-2027: أنشئت المجموعة من هذا الصف نفسه، ولم يُحجز موعد تشغيلي بعد. المستوى التشغيلي '||v_level::text||'.'
        ELSE v_src.notes END
    WHERE id=v_src.id;
  END LOOP;

  SELECT count(*) INTO v_count FROM public.existing_schedule_source_rows WHERE
    college_id=v_college AND term_id=v_term AND schedule_version_id=v_version
    AND source_file IN ('كيمياء.docx',
      'جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx')
    AND delivery_group_id IS NOT NULL;
  IF v_count<>72 THEN RAISE EXCEPTION 'EDU26F_GROUP_COVERAGE_DRIFT: %',v_count; END IF;
END;
$education_rows$;

SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

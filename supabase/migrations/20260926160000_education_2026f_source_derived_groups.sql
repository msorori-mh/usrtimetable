-- Build the missing operational groups directly from the two departmental
-- timetable files. The existing study-plan tables are only the required
-- database bridge; names, levels, components and hours come from source rows.
-- Every new offering/cohort and every source link is confined to the first
-- 2026/27 term. No instructor, enrollment, room booking or class time is
-- invented for an unresolved source row.
BEGIN;

DO $education_source_groups$
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
  v_code text;
  v_course public.courses%ROWTYPE;
  v_pc public.plan_courses%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_offering public.course_offerings%ROWTYPE;
  v_group public.delivery_groups%ROWTYPE;
  v_existing record;
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
    OR NOT EXISTS (SELECT 1 FROM public.colleges WHERE id=v_college
                   AND btrim(name)='كلية التربية والعلوم')
  THEN RAISE EXCEPTION 'EDU26F_SOURCE_DRAFT_REQUIRED'; END IF;

  SELECT count(*) INTO v_count FROM public.existing_schedule_source_rows
   WHERE college_id=v_college AND term_id=v_term AND schedule_version_id=v_version
     AND source_file IN ('كيمياء.docx',
       'جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx');
  IF v_count<>72 THEN RAISE EXCEPTION 'EDU26F_SOURCE_COUNT_DRIFT: %',v_count; END IF;

  -- The list supplied by the college places العقيدة in L1 and three subjects
  -- shown under L3 in the file in L2. The original source level stays intact.
  SELECT * INTO v_cohort FROM public.academic_cohorts WHERE
    term_id=v_term AND program_id='e4f8630f-a049-43bd-8d33-c33447b72753'::uuid
    AND level_id IN (SELECT id FROM public.academic_levels WHERE
      program_id='e4f8630f-a049-43bd-8d33-c33447b72753'::uuid AND level_number=1)
    AND study_system='regular' AND study_plan_id='b6438dad-c618-575a-9eed-dba9d42be1b5'::uuid
    AND existing_schedule;
  IF NOT FOUND THEN
    INSERT INTO public.academic_levels(college_id,program_id,name,level_number)
    SELECT v_college,'e4f8630f-a049-43bd-8d33-c33447b72753'::uuid,'المستوى الأول',1
    WHERE NOT EXISTS (SELECT 1 FROM public.academic_levels WHERE
      program_id='e4f8630f-a049-43bd-8d33-c33447b72753'::uuid AND level_number=1);
    SELECT id INTO STRICT v_level_id FROM public.academic_levels WHERE
      program_id='e4f8630f-a049-43bd-8d33-c33447b72753'::uuid AND
      college_id=v_college AND level_number=1;
    INSERT INTO public.academic_cohorts
      (college_id,program_id,level_id,study_system,term_id,study_plan_id,
       expected_students,count_status,code,existing_schedule)
    VALUES (v_college,'e4f8630f-a049-43bd-8d33-c33447b72753'::uuid,
      v_level_id,'regular',v_term,'b6438dad-c618-575a-9eed-dba9d42be1b5'::uuid,
      NULL,'estimated','مصدر جدول الدراسات الإسلامية 2026-2027 — المستوى الأول',true);
  END IF;

  -- Seven unsourced sessions already represent a subject in these files.
  -- Attach the source cell to its live session without creating a second class.
  FOR v_existing IN SELECT * FROM (VALUES
    ('EDU-2026F-CHEM-R03-L1','142ec075-37e8-5dad-9efe-855ad13aafbf'::uuid),
    ('EDU-2026F-CHEM-R12-L2','6b15fa2d-2512-406a-ba7e-ccb4b8fbc816'::uuid),
    ('EDU-2026F-CHEM-R14-L2','c8d903d0-f3c1-5457-a16a-acd94efd1d6c'::uuid),
    ('EDU-2026F-CHEM-R20-L4','33383b07-c8d4-4716-aa5c-2724d81809c7'::uuid),
    ('EDU-2026F-ISL-R17-L2','3815d31c-f227-5dd0-a1c9-07d892950863'::uuid),
    ('EDU-2026F-ISL-R15-L3','03f4d629-fcc1-5399-b94f-833770c866fe'::uuid),
    ('EDU-2026F-ISL-R16-L3','b6cadddc-41fb-488f-b56f-7a0fded045f8'::uuid)
    ) AS x(source_id,group_id)
  LOOP
    SELECT * INTO STRICT v_src FROM public.existing_schedule_source_rows
     WHERE college_id=v_college AND term_id=v_term AND
       schedule_version_id=v_version AND source_id=v_existing.source_id FOR UPDATE;
    SELECT g.*,s.id AS session_id,s.teaching_assignment_id AS assignment_id,
      s.room_id AS booked_room_id,s.instructor_id AS booked_teacher_id,
      s.cohort_id AS booked_cohort_id,s.plan_course_component_id AS booked_component_id,
      c.program_id AS cohort_program_id,c.level_id AS cohort_level_id,
      l.level_number,c.term_id AS cohort_term_id,o.course_id AS offering_course_id,
      pc.course_id AS plan_course_course_id,pc.study_plan_id AS plan_id,
      o.study_plan_id AS offering_plan_id,o.plan_course_id AS offering_pc_id,
      o.term_id AS offering_term_id,o.program_id AS offering_program_id,
      o.level_id AS offering_level_id
    INTO STRICT v_existing
    FROM public.delivery_groups g
    JOIN public.academic_cohorts c ON c.id=g.cohort_id
    JOIN public.academic_levels l ON l.id=c.level_id
    JOIN public.plan_courses pc ON pc.id=g.plan_course_id
    JOIN public.schedule_sessions s ON s.delivery_group_id=g.id AND
      s.schedule_version_id=v_version
    JOIN public.course_offerings o ON o.id=s.course_offering_id
    WHERE g.id=v_existing.group_id AND g.college_id=v_college;
    IF v_src.source_file NOT IN ('كيمياء.docx',
           'جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx')
       OR v_existing.cohort_term_id<>v_term OR v_existing.offering_term_id<>v_term
       OR v_existing.booked_cohort_id<>v_existing.cohort_id
       OR v_existing.booked_component_id<>v_existing.component_id
       OR v_existing.offering_course_id<>v_existing.plan_course_course_id
       OR v_existing.offering_plan_id<>v_existing.plan_id
       OR v_existing.offering_pc_id<>v_existing.plan_course_id
       OR v_existing.offering_program_id<>v_existing.cohort_program_id
       OR v_existing.offering_level_id<>v_existing.cohort_level_id
       OR v_existing.level_number<>v_src.level_number
       OR v_existing.assignment_id IS NULL
       OR EXISTS (SELECT 1 FROM public.existing_schedule_source_rows other
                  WHERE other.schedule_session_id=v_existing.session_id
                    AND other.id<>v_src.id)
    THEN RAISE EXCEPTION 'EDU26F_EXISTING_GROUP_DRIFT: %',v_src.source_id; END IF;
    IF v_src.schedule_session_id IS NOT NULL THEN
      IF v_src.schedule_session_id<>v_existing.session_id OR
         v_src.delivery_group_id<>v_existing.id OR v_src.status<>'imported'
      THEN RAISE EXCEPTION 'EDU26F_EXISTING_LINK_DRIFT: %',v_src.source_id; END IF;
      CONTINUE;
    END IF;
    IF v_src.status<>'pending' OR v_src.delivery_group_id IS NOT NULL
       OR v_src.teaching_assignment_id IS NOT NULL
    THEN RAISE EXCEPTION 'EDU26F_EXISTING_SOURCE_CHANGED: %',v_src.source_id; END IF;
    UPDATE public.existing_schedule_source_rows SET
      study_plan_id=v_existing.plan_id,plan_course_id=v_existing.plan_course_id,
      component_id=v_existing.component_id,cohort_id=v_existing.cohort_id,
      delivery_group_id=v_existing.id,teaching_assignment_id=v_existing.assignment_id,
      schedule_session_id=v_existing.session_id,room_id=v_existing.booked_room_id,
      instructor_ids=ARRAY[v_existing.booked_teacher_id],status='imported',
      pending_reasons=ARRAY[]::text[],
      notes=COALESCE(v_src.notes,'') || E'\n' ||
        'ربط بمقرر ومجموعة موجودين في مسودة الفصل؛ الموعد والقاعة الأصليان محفوظان في حقول المصدر، والجلسة التشغيلية معروضة بموعدها الفعلي.'
    WHERE id=v_src.id AND schedule_session_id IS NULL;
  END LOOP;

END;
$education_source_groups$;

SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

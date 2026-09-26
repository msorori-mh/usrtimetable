-- Four timetable cells with no operational session: three supervised practice
-- meetings and one unnamed elective. Exact cells, term and draft only.
CREATE OR REPLACE FUNCTION public.education_2026f_four_source_allowed(
  p_session public.schedule_sessions)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'pg_catalog','public' AS $scope$
  SELECT p_session.schedule_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
    AND p_session.college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    AND p_session.teaching_assignment_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.existing_schedule_source_rows src
      JOIN public.delivery_groups g ON g.id=src.delivery_group_id
      JOIN public.academic_cohorts ac ON ac.id=src.cohort_id
      JOIN public.course_offerings o ON o.id=p_session.course_offering_id
      JOIN public.plan_course_components pcc ON pcc.id=src.component_id
      JOIN public.schedule_versions v ON v.id=src.schedule_version_id
      JOIN public.academic_terms t ON t.id=src.term_id
      WHERE src.source_id IN (
          'EDU-SOURCE-2026-S1-20260922-S0133',
          'EDU-SOURCE-2026-S1-20260922-S0097',
          'EDU-SOURCE-2026-S1-20260922-S0064',
          'EDU-SOURCE-2026-S1-20260922-S0240')
        AND src.source_id=g.group_code
        AND src.college_id=p_session.college_id
        AND src.term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid
        AND src.schedule_version_id=p_session.schedule_version_id
        AND src.delivery_group_id=p_session.delivery_group_id
        AND src.cohort_id=p_session.cohort_id
        AND src.component_id=p_session.plan_course_component_id
        AND src.plan_course_id=g.plan_course_id
        AND g.cohort_id=ac.id AND g.component_id=pcc.id
        AND g.active AND NOT g.is_obsolete
        AND ac.term_id=src.term_id AND ac.study_system='regular'
        AND p_session.instructor_id=ANY(src.instructor_ids)
        AND o.college_id=src.college_id AND o.term_id=src.term_id
        AND o.plan_course_id=src.plan_course_id
        AND o.program_id=ac.program_id AND o.level_id=ac.level_id
        AND o.study_system='regular' AND o.existing_schedule AND o.is_active
        AND ((src.source_id='EDU-SOURCE-2026-S1-20260922-S0240'
              AND pcc.component_type='theory')
             OR (src.source_id<>'EDU-SOURCE-2026-S1-20260922-S0240'
              AND pcc.component_type='project'
              AND NOT pcc.counts_toward_regular_load))
        AND t.academic_year='2026-2027' AND t.term_type='first'
        AND v.status='draft'
        AND public.existing_schedule_intake_enabled(src.college_id,src.term_id)
    );
$scope$;

-- Keep every existing rule; add this one exact source predicate to the three
-- checks that would otherwise reject the temporary source-derived group.
DO $patch$
DECLARE def text; old_text text; new_text text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO STRICT def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='ensure_ss_college'
      AND pg_get_function_identity_arguments(p.oid)='';
  old_text:='AND NOT public.education_2026f_source_external_session_allowed(NEW) AND NOT EXISTS (';
  new_text:='AND NOT public.education_2026f_source_external_session_allowed(NEW) AND NOT public.education_2026f_four_source_allowed(NEW) AND NOT EXISTS (';
  IF position(new_text IN def)=0 THEN
    IF (length(def)-length(replace(def,old_text,'')))/length(old_text)<>1
    THEN RAISE EXCEPTION 'EDU26F_FOUR_EXTERNAL_GUARD_DRIFT'; END IF;
    def:=replace(def,old_text,new_text);
  END IF;
  old_text:='AND NOT public.education_2026f_project_session_allowed(NEW) THEN';
  new_text:='AND NOT public.education_2026f_project_session_allowed(NEW) AND NOT public.education_2026f_four_source_allowed(NEW) THEN';
  IF position(new_text IN def)=0 THEN
    IF (length(def)-length(replace(def,old_text,'')))/length(old_text)<>2
    THEN RAISE EXCEPTION 'EDU26F_FOUR_PROJECT_GUARD_DRIFT'; END IF;
    def:=replace(def,old_text,new_text);
  END IF;
  EXECUTE def;

  SELECT pg_get_functiondef(p.oid) INTO STRICT def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='guard_schedule_session_current_delivery_group'
      AND pg_get_function_identity_arguments(p.oid)='';
  old_text:='  fresh:=public.delivery_group_derivation_status(NEW.delivery_group_id,NEW.schedule_version_id);';
  new_text:='  IF public.education_2026f_four_source_allowed(NEW) THEN RETURN NEW; END IF;'||E'\n'||old_text;
  IF position(new_text IN def)=0 THEN
    IF (length(def)-length(replace(def,old_text,'')))/length(old_text)<>1
    THEN RAISE EXCEPTION 'EDU26F_FOUR_GROUP_GUARD_DRIFT'; END IF;
    EXECUTE replace(def,old_text,new_text);
  END IF;
END;
$patch$;

BEGIN;
DO $import$
DECLARE src public.existing_schedule_source_rows%ROWTYPE;
        cohort public.academic_cohorts%ROWTYPE;
        target_room public.rooms%ROWTYPE;
        offering public.course_offerings%ROWTYPE;
        course public.courses%ROWTYPE;
        pc public.plan_courses%ROWTYPE;
        component public.plan_course_components%ROWTYPE;
        grp public.delivery_groups%ROWTYPE;
        slot record;
        session_id uuid;
        is_elective boolean;
        v_college constant uuid:='1ee291b2-bec9-43d3-b42b-5a4f46946399';
        v_term constant uuid:='93705393-609d-4605-ae94-9572cd8b2090';
        v_version constant uuid:='7430bad7-2de7-5c90-9368-b214a199d6c3';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schedule_versions WHERE id=v_version)
  THEN RETURN; END IF;
  PERFORM 1 FROM public.schedule_versions v JOIN public.academic_terms t
    ON t.id=v.academic_term_id WHERE v.id=v_version AND v.college_id=v_college
    AND v.status='draft' AND t.id=v_term AND t.academic_year='2026-2027'
    AND t.term_type='first' FOR UPDATE OF v;
  IF NOT FOUND OR NOT public.existing_schedule_intake_enabled(v_college,v_term)
  THEN RAISE EXCEPTION 'EDU26F_FOUR_DRAFT_DRIFT'; END IF;

  FOR slot IN SELECT * FROM (VALUES
     ('EDU-SOURCE-2026-S1-20260922-S0133',3::smallint,'08:00'::time,
       '8bff90de-21aa-4708-9a85-5c0592ac914c'::uuid,'تربيه عمليه 1'),
     ('EDU-SOURCE-2026-S1-20260922-S0097',4::smallint,'08:00'::time,
       '8cfa4c00-ff65-46b3-bdaa-7fb1a57bdc4f'::uuid,'تربية عملية 1'),
     ('EDU-SOURCE-2026-S1-20260922-S0064',4::smallint,'12:00'::time,
       '8cfa4c00-ff65-46b3-bdaa-7fb1a57bdc4f'::uuid,'تربيةعملية1'),
     ('EDU-SOURCE-2026-S1-20260922-S0240',0::smallint,'08:00'::time,
       '8bff90de-21aa-4708-9a85-5c0592ac914c'::uuid,'اختياري2')
  ) x(source_id,day_of_week,start_time,room_id,course_name)
  LOOP
    SELECT * INTO STRICT src FROM public.existing_schedule_source_rows WHERE
      college_id=v_college AND term_id=v_term AND schedule_version_id=v_version
      AND source_id=slot.source_id FOR UPDATE;
    is_elective:=(slot.source_id='EDU-SOURCE-2026-S1-20260922-S0240');
    IF src.raw_course<>slot.course_name OR src.level_number<>4
      OR src.end_time-src.start_time<>interval '2 hours'
      OR src.status NOT IN ('pending','imported')
      OR cardinality(src.instructor_ids)<>1
      OR (is_elective AND src.source_file<>'الجدول الدارسي الفصل الاول 27-نعمان_085037.xlsx')
      OR (NOT is_elective AND src.plan_course_id IS NULL)
    THEN RAISE EXCEPTION 'EDU26F_FOUR_SOURCE_DRIFT: %',src.source_id; END IF;
    IF is_elective THEN
      SELECT * INTO STRICT cohort FROM public.academic_cohorts WHERE
        id='f85d554e-3a3e-4210-b1de-51ca66193458'::uuid
        AND term_id=v_term AND study_system='regular' AND active;
    ELSE
      SELECT * INTO STRICT cohort FROM public.academic_cohorts WHERE
        id=src.cohort_id AND term_id=v_term AND study_system='regular' AND active;
    END IF;
    SELECT * INTO STRICT target_room FROM public.rooms WHERE id=slot.room_id
      AND college_id=v_college AND is_active AND room_type='lecture_hall'
      AND capacity>=cohort.expected_students;
    IF is_elective THEN
      INSERT INTO public.courses
        (college_id,department_id,code,name,credit_hours,theory_hours,practical_hours)
      SELECT v_college,p.department_id,'EDU-26F-SRC-'||src.source_id,
        src.raw_course,NULL,2,0 FROM public.academic_programs p
        WHERE p.id=cohort.program_id AND p.college_id=v_college
      ON CONFLICT (college_id,code) DO NOTHING;
      SELECT * INTO STRICT course FROM public.courses WHERE
        college_id=v_college AND code='EDU-26F-SRC-'||src.source_id
        AND name=src.raw_course AND theory_hours=2 AND practical_hours=0;
      INSERT INTO public.plan_courses
        (college_id,study_plan_id,course_id,level_id,semester,lectures_per_week,
         labs_per_week,lecture_session_duration,lab_session_duration)
      VALUES (v_college,'5c8c2f31-91e4-4950-a29e-0ca0e2fffe9b'::uuid,
        course.id,cohort.level_id,1,1,0,2,0)
      ON CONFLICT (study_plan_id,course_id) DO NOTHING;
      SELECT * INTO STRICT pc FROM public.plan_courses WHERE course_id=course.id
        AND study_plan_id='5c8c2f31-91e4-4950-a29e-0ca0e2fffe9b'::uuid
        AND level_id=cohort.level_id;
      INSERT INTO public.course_offerings
        (college_id,term_id,course_id,program_id,level_id,study_plan_id,
         plan_course_id,study_system,expected_students,enrollment_count_status,
         existing_schedule,notes)
      SELECT v_college,v_term,course.id,cohort.program_id,cohort.level_id,
        pc.study_plan_id,pc.id,'regular',cohort.expected_students,'unverified',true,
        'مقرر اختياري بالاسم الوارد في صف المصدر '||src.source_id||
        '؛ رابط خطة فني لهذا الفصل فقط، ويتطلب تحديد هوية المقرر قبل الاعتماد.'
      WHERE NOT EXISTS (SELECT 1 FROM public.course_offerings
        WHERE term_id=v_term AND plan_course_id=pc.id AND
          program_id=cohort.program_id AND level_id=cohort.level_id);
      UPDATE public.existing_schedule_source_rows SET study_plan_id=pc.study_plan_id,
        plan_course_id=pc.id,cohort_id=cohort.id WHERE id=src.id;
      src.study_plan_id:=pc.study_plan_id;
      src.plan_course_id:=pc.id;
      src.cohort_id:=cohort.id;
    ELSE
      SELECT * INTO STRICT pc FROM public.plan_courses WHERE id=src.plan_course_id
        AND study_plan_id=src.study_plan_id AND level_id=cohort.level_id;
    END IF;
    SELECT * INTO STRICT offering FROM public.course_offerings WHERE
      term_id=v_term AND plan_course_id=pc.id AND program_id=cohort.program_id
      AND level_id=cohort.level_id AND existing_schedule AND is_active
      AND study_system='regular';
    INSERT INTO public.plan_course_components
      (college_id,plan_course_id,component_type,weekly_contact_hours,
       required_room_type_id,counts_toward_regular_load,counts_toward_overtime,
       compensation_mode,is_timetabled)
    VALUES (v_college,pc.id,CASE WHEN is_elective THEN 'theory' ELSE 'project' END,
      2,target_room.room_type_id,is_elective,false,
      CASE WHEN is_elective THEN 'per_hour' ELSE 'none' END,is_elective)
    ON CONFLICT (plan_course_id,component_type) DO NOTHING;
    SELECT * INTO STRICT component FROM public.plan_course_components WHERE
      plan_course_id=pc.id AND component_type=CASE WHEN is_elective THEN 'theory' ELSE 'project' END
      AND weekly_contact_hours=2 AND counts_toward_regular_load=is_elective;
    SELECT * INTO grp FROM public.delivery_groups WHERE cohort_id=cohort.id
      AND component_id=component.id AND group_code=src.source_id;
    IF NOT FOUND THEN
      INSERT INTO public.delivery_groups
        (college_id,cohort_id,plan_course_id,component_id,group_code,
         expected_students,capacity_limit,excluded_from_standard_workload,active)
      VALUES (v_college,cohort.id,pc.id,component.id,src.source_id,
        cohort.expected_students,cohort.expected_students,NOT is_elective,true)
      RETURNING * INTO grp;
    END IF;
    IF grp.plan_course_id<>pc.id OR NOT grp.active OR grp.is_obsolete
      OR grp.excluded_from_standard_workload IS DISTINCT FROM NOT is_elective
      OR (src.delivery_group_id IS NOT NULL AND src.delivery_group_id<>grp.id)
    THEN RAISE EXCEPTION 'EDU26F_FOUR_GROUP_DRIFT: %',src.source_id; END IF;
    UPDATE public.existing_schedule_source_rows SET component_id=component.id,
      cohort_id=cohort.id,delivery_group_id=grp.id WHERE id=src.id;
    IF src.schedule_session_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.schedule_sessions s WHERE
          s.id=src.schedule_session_id AND s.delivery_group_id=grp.id
          AND s.day_of_week=slot.day_of_week AND s.start_time=slot.start_time
          AND s.end_time=slot.start_time+interval '2 hours' AND s.room_id=slot.room_id)
      THEN RAISE EXCEPTION 'EDU26F_FOUR_IMPORTED_DRIFT: %',src.source_id; END IF;
      CONTINUE;
    END IF;
    IF src.status<>'pending' OR EXISTS (SELECT 1 FROM public.schedule_sessions s
      WHERE s.schedule_version_id=v_version AND s.day_of_week=slot.day_of_week
        AND s.start_time<slot.start_time+interval '2 hours'
        AND s.end_time>slot.start_time AND
        (s.room_id=slot.room_id OR s.cohort_id=cohort.id
         OR s.instructor_id=src.instructor_ids[1]))
    THEN RAISE EXCEPTION 'EDU26F_FOUR_SLOT_CONFLICT: %',src.source_id; END IF;
    INSERT INTO public.schedule_sessions
      (college_id,schedule_version_id,course_offering_id,instructor_id,room_id,
       cohort_id,plan_course_component_id,delivery_group_id,study_system,
       day_of_week,start_time,end_time,session_type,expected_students,source_type)
    VALUES (v_college,v_version,offering.id,src.instructor_ids[1],slot.room_id,
       cohort.id,component.id,grp.id,'regular',slot.day_of_week,slot.start_time,
       slot.start_time+interval '2 hours',
       CASE WHEN is_elective THEN 'lecture' ELSE 'seminar' END,
       cohort.expected_students,'manual') RETURNING id INTO session_id;
    UPDATE public.existing_schedule_source_rows SET schedule_session_id=session_id,
      room_id=slot.room_id,status='imported',pending_reasons=ARRAY[
        CASE WHEN is_elective THEN
          'الاسم اختياري2 كما ورد في الجدول؛ تحديد المقرر النهائي وإسناده الإداري مطلوب قبل الاعتماد.'
        ELSE 'جلسة تربية عملية من جدول القسم لهذا الفصل؛ خارج عبء التدريس المنتظم، والإسناد الإداري يحتاج تحققاً.' END],
      notes=coalesce(src.notes,'')||E'\n'||
        'استثناء مسودة الفصل الأول 2026-2027: موعد الملف '||src.raw_day||
        ' '||src.raw_time||' / '||coalesce(src.raw_room,'—')||
        '؛ الموعد التشغيلي '||slot.day_of_week::text||' '||
        slot.start_time::text||' / '||target_room.name||
        '، بلا اعتماد إسناد مالي.'
      WHERE id=src.id AND schedule_session_id IS NULL;
  END LOOP;
END;
$import$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

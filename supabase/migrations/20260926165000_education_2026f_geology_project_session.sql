-- The geology timetable includes two weekly hours of graduation research.
-- This exact draft records the meeting while the component remains excluded
-- from ordinary teaching workload and the lecturer remains unverified.
CREATE OR REPLACE FUNCTION public.education_2026f_project_session_allowed(
  p_session public.schedule_sessions)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'pg_catalog','public' AS $project$
  SELECT p_session.schedule_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
    AND p_session.college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    AND p_session.delivery_group_id='63cbdb0e-af9e-561d-abe2-7e71b2d0c10a'::uuid
    AND p_session.teaching_assignment_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.existing_schedule_source_rows src
      JOIN public.plan_course_components comp ON comp.id=src.component_id
      JOIN public.schedule_versions v ON v.id=src.schedule_version_id
      JOIN public.instructors i ON i.id=p_session.instructor_id
      WHERE src.source_id='EDU-SOURCE-2026-S1-20260922-S0304'
        AND src.delivery_group_id=p_session.delivery_group_id
        AND src.cohort_id=p_session.cohort_id
        AND src.component_id=p_session.plan_course_component_id
        AND src.schedule_version_id=p_session.schedule_version_id
        AND src.term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid
        AND src.college_id=p_session.college_id
        AND p_session.instructor_id=ANY(src.instructor_ids)
        AND i.external_source='EDU26F-NAME:دصالحغريب'
        AND comp.component_type='project' AND NOT comp.counts_toward_regular_load
        AND v.status='draft'
        AND public.existing_schedule_intake_enabled(src.college_id,src.term_id));
$project$;

DO $patch$
DECLARE def text; old_part text :=
  'IF pcc_type = ''project'' AND COALESCE(pcc_regular, true) = false THEN';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO STRICT def FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='ensure_ss_college'
      AND pg_get_function_identity_arguments(p.oid)='';
  IF position('AND NOT public.education_2026f_project_session_allowed(NEW)' IN def)>0
  THEN RETURN; END IF;
  IF (length(def)-length(replace(def,old_part,'')))/length(old_part)<>2
  THEN RAISE EXCEPTION 'EDU26F_PROJECT_GUARD_DRIFT'; END IF;
  EXECUTE replace(def,old_part,
    'IF pcc_type = ''project'' AND COALESCE(pcc_regular, true) = false AND NOT public.education_2026f_project_session_allowed(NEW) THEN');
END;
$patch$;

BEGIN;
DO $import$
DECLARE src public.existing_schedule_source_rows%ROWTYPE;
        teacher uuid; offering uuid; session_id uuid;
BEGIN
  SELECT * INTO STRICT src FROM public.existing_schedule_source_rows WHERE
    source_id='EDU-SOURCE-2026-S1-20260922-S0304'
    AND college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
    AND term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid
    AND schedule_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid FOR UPDATE;
  IF src.raw_course<>'بحث تخرج' OR src.raw_teacher<>'د. صالح غريب'
    OR src.raw_room<>'مع1' OR src.day_of_week<>1
    OR src.start_time<>'10:00'::time OR src.end_time<>'12:00'::time
    OR src.room_id<>'1e69ae96-b62d-4f27-a8e8-e8a8e566def9'::uuid
    OR src.cohort_id<>'e96d3cb4-bc45-5a7b-9225-57691e769c15'::uuid
    OR src.delivery_group_id<>'63cbdb0e-af9e-561d-abe2-7e71b2d0c10a'::uuid
    OR src.component_id<>'45f32022-9278-4fab-b525-959490ffe837'::uuid
    OR NOT EXISTS (SELECT 1 FROM public.schedule_versions WHERE id=src.schedule_version_id
      AND status='draft')
  THEN RAISE EXCEPTION 'EDU26F_GEOLOGY_SOURCE_DRIFT'; END IF;
  IF src.schedule_session_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.schedule_sessions s WHERE s.id=src.schedule_session_id
       AND s.delivery_group_id=src.delivery_group_id AND s.day_of_week=1
       AND s.start_time='10:00'::time AND s.end_time='12:00'::time
       AND s.room_id=src.room_id)
    THEN RAISE EXCEPTION 'EDU26F_GEOLOGY_SESSION_DRIFT'; END IF;
    RETURN;
  END IF;
  IF src.status<>'pending' OR EXISTS (SELECT 1 FROM public.schedule_sessions s
    WHERE s.schedule_version_id=src.schedule_version_id AND s.day_of_week=1
      AND s.start_time<'12:00'::time AND s.end_time>'10:00'::time
      AND (s.room_id=src.room_id OR s.cohort_id=src.cohort_id))
  THEN RAISE EXCEPTION 'EDU26F_GEOLOGY_SLOT_CONFLICT'; END IF;
  SELECT id INTO teacher FROM public.instructors WHERE
    college_id=src.college_id AND external_source='EDU26F-NAME:دصالحغريب';
  IF NOT FOUND THEN
    INSERT INTO public.instructors(college_id,department_id,full_name,employment_type,
      max_weekly_hours,external_source,notes)
    SELECT src.college_id,p.department_id,'[اسم من جدول هذا الفصل] د. صالح غريب',
      'unknown',NULL,'EDU26F-NAME:دصالحغريب',
      'اسم وارد في جدول الجيولوجيا للفصل الأول 2026-2027، دون توثيق هوية أو اعتماد إسناد مالي.'
    FROM public.academic_programs p WHERE p.id='0f7c0451-6722-498a-b158-589c7125a495'::uuid
    RETURNING id INTO teacher;
  END IF;
  IF teacher IS NULL OR NOT EXISTS (SELECT 1 FROM public.instructors WHERE id=teacher
    AND is_active AND availability_status='available')
  THEN RAISE EXCEPTION 'EDU26F_GEOLOGY_NAME_UNAVAILABLE'; END IF;
  SELECT id INTO STRICT offering FROM public.course_offerings WHERE
    id='2b8e2d28-7b74-5c64-9917-699637e9821b'::uuid
    AND term_id=src.term_id AND plan_course_id=src.plan_course_id;
  UPDATE public.existing_schedule_source_rows SET instructor_ids=ARRAY[teacher]
    WHERE id=src.id;
  INSERT INTO public.schedule_sessions
    (college_id,schedule_version_id,course_offering_id,instructor_id,room_id,
     cohort_id,plan_course_component_id,delivery_group_id,study_system,day_of_week,
     start_time,end_time,session_type,expected_students,source_type)
  VALUES (src.college_id,src.schedule_version_id,offering,teacher,src.room_id,
    src.cohort_id,src.component_id,src.delivery_group_id,'regular',1,
    '10:00','12:00','seminar',40,'manual') RETURNING id INTO session_id;
  UPDATE public.existing_schedule_source_rows SET schedule_session_id=session_id,
    status='imported',pending_reasons=ARRAY[
      'اسم المشرف من الجدول لم يتحقق من ملف الموظفين؛ جلسة المشروع مستثناة من العبء التدريسي المنتظم لهذا الفصل فقط.'
    ],notes=coalesce(src.notes,'')||E'\n'||
      'استثناء مسودة الفصل الأول 2026-2027: حصة بحث التخرج كما في المصدر، بلا إسناد مالي أو احتساب عبء منتظم.'
    WHERE id=src.id AND schedule_session_id IS NULL;
END;
$import$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

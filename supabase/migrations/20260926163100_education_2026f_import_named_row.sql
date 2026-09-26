-- Import one exact source cell into this term only.
CREATE OR REPLACE FUNCTION public.education_2026f_import_named_row(
 p_source text,p_teacher uuid,p_name_key text,p_day smallint,p_start time,p_room uuid)
RETURNS void LANGUAGE plpgsql SET search_path TO 'pg_catalog','public' AS $import$
DECLARE
  src public.existing_schedule_source_rows%ROWTYPE;
  co public.course_offerings%ROWTYPE;
  g public.delivery_groups%ROWTYPE;
  c public.academic_cohorts%ROWTYPE;
  r public.rooms%ROWTYPE;
  i public.instructors%ROWTYPE;
  v_teacher uuid;
  v_assignment uuid;
  v_session uuid;
  v_end time;
  v_level integer;
  v_kind text;
  v_name text;
  v_source_note text;
  v_count integer;
BEGIN
  SELECT * INTO STRICT src FROM public.existing_schedule_source_rows
    WHERE college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
      AND term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid
      AND schedule_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
      AND source_id=p_source FOR UPDATE;
  IF src.source_file NOT IN ('كيمياء.docx',
       'جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx')
     OR NOT EXISTS (SELECT 1 FROM public.schedule_versions WHERE id=src.schedule_version_id
       AND status='draft')
     OR src.delivery_group_id IS NULL OR src.component_id IS NULL
     OR src.day_of_week IS NULL OR src.start_time IS NULL OR src.end_time IS NULL
     OR (p_teacher IS NULL AND p_name_key IS NULL)
     OR (p_teacher IS NOT NULL AND p_name_key IS NOT NULL)
  THEN RAISE EXCEPTION 'EDU26F_IMPORT_SCOPE: %',p_source; END IF;

  SELECT * INTO STRICT g FROM public.delivery_groups WHERE id=src.delivery_group_id
     AND college_id=src.college_id AND cohort_id=src.cohort_id
     AND plan_course_id=src.plan_course_id AND component_id=src.component_id
     AND group_code=src.source_id AND active AND NOT is_obsolete;
  SELECT * INTO STRICT c FROM public.academic_cohorts WHERE id=g.cohort_id
     AND term_id=src.term_id AND study_system='regular';
  SELECT * INTO STRICT co FROM public.course_offerings WHERE
     plan_course_id=src.plan_course_id AND term_id=src.term_id AND
     program_id=c.program_id AND level_id=c.level_id AND study_system='regular'
     AND existing_schedule AND is_active;
  SELECT * INTO STRICT r FROM public.rooms WHERE id=p_room AND college_id=src.college_id
     AND is_active;
  SELECT component_type INTO STRICT v_kind FROM public.plan_course_components
     WHERE id=src.component_id AND college_id=src.college_id;
  SELECT level_number INTO STRICT v_level FROM public.academic_levels WHERE id=c.level_id;
  v_end := p_start+(src.end_time-src.start_time);
  IF p_day NOT IN (0,1,2,3,4,6) OR p_start<'08:00'::time
     OR v_end>'14:00'::time OR (r.available_days IS NOT NULL
       AND NOT p_day=ANY(r.available_days))
     OR (r.available_start_time IS NOT NULL AND p_start<r.available_start_time)
     OR (r.available_end_time IS NOT NULL AND v_end>r.available_end_time)
     OR r.capacity<coalesce(g.expected_students,50)
     OR ((v_kind='practical') IS DISTINCT FROM (r.name LIKE 'معمل %'))
     OR (v_kind='practical' AND r.id<>src.room_id)
  THEN RAISE EXCEPTION 'EDU26F_SLOT_OR_ROOM_INVALID: %',p_source; END IF;

  IF p_teacher IS NOT NULL THEN
    SELECT * INTO STRICT i FROM public.instructors WHERE id=p_teacher AND
      is_active AND availability_status='available';
    v_teacher:=i.id;
    IF i.college_id<>src.college_id THEN
      v_source_note:='المدرس مثبت في كلية أخرى بالاسم الوارد؛ حجز جدول فقط دون اعتماد إسناد إداري.';
    END IF;
  ELSE
    IF p_name_key<>coalesce(regexp_replace(src.raw_teacher,
      '[[:space:].]','','g'),src.source_id) AND
      NOT (p_name_key='اسماء' AND src.raw_teacher ~ 'اسماء|أسماء') AND
      NOT (p_name_key='تيسير' AND src.raw_teacher ~ 'تيسير|تيسبر') AND
      NOT (p_name_key='جلالالبعداني' AND src.raw_teacher LIKE '%جلال البعداني%')
    THEN RAISE EXCEPTION 'EDU26F_SOURCE_NAME_MISMATCH: %',p_source; END IF;
    SELECT count(*) INTO v_count FROM public.instructors WHERE
      college_id=src.college_id AND external_source='EDU26F-NAME:'||p_name_key;
    IF v_count>1 THEN RAISE EXCEPTION 'EDU26F_DUPLICATE_PROVISIONAL_NAME: %',p_name_key; END IF;
    IF v_count=0 THEN
      v_name:=CASE WHEN src.raw_teacher IS NULL THEN
        '[غير مذكور في الجدول — '||src.raw_course||']'
        ELSE '[اسم من جدول هذا الفصل] '||src.raw_teacher END;
      INSERT INTO public.instructors
        (college_id,department_id,full_name,employment_type,max_weekly_hours,
         external_source,notes)
      SELECT src.college_id,p.department_id,v_name,'unknown',NULL,
        'EDU26F-NAME:'||p_name_key,
        'اسم لأغراض عرض وحجز جدول الفصل الأول 2026-2027 فقط؛ غير موثق بهوية ولا إسناد مالي.'
      FROM public.academic_programs p WHERE p.id=c.program_id
      RETURNING * INTO i;
    ELSE
      SELECT * INTO STRICT i FROM public.instructors WHERE
        college_id=src.college_id AND external_source='EDU26F-NAME:'||p_name_key;
    END IF;
    IF NOT i.is_active OR i.availability_status<>'available' THEN
      RAISE EXCEPTION 'EDU26F_PROVISIONAL_NAME_INACTIVE: %',p_name_key;
    END IF;
    v_teacher:=i.id;
    v_source_note:='اسم المدرس في الملف غير محقق من سجل الموظفين؛ الجلسة مؤقتة بلا إسناد مالي.';
  END IF;

  IF src.schedule_session_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.schedule_sessions ss WHERE
      ss.id=src.schedule_session_id AND ss.schedule_version_id=src.schedule_version_id
      AND ss.delivery_group_id=g.id AND ss.instructor_id=v_teacher
      AND ss.room_id=r.id AND ss.day_of_week=p_day AND ss.start_time=p_start
      AND ss.end_time=v_end) THEN
      RAISE EXCEPTION 'EDU26F_ALREADY_IMPORTED_DRIFT: %',p_source;
    END IF;
    RETURN;
  END IF;
  IF src.status<>'pending' OR EXISTS (
    SELECT 1 FROM public.schedule_sessions ss WHERE ss.schedule_version_id=src.schedule_version_id
      AND ss.day_of_week=p_day AND ss.start_time<v_end AND ss.end_time>p_start
      AND (ss.room_id=r.id OR ss.instructor_id=v_teacher OR
        (ss.cohort_id=g.cohort_id AND ss.delivery_group_id<>g.id) OR
        EXISTS (SELECT 1 FROM public.academic_cohorts other_c
          JOIN public.academic_levels other_l ON other_l.id=other_c.level_id
          WHERE other_c.id=ss.cohort_id AND other_c.program_id=c.program_id
            AND other_l.level_number=v_level)))
    OR EXISTS (
      SELECT 1 FROM public.schedule_sessions ss
      JOIN public.schedule_versions sv ON sv.id=ss.schedule_version_id
      JOIN public.academic_terms t ON t.id=sv.academic_term_id
      WHERE ss.college_id<>src.college_id AND ss.instructor_id=v_teacher
        AND sv.status IN ('draft','published')
        AND t.academic_year='2026-2027' AND t.term_type='first'
        AND ss.day_of_week=p_day AND ss.start_time<v_end AND ss.end_time>p_start)
  THEN RAISE EXCEPTION 'EDU26F_SLOT_CONFLICT: %',p_source; END IF;

  UPDATE public.existing_schedule_source_rows SET instructor_ids=ARRAY[v_teacher]
    WHERE id=src.id;
  IF p_teacher IS NOT NULL AND i.college_id=src.college_id AND EXISTS (
      SELECT 1 FROM public.faculty_identity_links fl
      JOIN faculty_private.home_profiles hp ON hp.identity_id=fl.identity_id
      WHERE fl.instructor_id=i.id AND hp.home_college_id=src.college_id)
  THEN
    INSERT INTO public.teaching_assignments
      (college_id,course_offering_id,instructor_id,session_type,weekly_hours,
       assigned_component_hours,cohort_id,plan_course_component_id,
       delivery_group_id,expected_students)
    VALUES (src.college_id,co.id,v_teacher,
      CASE WHEN v_kind='practical' THEN 'lab' ELSE 'lecture' END,
      extract(epoch FROM (src.end_time-src.start_time))/3600,
      extract(epoch FROM (src.end_time-src.start_time))/3600,
      c.id,src.component_id,g.id,g.expected_students) RETURNING id INTO v_assignment;
  ELSIF v_source_note IS NULL THEN
    v_source_note:='المحاضر مثبت في سجل الكلية دون ملف إسناد معتمد لهذا المقرر.';
  END IF;

  INSERT INTO public.schedule_sessions
    (college_id,schedule_version_id,course_offering_id,teaching_assignment_id,
     instructor_id,room_id,cohort_id,plan_course_component_id,delivery_group_id,
     study_system,day_of_week,start_time,end_time,session_type,expected_students,source_type)
  VALUES (src.college_id,src.schedule_version_id,co.id,v_assignment,v_teacher,
    r.id,c.id,src.component_id,g.id,'regular',p_day,p_start,v_end,
    CASE WHEN v_kind='practical' THEN 'lab' ELSE 'lecture' END,
    g.expected_students,'manual') RETURNING id INTO v_session;
  UPDATE public.existing_schedule_source_rows SET
    schedule_session_id=v_session,teaching_assignment_id=v_assignment,
    room_id=r.id,status='imported',
    pending_reasons=CASE WHEN v_source_note IS NULL THEN ARRAY[]::text[]
      ELSE ARRAY[v_source_note] END,
    notes=coalesce(src.notes,'')||E'\n'||
      'استثناء جدول الفصل الأول 2026-2027: جلسة من صف المصدر؛ الموعد الأصلي '||
      src.raw_day||' '||src.raw_time||' / '||coalesce(src.raw_room,'—')||
      '؛ التشغيل '||p_day::text||' '||p_start::text||'-'||v_end::text||
      ' / '||r.name||'. '||coalesce(v_source_note,'')
  WHERE id=src.id AND schedule_session_id IS NULL;
END;
$import$;

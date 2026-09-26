-- Complete the seven remaining weekly delivery groups in the Education draft.
-- This is a one-term operational timetable exception. Source timetable text,
-- original times and original rooms stay available for later reconciliation.
BEGIN;

DO $education_remaining$
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
                 WHERE id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid)
  THEN RETURN; END IF;
  SELECT * INTO STRICT v_version FROM public.schedule_versions
   WHERE id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid FOR UPDATE;
  SELECT * INTO STRICT v_term FROM public.academic_terms
   WHERE id=v_version.academic_term_id;
  IF v_version.status <> 'draft'
     OR v_version.college_id <> '1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
     OR v_term.id <> '93705393-609d-4605-ae94-9572cd8b2090'::uuid
     OR v_term.college_id <> v_version.college_id
     OR v_term.academic_year <> '2026-2027' OR v_term.term_type <> 'first'
     OR NOT public.existing_schedule_intake_enabled(v_version.college_id,v_term.id)
     OR NOT EXISTS (SELECT 1 FROM public.colleges c WHERE c.id=v_version.college_id
                    AND btrim(c.name)='كلية التربية والعلوم')
  THEN RAISE EXCEPTION 'EDUCATION_FIRST_TERM_DRAFT_REQUIRED'; END IF;

  FOR v_spec IN SELECT * FROM (VALUES
   -- Quran Arabic: the source's Monday 10-12 slot is occupied by Biology
   -- Arabic. Monday 08-10 in ق13 keeps the same teaching day and instructor.
   ('EDU-SOURCE-2026-S1-20260922-S0170',
    'b77596ca-ebb4-45a7-9093-1be1e5344149'::uuid,
    '842bbb0c-aafa-400e-8a8e-4d9e830a8beb'::uuid,
    'جدول_الفصل_الأول_2026_ـ_2027م-2.docx','مهارات اللغة العربية 1',
    ARRAY['9f48f373-4670-4ce8-90b4-7093cdd28e6d']::uuid[],
    ARRAY['9f48f373-4670-4ce8-90b4-7093cdd28e6d']::uuid[],
    '9f48f373-4670-4ce8-90b4-7093cdd28e6d'::uuid,
    '2026-09-25 23:35:45.978614+00'::timestamptz,
    1,1,'10:00'::time,'12:00'::time,'القردعي',
    1,'08:00'::time,'10:00'::time,'ق13','theory','lecture',2,
    'Original Monday 10-12 teacher and room are occupied by Biology Arabic; Monday 08-10 in ق13 is free.'),
   -- Biology Islamic Culture: preserve its day/time; use the vacant merged hall.
   ('EDU-SOURCE-2026-S1-20260922-S0125',
    'a6cba857-e6d4-4e32-80fb-770575bf10b9'::uuid,
    'e0e41648-5f9d-4e71-97f5-f41517d9aa1b'::uuid,
    'جدول قسم علوم الحياة للفصل الأول2026-2027م.docx','ثقافه اسلامية',
    ARRAY['70ac5da1-6613-478f-80b2-68e0bc601284']::uuid[],
    ARRAY['70ac5da1-6613-478f-80b2-68e0bc601284']::uuid[],
    '70ac5da1-6613-478f-80b2-68e0bc601284'::uuid,
    '2026-09-25 22:18:46.452224+00'::timestamptz,
    1,2,'10:00'::time,'12:00'::time,'القردعي',
    2,'10:00'::time,'12:00'::time,'المدمجة','theory','lecture',2,
    'Geology Arabic occupies القردعي at the source time; the merged hall is free.'),
   -- The named source lecturer Tasnim is inactive. The group already has an
   -- active practical assignment to Nasim; Wednesday retains a four-day week.
   ('EDU-SOURCE-2026-S1-20260922-S0141',
    'ac727651-eb7f-4e06-8f36-b190ba01f44f'::uuid,
    'f3afc003-414a-4448-b0a3-ae694ce3fea6'::uuid,
    'جدول قسم علوم الحياة للفصل الأول2026-2027م.docx','كيمياء تحليليه',
    ARRAY['36723143-518f-552e-9276-5fecea0f1dba']::uuid[],
    ARRAY['317a197d-7611-5915-9d0e-bc7e8081f853']::uuid[],
    '317a197d-7611-5915-9d0e-bc7e8081f853'::uuid,
    '2026-09-25 22:20:34.781058+00'::timestamptz,
    3,4,'10:00'::time,'12:00'::time,'معمل الكيمياء',
    3,'08:00'::time,'10:00'::time,'معمل الكيمياء','practical','lab',2,
    'Tasnim is inactive; active group assignment Nasim uses an available Wednesday chemistry lab slot without adding a fifth attendance day.'),
   -- Two adjacent Thursday physics practicals avoid the Level 3 calculus
   -- overlap and use the subject-specific lab sequentially.
   ('EDU-SOURCE-2026-S1-20260922-S0101',
    '0076b007-7ffe-4234-aa36-4157a685881c'::uuid,
    'd6d2049a-c71f-4d9f-b4c7-09b4bdeafc10'::uuid,
    'جدول قسم الفيزياء للفصل الاول 1111 2027.docx','معمل خواص مادة',
    ARRAY['c2562839-b7ff-5c35-9c99-3e50833aea52','2514e3cc-6862-5411-bb6a-0a69888999c4']::uuid[],
    ARRAY['f2ff0501-b0fc-5466-9953-3d3a576ecf62','2514e3cc-6862-5411-bb6a-0a69888999c4']::uuid[],
    'f2ff0501-b0fc-5466-9953-3d3a576ecf62'::uuid,
    '2026-09-25 22:23:08.24458+00'::timestamptz,
    2,4,'12:00'::time,'14:00'::time,'معمل الفيزياء',
    4,'10:00'::time,'12:00'::time,'معمل الفيزياء','practical','lab',2,
    'Move the properties lab two hours earlier to free the same lab for the Level 3 atomic practical; current primary group assignment is Adnan al-Majmar.'),
   ('EDU-SOURCE-2026-S1-20260922-S0099',
    '046c4f41-ddfd-4790-88f7-75a68fa739ee'::uuid,
    'd5682941-2545-4a45-ae59-bdd6b5db3637'::uuid,
    'جدول قسم الفيزياء للفصل الاول 1111 2027.docx','معمل ذرية وحديثه',
    ARRAY['26bb2435-dd59-4dd9-9efa-9735a92ae7aa','c81efcf2-5312-5e81-a754-67d1a9c7901f']::uuid[],
    ARRAY['c81efcf2-5312-5e81-a754-67d1a9c7901f','26bb2435-dd59-4dd9-9efa-9735a92ae7aa']::uuid[],
    'c81efcf2-5312-5e81-a754-67d1a9c7901f'::uuid,
    '2026-09-25 22:23:54.329633+00'::timestamptz,
    3,4,'10:00'::time,'12:00'::time,'معمل الفيزياء',
    4,'12:00'::time,'14:00'::time,'معمل الفيزياء','practical','lab',2,
    'Source slot overlaps Level 3 calculus until 11; Thursday 12-14 is free, with source-listed lab assistant Shaima as operational primary.'),
   -- The Sunday source-adjacent slot is occupied across colleges by Noura's
   -- source-listed team assignment; Wednesday 12-14 keeps her four-day week.
   ('EDU-SOURCE-2026-S1-20260922-S0067',
    'd183a739-2122-401c-9ecb-1de07213ae94'::uuid,
    '4af99df9-ac82-481b-8464-79a45da3b319'::uuid,
    'جدول قسم الفيزياء للفصل الاول 1111 2027.docx','مهارات حاسوب',
    ARRAY['3c1e2a05-d2bc-498f-8bd1-84fd5cf6f5af']::uuid[],
    ARRAY['d0680f97-8d00-4fd6-9ccc-2f4b225b62f2']::uuid[],
    'd0680f97-8d00-4fd6-9ccc-2f4b225b62f2'::uuid,
    '2026-09-25 22:16:11.821418+00'::timestamptz,
    2,6,'10:00'::time,'12:00'::time,'ق7',
    3,'12:00'::time,'14:00'::time,'ق8','theory','lecture',2,
    'Source instructor is unnamed; the active group assignment Noura is free Wednesday 12-14 in ق8, her existing teaching day. Sunday 12-14 is busy in another college source-listed teaching team.'),
   ('EDU-SOURCE-2026-S1-20260922-S0077',
    'e5207ef2-f275-455d-87cd-6eeb3ac38089'::uuid,
    'bcc374bc-b38d-4d81-95b5-eba80e62d2a9'::uuid,
    'جدول قسم الفيزياء للفصل الاول 1111 2027.docx','معمل الفلك',
    ARRAY['c2562839-b7ff-5c35-9c99-3e50833aea52','2514e3cc-6862-5411-bb6a-0a69888999c4']::uuid[],
    ARRAY['f2ff0501-b0fc-5466-9953-3d3a576ecf62','2514e3cc-6862-5411-bb6a-0a69888999c4']::uuid[],
    'f2ff0501-b0fc-5466-9953-3d3a576ecf62'::uuid,
    '2026-09-25 22:24:36.016542+00'::timestamptz,
    4,0,'11:00'::time,'14:00'::time,'معمل الفيزياء',
    0,'11:00'::time,'14:00'::time,'معمل الفيزياء','practical','lab',3,
    'The source already fits the Sunday astronomy lab; current active group assignment supplies the primary Adnan al-Majmar, and Fatima remains recorded on the source team.')
  ) AS x(source_id,group_id,assignment_id,source_file,source_course,
         original_instructors,operational_instructors,primary_instructor_id,
         old_assignment_updated_at,level_number,source_day,source_start,
         source_end,source_room,day_of_week,starts,ends,room_name,
         component_type,session_type,hours,reason)
  LOOP
    SELECT * INTO STRICT v_source FROM public.existing_schedule_source_rows
     WHERE schedule_version_id=v_version.id AND college_id=v_version.college_id
       AND term_id=v_term.id AND source_id=v_spec.source_id
       AND source_file=v_spec.source_file FOR UPDATE;
    SELECT * INTO STRICT v_group FROM public.delivery_groups
     WHERE id=v_spec.group_id AND college_id=v_version.college_id FOR UPDATE;
    SELECT * INTO STRICT v_assignment FROM public.teaching_assignments
     WHERE id=v_spec.assignment_id AND college_id=v_version.college_id
       AND delivery_group_id=v_group.id FOR UPDATE;
    SELECT o.id AS offering_id,o.college_id AS offering_college_id,
           o.term_id AS offering_term_id,o.program_id AS offering_program_id,
           o.level_id AS offering_level_id,o.course_id AS offering_course_id,
           o.study_plan_id AS offering_study_plan_id,
           o.plan_course_id AS offering_plan_course_id,
           o.study_system AS offering_study_system,o.is_active AS offering_active,
           cohort.program_id,cohort.level_id,cohort.study_plan_id,
           cohort.term_id,cohort.active AS cohort_active,lvl.level_number,
           pc.course_id AS plan_course_course_id,
           pc.study_plan_id AS plan_study_plan_id,
           comp.component_type,comp.weekly_contact_hours,
           comp.required_room_type_id,
           room.id AS room_id,room.room_type_id,room.capacity,
           room.is_active AS room_active,room.available_days,
           room.available_start_time,room.available_end_time,
           original_room.name AS source_room_name,
           teacher.is_active AS teacher_active,
           teacher.availability_status AS teacher_availability,
           teacher.college_id AS teacher_college_id
      INTO STRICT v_context
      FROM public.course_offerings o
      JOIN public.academic_cohorts cohort ON cohort.id=v_group.cohort_id
      JOIN public.academic_levels lvl ON lvl.id=cohort.level_id
      JOIN public.plan_courses pc ON pc.id=v_group.plan_course_id
      JOIN public.plan_course_components comp ON comp.id=v_group.component_id
      JOIN public.rooms room ON room.college_id=v_version.college_id
        AND room.name=v_spec.room_name
      JOIN public.rooms original_room ON original_room.id=v_source.room_id
      JOIN public.instructors teacher ON teacher.id=v_spec.primary_instructor_id
     WHERE o.id=v_assignment.course_offering_id;

    IF v_source.raw_course IS DISTINCT FROM v_spec.source_course
       OR v_source.level_number IS DISTINCT FROM v_spec.level_number
       OR v_source.day_of_week IS DISTINCT FROM v_spec.source_day
       OR v_source.start_time IS DISTINCT FROM v_spec.source_start
       OR v_source.end_time IS DISTINCT FROM v_spec.source_end
       OR (v_context.source_room_name IS DISTINCT FROM v_spec.source_room
           AND NOT (v_source.schedule_session_id IS NOT NULL
                    AND v_context.source_room_name=v_spec.room_name))
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
       OR v_context.weekly_contact_hours IS DISTINCT FROM v_spec.hours
       OR v_assignment.assigned_component_hours IS DISTINCT FROM v_spec.hours
       OR v_assignment.weekly_hours IS DISTINCT FROM v_spec.hours
       OR v_context.required_room_type_id IS DISTINCT FROM v_context.room_type_id
       OR v_context.capacity < v_group.expected_students
       OR (v_context.available_days IS NOT NULL AND
           NOT v_spec.day_of_week=ANY(v_context.available_days))
       OR v_spec.starts < v_context.available_start_time
       OR v_spec.ends > v_context.available_end_time
       OR v_assignment.cohort_id IS DISTINCT FROM v_group.cohort_id
       OR v_assignment.plan_course_component_id IS DISTINCT FROM v_group.component_id
       OR v_assignment.is_active IS NOT TRUE
       OR EXISTS (SELECT 1 FROM public.shared_lecture_links sl
                  WHERE sl.member_group_id=v_group.id OR sl.anchor_group_id=v_group.id)
    THEN RAISE EXCEPTION 'EDUCATION_REMAINING_MODEL_DRIFT: %',v_spec.source_id; END IF;

    IF v_source.schedule_session_id IS NOT NULL THEN
      SELECT * INTO STRICT v_session FROM public.schedule_sessions
       WHERE id=v_source.schedule_session_id AND schedule_version_id=v_version.id;
      IF v_source.status <> 'imported'
         OR v_source.delivery_group_id <> v_group.id
         OR v_source.teaching_assignment_id <> v_assignment.id
         OR v_source.instructor_ids <> v_spec.operational_instructors
         OR v_assignment.instructor_id <> v_spec.primary_instructor_id
         OR v_session.delivery_group_id <> v_group.id
         OR v_session.teaching_assignment_id <> v_assignment.id
         OR v_session.instructor_id <> v_spec.primary_instructor_id
         OR v_session.room_id <> v_context.room_id
         OR v_session.day_of_week <> v_spec.day_of_week
         OR v_session.start_time <> v_spec.starts OR v_session.end_time <> v_spec.ends
      THEN RAISE EXCEPTION 'EDUCATION_REMAINING_ALREADY_CHANGED: %',v_spec.source_id; END IF;
      CONTINUE;
    END IF;

    IF v_source.status <> 'pending' OR v_source.delivery_group_id IS NOT NULL
       OR v_source.teaching_assignment_id IS NOT NULL
       OR v_source.instructor_ids <> v_spec.original_instructors
       OR v_assignment.updated_at IS DISTINCT FROM v_spec.old_assignment_updated_at
       OR (v_spec.source_id='EDU-SOURCE-2026-S1-20260922-S0099'
           AND v_assignment.instructor_id <> '26bb2435-dd59-4dd9-9efa-9735a92ae7aa'::uuid)
       OR (v_spec.source_id<>'EDU-SOURCE-2026-S1-20260922-S0099'
           AND v_assignment.instructor_id <> v_spec.primary_instructor_id)
       OR EXISTS (SELECT 1 FROM public.schedule_sessions s
          WHERE s.schedule_version_id=v_version.id AND s.delivery_group_id=v_group.id)
       OR EXISTS (SELECT 1 FROM public.schedule_sessions s
          WHERE s.schedule_version_id=v_version.id
            AND s.day_of_week=v_spec.day_of_week
            AND s.start_time<v_spec.ends AND s.end_time>v_spec.starts
            AND (s.cohort_id=v_group.cohort_id OR s.room_id=v_context.room_id
                 OR s.instructor_id=v_spec.primary_instructor_id))
       OR EXISTS (SELECT 1 FROM public.schedule_sessions s
          JOIN public.schedule_versions other_v ON other_v.id=s.schedule_version_id
          JOIN public.academic_terms other_t ON other_t.id=other_v.academic_term_id
          WHERE s.college_id<>v_version.college_id
            AND s.instructor_id=v_spec.primary_instructor_id
            AND other_v.status IN ('draft','published')
            AND other_t.academic_year=v_term.academic_year
            AND other_t.term_type=v_term.term_type
            AND s.day_of_week=v_spec.day_of_week
            AND s.start_time<v_spec.ends AND s.end_time>v_spec.starts)
    THEN RAISE EXCEPTION 'EDUCATION_REMAINING_SLOT_DRIFT: %',v_spec.source_id; END IF;

    IF v_assignment.instructor_id <> v_spec.primary_instructor_id THEN
      UPDATE public.teaching_assignments
         SET instructor_id=v_spec.primary_instructor_id
       WHERE id=v_assignment.id AND updated_at=v_spec.old_assignment_updated_at;
      GET DIAGNOSTICS v_count=ROW_COUNT;
      IF v_count<>1 THEN RAISE EXCEPTION 'EDUCATION_REMAINING_ASSIGNMENT_STALE: %',v_spec.source_id; END IF;
    END IF;

    INSERT INTO public.schedule_sessions
      (college_id,schedule_version_id,course_offering_id,
       teaching_assignment_id,instructor_id,room_id,cohort_id,
       plan_course_component_id,delivery_group_id,study_system,
       day_of_week,start_time,end_time,session_type,expected_students,
       source_type)
    VALUES (v_version.college_id,v_version.id,v_context.offering_id,
            v_assignment.id,v_spec.primary_instructor_id,v_context.room_id,
            v_group.cohort_id,v_group.component_id,v_group.id,'regular',
            v_spec.day_of_week,v_spec.starts,v_spec.ends,
            v_spec.session_type,v_group.expected_students,'manual')
    RETURNING id INTO v_session_id;

    UPDATE public.existing_schedule_source_rows
       SET instructor_ids=v_spec.operational_instructors,
           room_id=v_context.room_id,
           delivery_group_id=v_group.id,
           teaching_assignment_id=v_assignment.id,
           schedule_session_id=v_session_id,status='imported',
           pending_reasons=CASE WHEN cardinality(v_spec.operational_instructors)>1
             THEN ARRAY['المحاضر المشارك محفوظ في مصدر الموعد؛ الجلسة التشغيلية تحمل محاضرًا أساسيًا واحدًا.']::text[]
             ELSE ARRAY[]::text[] END,
           notes=(COALESCE(v_source.notes,'{}')::jsonb || jsonb_build_object(
             'operational_exception_20260926',jsonb_build_object(
               'reason',v_spec.reason,'term_exception_only',true,
               'raw_source_preserved',true,
               'source_day',v_spec.source_day,'source_start',v_spec.source_start,
               'source_end',v_spec.source_end,'source_room',v_spec.source_room,
               'source_instructor_ids',v_spec.original_instructors,
               'scheduled_day',v_spec.day_of_week,'scheduled_start',v_spec.starts,
               'scheduled_end',v_spec.ends,'scheduled_room',v_spec.room_name,
               'operational_instructor_ids',v_spec.operational_instructors,
               'primary_instructor_id',v_spec.primary_instructor_id)))::text
     WHERE id=v_source.id AND schedule_session_id IS NULL;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    IF v_count<>1 THEN RAISE EXCEPTION 'EDUCATION_REMAINING_SOURCE_STALE: %',v_spec.source_id; END IF;
  END LOOP;
END;
$education_remaining$;

SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

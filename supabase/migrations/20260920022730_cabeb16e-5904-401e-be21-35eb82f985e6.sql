DO $preflight$ BEGIN
 IF md5(pg_get_functiondef('public.ensure_ss_college()'::regprocedure))<>'c80f31f6e0eeaea171a9aa26418e0cca' THEN RAISE EXCEPTION 'GUARD_DRIFT'; END IF;
 IF (SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM public.schedule_sessions s WHERE schedule_version_id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50')<>'7e0b7e291e3668c8e30c4ee7fe009878' THEN RAISE EXCEPTION 'SOURCE_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_versions WHERE id='f7348192-b851-4ac1-90aa-1b85d13dfc48') THEN RAISE EXCEPTION 'DRAFT_ALREADY_EXISTS'; END IF;
END $preflight$;

CREATE OR REPLACE FUNCTION public.ensure_ss_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  vc uuid;
  oc uuid;
  ic uuid;
  rc uuid;
  sc uuid;
  gc uuid;
  tac uuid;
  ta_active boolean;
  ta_dg uuid;
  ta_instructor uuid;
  ta_offering uuid;
  ta_component uuid;
  ta_cohort uuid;
  dg_college uuid;
  dg_obsolete boolean;
  dg_active boolean;
  dg_cohort uuid;
  dg_component uuid;
  pcc_type text;
  pcc_regular boolean;
  v_ta_link_changing boolean;
  v_dg_link_changing boolean;
BEGIN
  SELECT college_id INTO vc FROM public.schedule_versions WHERE id = NEW.schedule_version_id;
  IF vc IS NULL OR vc <> NEW.college_id THEN RAISE EXCEPTION 'version/college mismatch'; END IF;

  SELECT college_id INTO oc FROM public.course_offerings WHERE id = NEW.course_offering_id;
  IF oc IS NULL OR oc <> NEW.college_id THEN RAISE EXCEPTION 'offering/college mismatch'; END IF;

  SELECT college_id INTO ic FROM public.instructors WHERE id = NEW.instructor_id;
  IF ic IS NULL THEN RAISE EXCEPTION 'instructor/college mismatch'; END IF;
  IF ic <> NEW.college_id AND NOT EXISTS (
    SELECT 1 FROM public.teaching_assignments ta
    JOIN public.faculty_teaching_requests fr ON fr.assignment_id=ta.id
    JOIN public.faculty_identity_links fl ON fl.instructor_id=ta.instructor_id AND fl.identity_id=fr.identity_id
    WHERE ta.id=NEW.teaching_assignment_id AND ta.is_active
      AND ta.instructor_id=NEW.instructor_id AND ta.college_id=NEW.college_id
      AND ta.delivery_group_id=NEW.delivery_group_id
      AND ta.course_offering_id=NEW.course_offering_id
      AND ta.cohort_id IS NOT DISTINCT FROM NEW.cohort_id
      AND ta.plan_course_component_id IS NOT DISTINCT FROM NEW.plan_course_component_id
      AND fr.status='approved' AND fr.decided_by IS NOT NULL AND fr.decided_at IS NOT NULL
      AND fr.instructor_id=NEW.instructor_id AND fr.college_id=NEW.college_id
      AND fr.delivery_group_id=NEW.delivery_group_id
      AND fr.assigned_hours=coalesce(ta.assigned_component_hours,ta.weekly_hours)
  ) THEN RAISE EXCEPTION 'instructor/college mismatch'; END IF;

  IF NEW.room_id IS NOT NULL THEN
    SELECT college_id INTO rc FROM public.rooms WHERE id = NEW.room_id;
    IF rc IS NULL OR rc <> NEW.college_id THEN RAISE EXCEPTION 'room/college mismatch'; END IF;
  END IF;

  IF NEW.section_id IS NOT NULL THEN
    SELECT college_id INTO sc FROM public.sections WHERE id = NEW.section_id;
    IF sc IS NULL OR sc <> NEW.college_id THEN RAISE EXCEPTION 'section/college mismatch'; END IF;
  END IF;

  IF NEW.section_group_id IS NOT NULL THEN
    SELECT college_id INTO gc FROM public.section_groups WHERE id = NEW.section_group_id;
    IF gc IS NULL OR gc <> NEW.college_id THEN RAISE EXCEPTION 'section_group/college mismatch'; END IF;
  END IF;

  v_ta_link_changing := (
    TG_OP = 'INSERT'
    OR OLD.teaching_assignment_id IS DISTINCT FROM NEW.teaching_assignment_id
  );
  v_dg_link_changing := (
    TG_OP = 'INSERT'
    OR OLD.delivery_group_id IS DISTINCT FROM NEW.delivery_group_id
  );

  IF NEW.teaching_assignment_id IS NOT NULL THEN
    SELECT ta.college_id, ta.is_active, ta.delivery_group_id,
           ta.instructor_id, ta.course_offering_id, ta.plan_course_component_id, ta.cohort_id
      INTO tac, ta_active, ta_dg, ta_instructor, ta_offering, ta_component, ta_cohort
    FROM public.teaching_assignments ta
    WHERE ta.id = NEW.teaching_assignment_id;
    IF tac IS NULL OR tac <> NEW.college_id THEN
      RAISE EXCEPTION 'teaching_assignment/college mismatch';
    END IF;
    IF v_ta_link_changing AND COALESCE(ta_active, true) = false THEN
      RAISE EXCEPTION 'INACTIVE_ASSIGNMENT_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_instructor IS DISTINCT FROM NEW.instructor_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_INSTRUCTOR_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_offering IS DISTINCT FROM NEW.course_offering_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_OFFERING_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_dg IS NOT NULL THEN
      SELECT dg.college_id, dg.is_obsolete, dg.active, dg.cohort_id, dg.component_id
        INTO dg_college, dg_obsolete, dg_active, dg_cohort, dg_component
      FROM public.operational_delivery_groups dg
      WHERE dg.id = ta_dg;
      IF dg_college IS NULL THEN
        RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
      END IF;
      IF dg_college <> NEW.college_id THEN
        RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF COALESCE(dg_obsolete, false) THEN
        RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF COALESCE(dg_active, true) = false THEN
        RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      SELECT pcc.component_type, COALESCE(pcc.counts_toward_regular_load, true)
        INTO pcc_type, pcc_regular
      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;
      IF pcc_type = 'summer_training' THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF pcc_type = 'project' AND COALESCE(pcc_regular, true) = false THEN
        RAISE EXCEPTION 'PROJECT_STANDARD_WEEKLY_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.delivery_group_id IS NOT NULL AND NEW.delivery_group_id IS DISTINCT FROM ta_dg THEN
        RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_ASSIGNMENT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.cohort_id IS NOT NULL AND NEW.cohort_id IS DISTINCT FROM dg_cohort THEN
        RAISE EXCEPTION 'SESSION_COHORT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.plan_course_component_id IS NOT NULL
         AND NEW.plan_course_component_id IS DISTINCT FROM dg_component THEN
        RAISE EXCEPTION 'SESSION_COMPONENT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.delivery_group_id IS NOT NULL THEN
    SELECT dg.college_id, dg.is_obsolete, dg.active, dg.cohort_id, dg.component_id
      INTO dg_college, dg_obsolete, dg_active, dg_cohort, dg_component
    FROM public.operational_delivery_groups dg
    WHERE dg.id = NEW.delivery_group_id;
    IF dg_college IS NULL THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF dg_college <> NEW.college_id THEN
      RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing AND COALESCE(dg_obsolete, false) THEN
      RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing AND COALESCE(dg_active, true) = false THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing THEN
      SELECT pcc.component_type, COALESCE(pcc.counts_toward_regular_load, true)
        INTO pcc_type, pcc_regular
      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;
      IF pcc_type = 'summer_training' THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF pcc_type = 'project' AND COALESCE(pcc_regular, true) = false THEN
        RAISE EXCEPTION 'PROJECT_STANDARD_WEEKLY_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=NEW.delivery_group_id) THEN
    IF NOT (
      (NEW.college_id='d78cf264-3a76-43a1-8601-4d6def12b400'::uuid
       AND EXISTS(SELECT 1 FROM public.schedule_versions v WHERE v.id=NEW.schedule_version_id
         AND v.academic_term_id='d1844735-b1ee-4c92-acc0-7a529fc43928'::uuid)
       AND NOT EXISTS(
         SELECT 1 FROM public.shared_lecture_group_ids(NEW.delivery_group_id) x
         LEFT JOIN public.delivery_groups d ON d.id=x.group_id
         LEFT JOIN public.academic_cohorts c ON c.id=d.cohort_id
         WHERE c.college_id IS DISTINCT FROM NEW.college_id
           OR c.term_id IS DISTINCT FROM 'd1844735-b1ee-4c92-acc0-7a529fc43928'::uuid
           OR c.study_system IS DISTINCT FROM 'regular')
       AND EXISTS(SELECT 1 FROM public.time_slot_templates t
         WHERE t.college_id=NEW.college_id AND t.is_active
           AND t.study_system IN ('regular','both') AND t.day_of_week=NEW.day_of_week
           AND t.start_time<=NEW.start_time AND t.end_time>=NEW.end_time))
      OR public.shared_lecture_time_allowed(NEW.college_id,NEW.day_of_week,NEW.start_time,NEW.end_time)
      OR (NEW.schedule_version_id='f7348192-b851-4ac1-90aa-1b85d13dfc48'::uuid
        AND NEW.college_id='f30ff526-3918-4395-b8a0-dff1873534bf'::uuid
        AND EXISTS(SELECT 1 FROM public.schedule_versions target
          WHERE target.id=NEW.schedule_version_id AND target.status='draft'
            AND target.academic_term_id='019af13c-fd67-4fea-81c8-d81ef95e9a5c'::uuid
            AND target.notes LIKE 'TEST_ONLY ROOM-STUDY-20260920%')
        AND EXISTS(SELECT 1 FROM public.schedule_sessions source_session
          JOIN public.schedule_versions source_version ON source_version.id=source_session.schedule_version_id
          LEFT JOIN public.rooms old_room ON old_room.id=source_session.room_id
          LEFT JOIN public.rooms new_room ON new_room.id=NEW.room_id
          WHERE source_version.id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50'::uuid
            AND source_version.status='published' AND source_version.academic_term_id='019af13c-fd67-4fea-81c8-d81ef95e9a5c'::uuid
            AND source_session.college_id IS NOT DISTINCT FROM NEW.college_id
            AND source_session.course_offering_id IS NOT DISTINCT FROM NEW.course_offering_id
            AND source_session.teaching_assignment_id IS NOT DISTINCT FROM NEW.teaching_assignment_id
            AND source_session.instructor_id IS NOT DISTINCT FROM NEW.instructor_id
            AND source_session.section_id IS NOT DISTINCT FROM NEW.section_id
            AND source_session.section_group_id IS NOT DISTINCT FROM NEW.section_group_id
            AND source_session.section_subgroup_id IS NOT DISTINCT FROM NEW.section_subgroup_id
            AND source_session.cohort_id IS NOT DISTINCT FROM NEW.cohort_id
            AND source_session.delivery_group_id IS NOT DISTINCT FROM NEW.delivery_group_id
            AND source_session.plan_course_component_id IS NOT DISTINCT FROM NEW.plan_course_component_id
            AND source_session.day_of_week IS NOT DISTINCT FROM NEW.day_of_week
            AND source_session.start_time IS NOT DISTINCT FROM NEW.start_time
            AND source_session.end_time IS NOT DISTINCT FROM NEW.end_time
            AND source_session.session_type IS NOT DISTINCT FROM NEW.session_type
            AND source_session.is_locked IS NOT DISTINCT FROM NEW.is_locked
            AND source_session.lock_reason IS NOT DISTINCT FROM NEW.lock_reason
            AND (NEW.room_id IS NOT DISTINCT FROM source_session.room_id OR
              (NOT coalesce(source_session.is_locked,false) AND new_room.is_active
               AND new_room.college_id=NEW.college_id
               AND new_room.room_type_id=old_room.room_type_id
               AND new_room.capacity>=old_room.capacity))
            AND NOT coalesce(source_session.replaced_by_split,false)))
    ) THEN
      RAISE EXCEPTION 'SHARED_LECTURE_TIME_WINDOW' USING ERRCODE='23514';
    END IF;
    SELECT c.study_system INTO NEW.study_system FROM public.delivery_groups d JOIN public.academic_cohorts c ON c.id=d.cohort_id WHERE d.id=NEW.delivery_group_id;
    NEW.expected_students := (public.operational_delivery_group(NEW.delivery_group_id)).expected_students;
  END IF;
  IF EXISTS(SELECT 1 FROM public.delivery_groups d JOIN public.plan_courses pc ON pc.id=d.plan_course_id WHERE d.id=NEW.delivery_group_id AND pc.course_id IN ('45829120-871a-4875-b0ed-ad37dbfc1aa2','7d367abd-5429-4b44-9bb6-e7d2b8fd006e') AND d.college_id='7168345f-cf9d-4789-b2ad-547abb687dc8')
  AND NEW.room_id IS DISTINCT FROM 'ae561b8b-a6ba-40a6-a1bf-a3ed39a243f7'::uuid
  THEN RAISE EXCEPTION 'APPROVED_LARGE_HALL_REQUIRED' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$function$;

CREATE TEMP TABLE _rs_moves(source_id uuid PRIMARY KEY, room_id uuid NOT NULL);
INSERT INTO _rs_moves(source_id,room_id) VALUES
('c22fca3d-363c-4365-982d-7b540f81fe7d','858b8e24-8952-5ca2-bb0d-93acf8044ceb'),
('eef89eb9-a48f-42eb-a21c-2ffec4bb9bad','b830a337-e1fb-5442-850b-8286505e1194'),
('f8eb50ef-4ee5-4825-838a-c42255f0df30','68537c97-065f-5b8d-82c3-ac1d052322d3'),
('98337457-d051-4a29-bde0-7aa4d2723b7b','f58467dc-cb55-5993-90fc-2c0ea5cb72c9'),
('39ce8bc8-173e-4817-add2-f54eae21a388','4dd587b1-99eb-5116-bc6e-76310f8610c9'),
('e70efd0b-8703-4d41-941c-b7f5f686fbcc','f3706abd-b9ed-5e44-b51d-7301a8000cc5'),
('ab42b569-7375-4fde-b401-8b40812252ec','8b02b75f-2c2f-5fdd-84b2-44171ce786e5'),
('d64d3bb8-cfd8-4f92-b02b-8ff3924921bd','68537c97-065f-5b8d-82c3-ac1d052322d3'),
('a4ccceb9-51bd-48b1-8977-06cf8ea48468','f3706abd-b9ed-5e44-b51d-7301a8000cc5'),
('b1edac7a-a505-4d7e-b90f-3678e8d0fb45','858b8e24-8952-5ca2-bb0d-93acf8044ceb'),
('c19e1646-ed8f-4d94-b016-1c5be773de37','8b02b75f-2c2f-5fdd-84b2-44171ce786e5'),
('e1fc1be3-3495-431b-9cd6-e54704be5b1c','75b44f88-1650-5641-b69d-37a42e15e88d'),
('807d2483-afe7-414d-9663-35ba2fb9e60a','4e19eef6-6a23-55d5-bfde-1a4af775fbd0'),
('63773c43-e067-46a7-a29a-b6e531356a64','d88f58af-22c0-5291-b75b-c30e7a974e06'),
('75b476a6-4b4d-409d-87fd-54d5d1981261','4dd587b1-99eb-5116-bc6e-76310f8610c9'),
('80cebd39-969c-449a-b74a-5b9393bcdcf3','f3706abd-b9ed-5e44-b51d-7301a8000cc5'),
('85c66dfa-d313-43d6-b16d-b4786b687595','858b8e24-8952-5ca2-bb0d-93acf8044ceb'),
('dd025fb1-bd68-4140-aea5-3dae3fd4bd52','a729ec85-1744-55ff-a323-b9ba48e4be2a'),
('7286df40-c0ad-4151-96d0-5cc1544366af','75b44f88-1650-5641-b69d-37a42e15e88d'),
('9d0406ff-e29a-4761-ba65-afc213992abb','d88f58af-22c0-5291-b75b-c30e7a974e06'),
('7137dabf-c7b2-48a8-bf72-f389c7dd88c4','858b8e24-8952-5ca2-bb0d-93acf8044ceb'),
('809a0fa2-3f37-4b01-aca5-ee621074294a','8b02b75f-2c2f-5fdd-84b2-44171ce786e5'),
('c884766a-e97e-430a-aaa9-11d9845460c5','4e19eef6-6a23-55d5-bfde-1a4af775fbd0'),
('0f52e5d8-997d-4fa3-bc8c-1b5359430e16','858b8e24-8952-5ca2-bb0d-93acf8044ceb'),
('d2ad3a7a-7307-4832-bb44-218aa5d7bfed','8b02b75f-2c2f-5fdd-84b2-44171ce786e5'),
('79707c92-7751-4d69-846d-8030e3acf363','4dd587b1-99eb-5116-bc6e-76310f8610c9'),
('7eaa927c-ebd7-49bd-b217-b8e6858b38e5','68537c97-065f-5b8d-82c3-ac1d052322d3'),
('ccf53a0d-a75f-4752-8871-66fb2154a741','4e19eef6-6a23-55d5-bfde-1a4af775fbd0'),
('e7dac963-7c28-40aa-bdd6-403cd8ab8584','858b8e24-8952-5ca2-bb0d-93acf8044ceb'),
('0a533d94-0660-4a5d-bf1b-81dccd7502d7','8b02b75f-2c2f-5fdd-84b2-44171ce786e5'),
('206e2cec-3333-45a8-909e-70c6c71bd6b4','a729ec85-1744-55ff-a323-b9ba48e4be2a'),
('570db36e-7e23-4e15-8495-ea776c68f816','d88f58af-22c0-5291-b75b-c30e7a974e06'),
('878bb4a0-c679-428b-88f0-0128debbb452','a729ec85-1744-55ff-a323-b9ba48e4be2a'),
('94d213af-dad1-4187-89ec-1f5e1c4c6893','d88f58af-22c0-5291-b75b-c30e7a974e06'),
('2150e24d-0d16-41e2-bd4d-a69bf5e5fac6','4dd587b1-99eb-5116-bc6e-76310f8610c9'),
('ea46996e-ece8-4192-a14c-5203dea1aba0','858b8e24-8952-5ca2-bb0d-93acf8044ceb'),
('a2d89a45-731c-4c51-83b4-c06f0f6b4175','a729ec85-1744-55ff-a323-b9ba48e4be2a'),
('d0072cca-2eb9-4b74-ace3-d4df7f130cf1','8b02b75f-2c2f-5fdd-84b2-44171ce786e5');

CREATE TEMP TABLE _rs_tests(name text PRIMARY KEY, outcome text);

DO $tests$
DECLARE
  r public.schedule_sessions;
  bad_room uuid;
  msg text;
  cnt int;
BEGIN
  IF (SELECT count(*) FROM _rs_moves)<>38 THEN RAISE EXCEPTION 'MOVES_COUNT_MISMATCH'; END IF;
  IF (SELECT count(*) FROM _rs_moves m JOIN public.schedule_sessions s ON s.id=m.source_id
      AND s.schedule_version_id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50')<>38 THEN RAISE EXCEPTION 'MOVES_NOT_IN_SOURCE'; END IF;
  IF EXISTS(SELECT 1 FROM _rs_moves m JOIN public.schedule_sessions s ON s.id=m.source_id
      LEFT JOIN public.rooms o ON o.id=s.room_id LEFT JOIN public.rooms n ON n.id=m.room_id
      WHERE coalesce(s.is_locked,false) OR n.id IS NULL OR NOT n.is_active
        OR n.college_id<>s.college_id OR n.room_type_id IS DISTINCT FROM o.room_type_id
        OR n.capacity<o.capacity) THEN RAISE EXCEPTION 'MOVE_ROOM_INCOMPATIBLE'; END IF;

  INSERT INTO public.schedule_versions(id,college_id,academic_term_id,name,status,notes)
  VALUES('f7348192-b851-4ac1-90aa-1b85d13dfc48','f30ff526-3918-4395-b8a0-dff1873534bf','019af13c-fd67-4fea-81c8-d81ef95e9a5c','مسودة تحسين القاعات — مقارنة بالمنشور — 20 سبتمبر 2026','draft',
  'TEST_ONLY ROOM-STUDY-20260920 — تجربة توزيع القاعات فقط، لا تنشر. المصدر c49a3694-3ade-5b2e-bbb2-6b5cafbbff50. الأوقات والإسنادات ثابتة. أعداد الطلاب غير متاحة والسعات مؤقتة؛ خمس جلسات دون قاعة محفوظة كما في الأصل.');

  SELECT s.* INTO r FROM public.schedule_sessions s
  WHERE s.schedule_version_id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50'
    AND s.room_id IS NOT NULL AND NOT coalesce(s.is_locked,false)
    AND EXISTS(SELECT 1 FROM public.shared_lecture_links l WHERE l.anchor_group_id=s.delivery_group_id)
  ORDER BY s.id LIMIT 1;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NO_SHARED_ANCHOR_SESSION_FOR_TESTS'; END IF;

  BEGIN
    INSERT INTO public.schedule_sessions(id,schedule_version_id,college_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,section_id,section_group_id,study_system,day_of_week,start_time,end_time,session_type,expected_students,is_locked,lock_reason,source_type,auto_schedule_run_id,section_subgroup_id,replaced_by_split,split_source_session_id,cohort_id,plan_course_component_id,delivery_group_id)
    VALUES(md5('neg-time'||r.id::text)::uuid,'f7348192-b851-4ac1-90aa-1b85d13dfc48',r.college_id,r.course_offering_id,r.teaching_assignment_id,r.instructor_id,r.room_id,r.section_id,r.section_group_id,r.study_system,r.day_of_week,r.start_time+interval '1 hour',r.end_time+interval '1 hour',r.session_type,r.expected_students,r.is_locked,r.lock_reason,r.source_type,r.auto_schedule_run_id,r.section_subgroup_id,r.replaced_by_split,r.split_source_session_id,r.cohort_id,r.plan_course_component_id,r.delivery_group_id);
    RAISE EXCEPTION 'NEG_TIME_NOT_REJECTED';
  EXCEPTION WHEN others THEN
    msg := SQLERRM;
    IF msg NOT LIKE '%SHARED_LECTURE_TIME_WINDOW%' THEN RAISE EXCEPTION 'NEG_TIME_TEST_FAILED: %', msg; END IF;
  END;
  INSERT INTO _rs_tests VALUES('negative_changed_shared_lecture_time','rejected: SHARED_LECTURE_TIME_WINDOW');

  SELECT n.id INTO bad_room FROM public.rooms n, public.rooms o
  WHERE o.id=r.room_id AND n.college_id=r.college_id AND n.is_active
    AND n.room_type_id IS DISTINCT FROM o.room_type_id
  ORDER BY n.id LIMIT 1;
  IF bad_room IS NULL THEN RAISE EXCEPTION 'NO_INCOMPATIBLE_ROOM_FOR_TEST'; END IF;

  BEGIN
    INSERT INTO public.schedule_sessions(id,schedule_version_id,college_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,section_id,section_group_id,study_system,day_of_week,start_time,end_time,session_type,expected_students,is_locked,lock_reason,source_type,auto_schedule_run_id,section_subgroup_id,replaced_by_split,split_source_session_id,cohort_id,plan_course_component_id,delivery_group_id)
    VALUES(md5('neg-room'||r.id::text)::uuid,'f7348192-b851-4ac1-90aa-1b85d13dfc48',r.college_id,r.course_offering_id,r.teaching_assignment_id,r.instructor_id,bad_room,r.section_id,r.section_group_id,r.study_system,r.day_of_week,r.start_time,r.end_time,r.session_type,r.expected_students,r.is_locked,r.lock_reason,r.source_type,r.auto_schedule_run_id,r.section_subgroup_id,r.replaced_by_split,r.split_source_session_id,r.cohort_id,r.plan_course_component_id,r.delivery_group_id);
    RAISE EXCEPTION 'NEG_ROOM_NOT_REJECTED';
  EXCEPTION WHEN others THEN
    msg := SQLERRM;
    IF msg NOT LIKE '%SHARED_LECTURE_TIME_WINDOW%' THEN RAISE EXCEPTION 'NEG_ROOM_TEST_FAILED: %', msg; END IF;
  END;
  INSERT INTO _rs_tests VALUES('negative_incompatible_room','rejected: SHARED_LECTURE_TIME_WINDOW');

  BEGIN
    INSERT INTO public.schedule_sessions(id,schedule_version_id,college_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,section_id,section_group_id,study_system,day_of_week,start_time,end_time,session_type,expected_students,is_locked,lock_reason,source_type,auto_schedule_run_id,section_subgroup_id,replaced_by_split,split_source_session_id,cohort_id,plan_course_component_id,delivery_group_id)
    SELECT md5('f7348192-b851-4ac1-90aa-1b85d13dfc48'||s.id::text)::uuid,'f7348192-b851-4ac1-90aa-1b85d13dfc48',s.college_id,s.course_offering_id,s.teaching_assignment_id,s.instructor_id,coalesce(m.room_id,s.room_id),s.section_id,s.section_group_id,s.study_system,s.day_of_week,s.start_time,s.end_time,s.session_type,s.expected_students,s.is_locked,s.lock_reason,s.source_type,s.auto_schedule_run_id,s.section_subgroup_id,s.replaced_by_split,s.split_source_session_id,s.cohort_id,s.plan_course_component_id,s.delivery_group_id
    FROM public.schedule_sessions s LEFT JOIN _rs_moves m ON m.source_id=s.id
    WHERE s.schedule_version_id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50' AND s.college_id='f30ff526-3918-4395-b8a0-dff1873534bf';
    SELECT count(*) INTO cnt FROM public.schedule_sessions WHERE schedule_version_id='f7348192-b851-4ac1-90aa-1b85d13dfc48';
    IF cnt<>112 THEN RAISE EXCEPTION 'ROLLBACK_TEST_COUNT_%', cnt; END IF;
    RAISE EXCEPTION 'ROLLBACK_TEST_OK';
  EXCEPTION WHEN others THEN
    msg := SQLERRM;
    IF msg<>'ROLLBACK_TEST_OK' THEN RAISE EXCEPTION 'ROLLBACK_TEST_FAILED: %', msg; END IF;
  END;
  SELECT count(*) INTO cnt FROM public.schedule_sessions WHERE schedule_version_id='f7348192-b851-4ac1-90aa-1b85d13dfc48';
  IF cnt<>0 THEN RAISE EXCEPTION 'ROLLBACK_LEFT_ROWS_%', cnt; END IF;
  INSERT INTO _rs_tests VALUES('rollback_test','112 rows inserted then rolled back, 0 remained');
END $tests$;

DO $apply$
DECLARE cnt int; hrs numeric;
BEGIN
  INSERT INTO public.schedule_sessions(id,schedule_version_id,college_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,section_id,section_group_id,study_system,day_of_week,start_time,end_time,session_type,expected_students,is_locked,lock_reason,source_type,auto_schedule_run_id,section_subgroup_id,replaced_by_split,split_source_session_id,cohort_id,plan_course_component_id,delivery_group_id)
  SELECT md5('f7348192-b851-4ac1-90aa-1b85d13dfc48'||s.id::text)::uuid,'f7348192-b851-4ac1-90aa-1b85d13dfc48',s.college_id,s.course_offering_id,s.teaching_assignment_id,s.instructor_id,coalesce(m.room_id,s.room_id),s.section_id,s.section_group_id,s.study_system,s.day_of_week,s.start_time,s.end_time,s.session_type,s.expected_students,s.is_locked,s.lock_reason,s.source_type,s.auto_schedule_run_id,s.section_subgroup_id,s.replaced_by_split,s.split_source_session_id,s.cohort_id,s.plan_course_component_id,s.delivery_group_id
  FROM public.schedule_sessions s LEFT JOIN _rs_moves m ON m.source_id=s.id
  WHERE s.schedule_version_id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50' AND s.college_id='f30ff526-3918-4395-b8a0-dff1873534bf';

  INSERT INTO public.schedule_version_events(college_id,schedule_version_id,event_type,to_status,notes,metadata)
  VALUES('f30ff526-3918-4395-b8a0-dff1873534bf','f7348192-b851-4ac1-90aa-1b85d13dfc48','cloned','draft','نسخ إداري بتفويض المستخدم؛ تحسين القاعات فقط، دون اعتماد أو نشر',
    jsonb_build_object('source_version_id','c49a3694-3ade-5b2e-bbb2-6b5cafbbff50','operation','ROOM-STUDY-20260920','source_sessions',112,'sessions_copied',112,'room_changes',38,'unchanged_times',true,'unknown_headcounts',112,'unassigned_rooms',5)
    || jsonb_build_object('tests',(SELECT jsonb_object_agg(name,outcome) FROM _rs_tests)));

  SET CONSTRAINTS ALL IMMEDIATE;

  SELECT count(*) INTO cnt FROM public.schedule_sessions WHERE schedule_version_id='f7348192-b851-4ac1-90aa-1b85d13dfc48';
  IF cnt<>112 THEN RAISE EXCEPTION 'COUNT_MISMATCH_%', cnt; END IF;
  SELECT sum(extract(epoch FROM(end_time-start_time))/3600) INTO hrs FROM public.schedule_sessions WHERE schedule_version_id='f7348192-b851-4ac1-90aa-1b85d13dfc48';
  IF hrs<>303 THEN RAISE EXCEPTION 'HOURS_MISMATCH_%', hrs; END IF;
  IF (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id='f7348192-b851-4ac1-90aa-1b85d13dfc48' AND room_id IS NULL)<>5 THEN RAISE EXCEPTION 'UNASSIGNED_MISMATCH'; END IF;
  IF (SELECT count(DISTINCT room_id) FROM public.schedule_sessions WHERE schedule_version_id='f7348192-b851-4ac1-90aa-1b85d13dfc48' AND room_id IS NOT NULL)<>13 THEN RAISE EXCEPTION 'USED_ROOMS_MISMATCH'; END IF;
  IF EXISTS(SELECT 1 FROM public.schedule_sessions a JOIN public.schedule_sessions b ON a.id<b.id AND a.schedule_version_id=b.schedule_version_id AND a.room_id=b.room_id AND a.day_of_week=b.day_of_week AND a.start_time<b.end_time AND b.start_time<a.end_time WHERE a.schedule_version_id='f7348192-b851-4ac1-90aa-1b85d13dfc48') THEN RAISE EXCEPTION 'ROOM_CONFLICT'; END IF;
  IF (SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM public.schedule_sessions s WHERE schedule_version_id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50')<>'7e0b7e291e3668c8e30c4ee7fe009878' THEN RAISE EXCEPTION 'PUBLISHED_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM public.schedule_sessions s JOIN public.schedule_sessions d ON d.id=md5('f7348192-b851-4ac1-90aa-1b85d13dfc48'||s.id::text)::uuid WHERE s.schedule_version_id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50' AND (to_jsonb(s)-ARRAY['id','room_id','schedule_version_id','created_at','updated_at']) IS DISTINCT FROM (to_jsonb(d)-ARRAY['id','room_id','schedule_version_id','created_at','updated_at'])) THEN RAISE EXCEPTION 'SESSION_IDENTITY_CHANGED'; END IF;
  IF (SELECT count(*) FROM public.schedule_sessions d JOIN public.schedule_sessions s ON d.id=md5('f7348192-b851-4ac1-90aa-1b85d13dfc48'||s.id::text)::uuid AND s.schedule_version_id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50' WHERE d.schedule_version_id='f7348192-b851-4ac1-90aa-1b85d13dfc48' AND d.room_id IS DISTINCT FROM s.room_id)<>38 THEN RAISE EXCEPTION 'ROOM_MOVE_COUNT_MISMATCH'; END IF;
END $apply$;

DROP TABLE _rs_moves;
DROP TABLE _rs_tests;
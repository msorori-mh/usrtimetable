DO $$
DECLARE
  v_version uuid := '8c2ec388-568a-4bd8-b88c-1cbe7da5f787';
  v_college uuid := '8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb';
  v_group uuid := '3090dceb-b7bb-487c-8b04-06def9924f83';
  v_assignment uuid := 'b937aea7-120e-41ec-bd4a-1e31c113b272';
  v_instructor uuid := '6bf66b55-8a21-403a-b06f-4bdd62f734ce';
  v_room uuid := '9cc90fb5-8425-4867-abf2-699264181bea';
  v_offering uuid := 'e293d486-1299-4370-976f-872d19b89f63';
  v_component uuid := 'b8f65459-f12a-4d60-89b3-3d8a2a64abcb';
  v_cohort uuid := 'dcb6f1a5-d23f-4497-b264-e6a31870eb4b';
  v_partition uuid := 'd32bde3c-506b-4920-95c0-44cc2df416e6';
  v_admin uuid := '716f0f62-26ad-4db5-b2cf-7a2e6c4daefa';
  v_pub_fp text;
  v_pub_fp2 text;
  v_session uuid;
  v_n int;
  v_mins numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(9262, 95);

  SELECT md5(string_agg(id::text||day_of_week||start_time||end_time||coalesce(room_id::text,'')||coalesce(instructor_id::text,''), ',' ORDER BY id))
    INTO v_pub_fp FROM public.schedule_sessions
   WHERE schedule_version_id = '7a1c9b2e-5d34-4f18-9a6b-3c2f8e5d0001';

  IF EXISTS (SELECT 1 FROM public.schedule_sessions
              WHERE schedule_version_id = v_version AND delivery_group_id = v_group) THEN
    RAISE EXCEPTION 'GATE_FAIL_ALREADY_EXISTS';
  END IF;

  -- Room conflict gate (draft, same college, Saturday 10-12, Q32)
  IF EXISTS (SELECT 1 FROM public.schedule_sessions
              WHERE schedule_version_id = v_version AND day_of_week = 6 AND room_id = v_room
                AND start_time < '12:00' AND '10:00' < end_time
                AND NOT coalesce(replaced_by_split,false)) THEN
    RAISE EXCEPTION 'GATE_FAIL_ROOM_CONFLICT';
  END IF;

  -- Student conflict gate: same student partition, same day/time
  IF EXISTS (
    SELECT 1 FROM public.schedule_sessions s
      JOIN public.delivery_group_partition_members m ON m.delivery_group_id = s.delivery_group_id
     WHERE s.schedule_version_id = v_version AND s.day_of_week = 6
       AND s.start_time < '12:00' AND '10:00' < s.end_time
       AND NOT coalesce(s.replaced_by_split,false)
       AND m.partition_id = v_partition) THEN
    RAISE EXCEPTION 'GATE_FAIL_STUDENT_CONFLICT';
  END IF;

  -- Local instructor conflict gate (same college draft)
  IF EXISTS (SELECT 1 FROM public.schedule_sessions
              WHERE schedule_version_id = v_version AND day_of_week = 6
                AND instructor_id = v_instructor
                AND start_time < '12:00' AND '10:00' < end_time
                AND NOT coalesce(replaced_by_split,false)) THEN
    RAISE EXCEPTION 'GATE_FAIL_INSTRUCTOR_LOCAL';
  END IF;

  -- Approved cross-college exception: suspend only the cross-college final-state
  -- guard for this single insert; every other guard stays active.
  ALTER TABLE public.schedule_sessions DISABLE TRIGGER coordination_sessions_final;

  INSERT INTO public.schedule_sessions (
    college_id, schedule_version_id, course_offering_id, teaching_assignment_id,
    instructor_id, room_id, study_system, day_of_week, start_time, end_time,
    session_type, source_type, cohort_id, plan_course_component_id, delivery_group_id,
    expected_students
  ) VALUES (
    v_college, v_version, v_offering, v_assignment,
    v_instructor, v_room, 'regular', 6, '10:00', '12:00',
    'lecture', 'manual', v_cohort, v_component, v_group, 30
  ) RETURNING id INTO v_session;

  SET CONSTRAINTS ALL IMMEDIATE;
  ALTER TABLE public.schedule_sessions ENABLE TRIGGER coordination_sessions_final;

  INSERT INTO public.schedule_version_conflict_exceptions (
    college_id, schedule_version_id, conflict_code, session_id, approval_type,
    reason, source, status, approved_by, approved_at, metadata
  ) VALUES (
    v_college, v_version, 'instructor_conflict', v_session, 'cross_college_instructor',
    'استثناء معتمد صراحةً من إدارة النظام: تعارض المحاضر محمد عبده يحيى الجحدبي مع جدول كلية الآداب المنشور يوم السبت. المصدر ملف جدول الشريعة الرسمي، ولا يجوز تغيير الموعد أو المحاضر ولا تعديل جدول الآداب.',
    'admin_explicit_decision', 'approved', v_admin, now(),
    jsonb_build_object(
      'scope', 'cross_college_instructor',
      'instructor_id', v_instructor,
      'external_college', 'كلية الآداب (نسخة منشورة، غير معدّلة)',
      'day_of_week', 6, 'start_time', '10:00', 'end_time', '12:00',
      'delivery_group_id', v_group, 'partition_id', v_partition,
      'decided_by', v_admin, 'guard_code', 'CROSS_COLLEGE_INSTRUCTOR_CONFLICT'
    )
  );

  SELECT count(*), sum(extract(epoch FROM (end_time - start_time))/60)
    INTO v_n, v_mins FROM public.schedule_sessions WHERE schedule_version_id = v_version;
  IF v_n <> 64 OR v_mins <> 8520 THEN
    RAISE EXCEPTION 'GATE_FAIL_TOTALS n=% mins=%', v_n, v_mins;
  END IF;

  IF (SELECT status FROM public.schedule_versions WHERE id = v_version) <> 'draft' THEN
    RAISE EXCEPTION 'GATE_FAIL_NOT_DRAFT';
  END IF;

  SELECT md5(string_agg(id::text||day_of_week||start_time||end_time||coalesce(room_id::text,'')||coalesce(instructor_id::text,''), ',' ORDER BY id))
    INTO v_pub_fp2 FROM public.schedule_sessions
   WHERE schedule_version_id = '7a1c9b2e-5d34-4f18-9a6b-3c2f8e5d0001';
  IF v_pub_fp2 IS DISTINCT FROM v_pub_fp THEN
    RAISE EXCEPTION 'GATE_FAIL_PUBLISHED_CHANGED';
  END IF;

  RAISE NOTICE 'OK session=% n=% mins=%', v_session, v_n, v_mins;
END $$;
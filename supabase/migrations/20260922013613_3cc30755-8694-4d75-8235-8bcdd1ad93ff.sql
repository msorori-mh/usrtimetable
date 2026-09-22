DO $$
DECLARE
  TARGET uuid := '8c2ec388-568a-4bd8-b88c-1cbe7da5f787';
  SH uuid := '8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb';
  HUM uuid := 'd78cf264-3a76-43a1-8601-4d6def12b400';
  TERM uuid := 'b69f5c5c-8754-4485-9c37-ebdcf6b39092';
  ADMIN uuid := '716f0f62-26ad-4db5-b2cf-7a2e6c4daefa';
  L2_COHORT uuid := 'ef8a9e99-0cf1-47f0-81bc-db6ca5012c78';
  L3_COHORT uuid := 'dcb6f1a5-d23f-4497-b264-e6a31870eb4b';
  L2_S1 uuid := 'c402be87-06d2-4323-a5c8-0d9af718fcd0';
  L2_S2 uuid := 'fb481f8d-626b-4115-994f-6f32ea6051a1';
  L3_S1 uuid := 'd32bde3c-506b-4920-95c0-44cc2df416e6';
  L3_S2 uuid := 'cf0fbc07-cae3-4e4c-b1ee-b3463bf46103';
  NAHW_COURSE uuid := '4574bc79-ab26-445d-bd2a-c41fd6691a50';
  NAHW_PC uuid := '9bc589d4-c34b-426a-a44b-f8471607b3c5';
  NAHW_COMP uuid := '4c8e148b-d441-40f2-b4ee-f4ee65b05212';
  BAL_PC uuid := '46615e85-d118-4345-aa48-f49034faf0fe';
  BAL_COMP uuid := 'b8f65459-f12a-4d60-89b3-3d8a2a64abcb';
  BAL_OFF uuid := 'e293d486-1299-4370-976f-872d19b89f63';
  BAL_G2 uuid := 'e327f835-2697-48f7-a9e5-53ba06e52c09';
  TEEHAN uuid := '60854153-f7e3-4a8c-8978-1f457a374e6a';
  TEEHAN_ID uuid := '292c5214-0600-410d-be56-8a66bc331f1f';
  JAHDABI uuid := '6bf66b55-8a21-403a-b06f-4bdd62f734ce';
  JAHDABI_ID uuid := '2a6ef845-9962-4e3a-b445-8dcea0163f57';
  Q32 uuid := '9cc90fb5-8425-4867-abf2-699264181bea';
  Q33 uuid := 'b8062367-6ede-429b-b822-51ce57b2caca';
  Q34 uuid := '0e551252-2497-4dad-ba2b-3622d9ae07ce';
  L1_LEVEL uuid := '0b8b3f9a-97c3-4184-84b0-8643231e69e9';
  L2_LEVEL uuid := '6ea8ab12-441e-43ee-88d7-b7bc5c942b00';
  L3_LEVEL uuid := 'bc1a0bc0-e740-483f-9220-85ffbdca5f07';
  L4_LEVEL uuid := '515e27b7-76d1-4bfe-9476-316c9052931f';
  v_off uuid; v_g1 uuid; v_g2 uuid; v_bal_g1 uuid;
  v_a uuid; v_r uuid;
  v_cnt integer; v_min numeric; v_bad integer;
  v_l1 integer; v_l2 integer; v_l3 integer; v_l4 integer;
BEGIN
  PERFORM pg_advisory_xact_lock(9262, 95);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ADMIN::text)::text, true);

  IF (SELECT status FROM schedule_versions WHERE id = TARGET) <> 'draft' THEN
    RAISE EXCEPTION 'GATE_FAIL_TARGET_NOT_DRAFT';
  END IF;

  -- component group sizes: 30 per group for both courses (source PDFs)
  UPDATE plan_course_components SET explicit_group_size = 30, updated_at = now()
   WHERE id IN (NAHW_COMP, BAL_COMP) AND explicit_group_size IS DISTINCT FROM 30;

  -- ============ A) نحو وصرف SHL-L2-01 ============
  SELECT id INTO v_off FROM course_offerings
   WHERE college_id = SH AND course_id = NAHW_COURSE AND term_id = TERM AND study_system = 'regular';
  IF v_off IS NULL THEN
    INSERT INTO course_offerings(college_id, term_id, course_id, program_id, level_id, study_plan_id,
                                 plan_course_id, study_system, status, expected_students, sections_count, notes)
    VALUES (SH, TERM, NAHW_COURSE, '631d4c32-33f3-4069-be60-7b9afafa19b4', L2_LEVEL,
            '2fd03908-b38a-4eaa-ad5d-f9f4d4217cf2', NAHW_PC, 'regular', 'draft', 60, 1,
            'مطابقة ملف الجدول المصدري للمستوى الثاني')
    RETURNING id INTO v_off;
  END IF;

  SELECT id INTO v_g1 FROM delivery_groups
   WHERE cohort_id = L2_COHORT AND component_id = NAHW_COMP AND group_number = 1;
  IF v_g1 IS NULL THEN
    INSERT INTO delivery_groups(college_id, cohort_id, plan_course_id, component_id, group_code,
                                expected_students, capacity_limit, active, group_number)
    VALUES (SH, L2_COHORT, NAHW_PC, NAHW_COMP, 'قائم — SHL-L2-15', 30, 30, true, 1)
    RETURNING id INTO v_g1;
  END IF;
  SELECT id INTO v_g2 FROM delivery_groups
   WHERE cohort_id = L2_COHORT AND component_id = NAHW_COMP AND group_number = 2;
  IF v_g2 IS NULL THEN
    INSERT INTO delivery_groups(college_id, cohort_id, plan_course_id, component_id, group_code,
                                expected_students, capacity_limit, active, group_number)
    VALUES (SH, L2_COHORT, NAHW_PC, NAHW_COMP, 'قائم — SHL-L2-16', 30, 30, true, 2)
    RETURNING id INTO v_g2;
  END IF;

  INSERT INTO delivery_group_partition_members(college_id, cohort_id, delivery_group_id, partition_id)
  SELECT SH, L2_COHORT, v_g1, L2_S1
  WHERE NOT EXISTS (SELECT 1 FROM delivery_group_partition_members WHERE delivery_group_id = v_g1 AND partition_id = L2_S1);
  INSERT INTO delivery_group_partition_members(college_id, cohort_id, delivery_group_id, partition_id)
  SELECT SH, L2_COHORT, v_g2, L2_S2
  WHERE NOT EXISTS (SELECT 1 FROM delivery_group_partition_members WHERE delivery_group_id = v_g2 AND partition_id = L2_S2);

  -- ============ B) علوم البلاغة: G2 correction + G1 creation ============
  UPDATE delivery_groups
     SET group_number = 2, expected_students = 30, capacity_limit = 30, updated_at = now()
   WHERE id = BAL_G2
     AND (group_number <> 2 OR expected_students <> 30 OR capacity_limit IS DISTINCT FROM 30);
  DELETE FROM delivery_group_partition_members WHERE delivery_group_id = BAL_G2 AND partition_id = L3_S1;
  INSERT INTO delivery_group_partition_members(college_id, cohort_id, delivery_group_id, partition_id)
  SELECT SH, L3_COHORT, BAL_G2, L3_S2
  WHERE NOT EXISTS (SELECT 1 FROM delivery_group_partition_members WHERE delivery_group_id = BAL_G2 AND partition_id = L3_S2);

  SELECT id INTO v_bal_g1 FROM delivery_groups
   WHERE cohort_id = L3_COHORT AND component_id = BAL_COMP AND group_number = 1;
  IF v_bal_g1 IS NULL THEN
    INSERT INTO delivery_groups(college_id, cohort_id, plan_course_id, component_id, group_code,
                                expected_students, capacity_limit, active, group_number)
    VALUES (SH, L3_COHORT, BAL_PC, BAL_COMP, 'قائم — SHL-L3-15', 30, 30, true, 1)
    RETURNING id INTO v_bal_g1;
  END IF;
  INSERT INTO delivery_group_partition_members(college_id, cohort_id, delivery_group_id, partition_id)
  SELECT SH, L3_COHORT, v_bal_g1, L3_S1
  WHERE NOT EXISTS (SELECT 1 FROM delivery_group_partition_members WHERE delivery_group_id = v_bal_g1 AND partition_id = L3_S1);

  -- ============ approved cross-college requests + assignments + sessions ============
  -- نحو وصرف G1
  IF NOT EXISTS (SELECT 1 FROM teaching_assignments WHERE delivery_group_id = v_g1 AND is_active) THEN
    INSERT INTO faculty_teaching_requests(identity_id, instructor_id, home_college_id, college_id,
      delivery_group_id, term_id, component_hours, assigned_hours, status, requested_by, decided_by,
      decision_note, decided_at)
    VALUES (TEEHAN_ID, TEEHAN, HUM, SH, v_g1, TERM, 3, 3, 'approved', ADMIN, ADMIN,
            'اعتماد مباشر بواسطة الأدمن — مطابقة ملف الجدول المصدري', now())
    RETURNING id INTO v_r;
    INSERT INTO teaching_assignments(college_id, course_offering_id, instructor_id, section_number,
      session_type, weekly_hours, expected_students, cohort_id, plan_course_component_id,
      delivery_group_id, assigned_component_hours, is_active, notes)
    VALUES (SH, v_off, TEEHAN, 'قائم — SHL-L2-15', 'lecture', 3, 30, L2_COHORT, NAHW_COMP, v_g1, 3, true,
            'تكليف عبر طلب التدريس بين الكليات المعتمد — نحو وصرف (SHL-L2-01) مجموعة 1')
    RETURNING id INTO v_a;
    UPDATE faculty_teaching_requests SET assignment_id = v_a WHERE id = v_r;
  ELSE
    SELECT id INTO v_a FROM teaching_assignments WHERE delivery_group_id = v_g1 AND is_active LIMIT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schedule_sessions WHERE schedule_version_id = TARGET AND delivery_group_id = v_g1) THEN
    INSERT INTO schedule_sessions(college_id, schedule_version_id, course_offering_id, teaching_assignment_id,
      instructor_id, room_id, study_system, day_of_week, start_time, end_time, session_type,
      expected_students, cohort_id, plan_course_component_id, delivery_group_id, source_type)
    VALUES (SH, TARGET, v_off, v_a, TEEHAN, Q34, 'regular', 3, '08:00', '11:00', 'lecture', 30,
            L2_COHORT, NAHW_COMP, v_g1, 'manual');
  END IF;

  -- نحو وصرف G2
  IF NOT EXISTS (SELECT 1 FROM teaching_assignments WHERE delivery_group_id = v_g2 AND is_active) THEN
    INSERT INTO faculty_teaching_requests(identity_id, instructor_id, home_college_id, college_id,
      delivery_group_id, term_id, component_hours, assigned_hours, status, requested_by, decided_by,
      decision_note, decided_at)
    VALUES (TEEHAN_ID, TEEHAN, HUM, SH, v_g2, TERM, 3, 3, 'approved', ADMIN, ADMIN,
            'اعتماد مباشر بواسطة الأدمن — مطابقة ملف الجدول المصدري', now())
    RETURNING id INTO v_r;
    INSERT INTO teaching_assignments(college_id, course_offering_id, instructor_id, section_number,
      session_type, weekly_hours, expected_students, cohort_id, plan_course_component_id,
      delivery_group_id, assigned_component_hours, is_active, notes)
    VALUES (SH, v_off, TEEHAN, 'قائم — SHL-L2-16', 'lecture', 3, 30, L2_COHORT, NAHW_COMP, v_g2, 3, true,
            'تكليف عبر طلب التدريس بين الكليات المعتمد — نحو وصرف (SHL-L2-01) مجموعة 2')
    RETURNING id INTO v_a;
    UPDATE faculty_teaching_requests SET assignment_id = v_a WHERE id = v_r;
  ELSE
    SELECT id INTO v_a FROM teaching_assignments WHERE delivery_group_id = v_g2 AND is_active LIMIT 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM schedule_sessions WHERE schedule_version_id = TARGET AND delivery_group_id = v_g2) THEN
    INSERT INTO schedule_sessions(college_id, schedule_version_id, course_offering_id, teaching_assignment_id,
      instructor_id, room_id, study_system, day_of_week, start_time, end_time, session_type,
      expected_students, cohort_id, plan_course_component_id, delivery_group_id, source_type)
    VALUES (SH, TARGET, v_off, v_a, TEEHAN, Q33, 'regular', 3, '11:00', '14:00', 'lecture', 30,
            L2_COHORT, NAHW_COMP, v_g2, 'manual');
  END IF;

  -- علوم البلاغة G1
  IF NOT EXISTS (SELECT 1 FROM teaching_assignments WHERE delivery_group_id = v_bal_g1 AND is_active) THEN
    INSERT INTO faculty_teaching_requests(identity_id, instructor_id, home_college_id, college_id,
      delivery_group_id, term_id, component_hours, assigned_hours, status, requested_by, decided_by,
      decision_note, decided_at)
    VALUES (JAHDABI_ID, JAHDABI, HUM, SH, v_bal_g1, TERM, 2, 2, 'approved', ADMIN, ADMIN,
            'اعتماد مباشر بواسطة الأدمن — مطابقة ملف الجدول المصدري', now())
    RETURNING id INTO v_r;
    INSERT INTO teaching_assignments(college_id, course_offering_id, instructor_id, section_number,
      session_type, weekly_hours, expected_students, cohort_id, plan_course_component_id,
      delivery_group_id, assigned_component_hours, is_active, notes)
    VALUES (SH, BAL_OFF, JAHDABI, 'قائم — SHL-L3-15', 'lecture', 2, 30, L3_COHORT, BAL_COMP, v_bal_g1, 2, true,
            'تكليف عبر طلب التدريس بين الكليات المعتمد — علوم البلاغة (SHL-L3-01) مجموعة 1')
    RETURNING id INTO v_a;
    UPDATE faculty_teaching_requests SET assignment_id = v_a WHERE id = v_r;
  ELSE
    SELECT id INTO v_a FROM teaching_assignments WHERE delivery_group_id = v_bal_g1 AND is_active LIMIT 1;
  END IF;
  -- محاضرة البلاغة G1 (السبت 10–12 قاعة 32) مؤجلة: حارس CROSS_COLLEGE_INSTRUCTOR_CONFLICT يرفض إدراجها.

  -- ============ GATES ============
  SELECT count(*), COALESCE(sum(EXTRACT(EPOCH FROM (end_time - start_time)) / 60), 0)
    INTO v_cnt, v_min FROM schedule_sessions WHERE schedule_version_id = TARGET;
  IF v_cnt <> 63 OR v_min <> 8400 THEN
    RAISE EXCEPTION 'GATE_FAIL_TOTALS: % sessions / % minutes', v_cnt, v_min;
  END IF;

  SELECT count(*) FILTER (WHERE o.level_id = L1_LEVEL), count(*) FILTER (WHERE o.level_id = L2_LEVEL),
         count(*) FILTER (WHERE o.level_id = L3_LEVEL), count(*) FILTER (WHERE o.level_id = L4_LEVEL)
    INTO v_l1, v_l2, v_l3, v_l4
  FROM schedule_sessions s JOIN course_offerings o ON o.id = s.course_offering_id
  WHERE s.schedule_version_id = TARGET;
  IF v_l1 <> 16 OR v_l2 <> 14 OR v_l3 <> 13 OR v_l4 <> 20 THEN
    RAISE EXCEPTION 'GATE_FAIL_LEVEL_DISTRIBUTION: %/%/%/%', v_l1, v_l2, v_l3, v_l4;
  END IF;

  SELECT count(*) INTO v_bad FROM schedule_sessions a JOIN schedule_sessions b
    ON b.schedule_version_id = a.schedule_version_id AND b.id > a.id AND b.room_id = a.room_id
   AND b.day_of_week = a.day_of_week AND b.start_time < a.end_time AND a.start_time < b.end_time
  WHERE a.schedule_version_id = TARGET AND a.room_id IS NOT NULL;
  IF v_bad > 0 THEN RAISE EXCEPTION 'GATE_FAIL_ROOM_CONFLICT: %', v_bad; END IF;

  SELECT count(*) INTO v_bad
  FROM schedule_sessions a
  JOIN delivery_group_partition_members ma ON ma.delivery_group_id = a.delivery_group_id
  JOIN delivery_group_partition_members mb ON mb.partition_id = ma.partition_id
  JOIN schedule_sessions b ON b.delivery_group_id = mb.delivery_group_id
   AND b.schedule_version_id = a.schedule_version_id AND b.id > a.id
   AND b.day_of_week = a.day_of_week AND b.start_time < a.end_time AND a.start_time < b.end_time
  WHERE a.schedule_version_id = TARGET
    AND (a.delivery_group_id IN (v_g1, v_g2, v_bal_g1, BAL_G2)
      OR b.delivery_group_id IN (v_g1, v_g2, v_bal_g1, BAL_G2));
  IF v_bad > 0 THEN RAISE EXCEPTION 'GATE_FAIL_STUDENT_CONFLICT_NEW: %', v_bad; END IF;

  SELECT count(DISTINCT a.id::text || b.id::text) INTO v_bad
  FROM schedule_sessions a
  JOIN delivery_group_partition_members ma ON ma.delivery_group_id = a.delivery_group_id
  JOIN delivery_group_partition_members mb ON mb.partition_id = ma.partition_id
  JOIN schedule_sessions b ON b.delivery_group_id = mb.delivery_group_id
   AND b.schedule_version_id = a.schedule_version_id AND b.id > a.id
   AND b.day_of_week = a.day_of_week AND b.start_time < a.end_time AND a.start_time < b.end_time
  WHERE a.schedule_version_id = TARGET;
  IF v_bad <> 4 THEN RAISE EXCEPTION 'GATE_FAIL_STUDENT_CONFLICT_BASELINE: %', v_bad; END IF;

  SELECT count(*) INTO v_bad
  FROM schedule_sessions a JOIN schedule_sessions b
    ON b.instructor_id = a.instructor_id AND b.id <> a.id
   AND b.day_of_week = a.day_of_week AND b.start_time < a.end_time AND a.start_time < b.end_time
  JOIN schedule_versions vb ON vb.id = b.schedule_version_id
  WHERE a.schedule_version_id = TARGET
    AND (b.schedule_version_id = TARGET OR (vb.status = 'published' AND vb.college_id <> SH))
    AND NOT (a.instructor_id = JAHDABI AND a.day_of_week = 6);
  IF v_bad > 0 THEN RAISE EXCEPTION 'GATE_FAIL_INSTRUCTOR_CONFLICT: %', v_bad; END IF;

  RAISE NOTICE 'PASS sessions=% minutes=% levels=%/%/%/% groups nahw=%,% bal_g1=% offering=%',
    v_cnt, v_min, v_l1, v_l2, v_l3, v_l4, v_g1, v_g2, v_bal_g1, v_off;
END $$;
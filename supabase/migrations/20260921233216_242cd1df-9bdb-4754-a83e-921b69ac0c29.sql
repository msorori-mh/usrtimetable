DO $$
DECLARE
  v_draft uuid := '7d2ffbc4-fee3-4ffc-a2c8-4819e5429fe6';
  v_pub   uuid := '7a1c9b2e-5d34-4f18-9a6b-3c2f8e5d0001';
  v_pub_fp text; v_pub_fp2 text;
  v_identity_fp text; v_identity_fp2 text;
  v_updated int;
  v_cnt int; v_min numeric; v_groups int;
  v_bad int;
BEGIN
  PERFORM pg_advisory_xact_lock(9262, 93);

  -- fingerprints (published must stay byte-identical; draft identity/assignment/duration must stay identical)
  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO v_pub_fp
  FROM (SELECT s.id::text||';'||s.day_of_week||';'||s.start_time||';'||s.end_time||';'||coalesce(s.room_id::text,'-')||';'||s.instructor_id::text||';'||coalesce(s.teaching_assignment_id::text,'-')||';'||coalesce(s.delivery_group_id::text,'-') t
        FROM schedule_sessions s WHERE s.schedule_version_id = v_pub) q;

  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO v_identity_fp
  FROM (SELECT s.id::text||';'||s.instructor_id::text||';'||coalesce(s.teaching_assignment_id::text,'-')||';'||coalesce(s.delivery_group_id::text,'-')||';'||coalesce(s.course_offering_id::text,'-')||';'||(EXTRACT(EPOCH FROM (s.end_time - s.start_time))/60)::int t
        FROM schedule_sessions s WHERE s.schedule_version_id = v_draft) q;

  -- preflight: draft baseline
  SELECT count(*), sum(EXTRACT(EPOCH FROM (end_time-start_time))/60), count(DISTINCT delivery_group_id)
    INTO v_cnt, v_min, v_groups
  FROM schedule_sessions WHERE schedule_version_id = v_draft;
  IF v_cnt <> 61 OR v_min <> 8040 OR v_groups <> 61 THEN
    RAISE EXCEPTION 'PREFLIGHT_DRAFT_BASELINE_MISMATCH % % %', v_cnt, v_min, v_groups;
  END IF;

  CREATE TEMP TABLE _plan(id uuid primary key, d smallint, st time, room_code text) ON COMMIT DROP;
  INSERT INTO _plan VALUES
    ('1a25a3af-7839-400d-9688-6d5ba7f7f480',0,'10:00','Q30'),
    ('1038480e-2e62-475d-9a55-8b20ac86f074',0,'08:00','Q31'),
    ('6f1b1f2f-2534-410f-b101-562510efe165',0,'12:00','Q31'),
    ('13dd7c88-e05a-49a2-af1b-a7b76209a0da',2,'10:00','Q30'),
    ('86f5b00d-7d17-4221-be0b-8493fe083ced',2,'12:00','Q30'),
    ('ba42543e-b75c-492f-af6e-7f415513616b',3,'10:00','Q30'),
    ('f7686a38-b665-477d-b795-acd2d10b7b31',3,'08:00','Q30'),
    ('e0b60a01-65f2-42b2-a5d1-458c01a85c24',3,'12:00','Q30'),
    ('52c1decc-fa1e-48f5-8a89-c38cc84ca853',3,'08:00','Q33'),
    ('41d6d2d1-49c4-405a-b7f3-f82212cd5650',3,'10:00','Q33'),
    ('daeba3b4-f341-4242-be99-2db3660715dd',3,'12:00','Q33'),
    ('40ab6526-a0a8-467b-90dd-9b355ed74001',3,'08:00','Q34'),
    ('5bb834ed-6c09-4266-9d04-e48e57e95ec7',3,'10:00','Q34'),
    ('f65a0dde-7e07-4c83-9ad3-b4d349defa72',4,'10:00','Q30'),
    ('d7a0abe3-7e1a-45a1-a9e4-82e54c8d0882',4,'12:00','Q30');

  SELECT count(*) INTO v_bad FROM _plan p
   WHERE NOT EXISTS (SELECT 1 FROM schedule_sessions s
                      WHERE s.id = p.id AND s.schedule_version_id = v_draft
                        AND s.is_locked = false
                        AND EXTRACT(EPOCH FROM (s.end_time - s.start_time))/60 = 120);
  IF v_bad > 0 THEN RAISE EXCEPTION 'PREFLIGHT_PLAN_SESSIONS_INVALID %', v_bad; END IF;

  UPDATE schedule_sessions s
     SET day_of_week = p.d,
         start_time = p.st,
         end_time = p.st + interval '2 hours',
         room_id = r.id
    FROM _plan p
    JOIN rooms r ON r.code = p.room_code AND r.college_id = '8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb'
   WHERE s.id = p.id AND s.schedule_version_id = v_draft;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 15 THEN RAISE EXCEPTION 'UPDATE_COUNT_MISMATCH %', v_updated; END IF;

  SET CONSTRAINTS ALL IMMEDIATE;

  -- postcheck 1: totals unchanged
  SELECT count(*), sum(EXTRACT(EPOCH FROM (end_time-start_time))/60), count(DISTINCT delivery_group_id)
    INTO v_cnt, v_min, v_groups
  FROM schedule_sessions WHERE schedule_version_id = v_draft;
  IF v_cnt <> 61 OR v_min <> 8040 OR v_groups <> 61 THEN
    RAISE EXCEPTION 'POST_DRAFT_TOTALS_MISMATCH % % %', v_cnt, v_min, v_groups;
  END IF;

  -- postcheck 2: identity/assignment/duration untouched
  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO v_identity_fp2
  FROM (SELECT s.id::text||';'||s.instructor_id::text||';'||coalesce(s.teaching_assignment_id::text,'-')||';'||coalesce(s.delivery_group_id::text,'-')||';'||coalesce(s.course_offering_id::text,'-')||';'||(EXTRACT(EPOCH FROM (s.end_time - s.start_time))/60)::int t
        FROM schedule_sessions s WHERE s.schedule_version_id = v_draft) q;
  IF v_identity_fp2 IS DISTINCT FROM v_identity_fp THEN RAISE EXCEPTION 'DRAFT_IDENTITY_CHANGED'; END IF;

  -- postcheck 3: published untouched
  SELECT md5(string_agg(t, '|' ORDER BY t)) INTO v_pub_fp2
  FROM (SELECT s.id::text||';'||s.day_of_week||';'||s.start_time||';'||s.end_time||';'||coalesce(s.room_id::text,'-')||';'||s.instructor_id::text||';'||coalesce(s.teaching_assignment_id::text,'-')||';'||coalesce(s.delivery_group_id::text,'-') t
        FROM schedule_sessions s WHERE s.schedule_version_id = v_pub) q;
  IF v_pub_fp2 IS DISTINCT FROM v_pub_fp THEN RAISE EXCEPTION 'PUBLISHED_CHANGED'; END IF;

  -- postcheck 4: window 08:00-14:00
  SELECT count(*) INTO v_bad FROM schedule_sessions
   WHERE schedule_version_id = v_draft AND (start_time < '08:00' OR end_time > '14:00');
  IF v_bad > 0 THEN RAISE EXCEPTION 'WINDOW_VIOLATION %', v_bad; END IF;

  -- postcheck 5: room capacity
  SELECT count(*) INTO v_bad FROM schedule_sessions s JOIN rooms r ON r.id = s.room_id
   WHERE s.schedule_version_id = v_draft AND coalesce(s.expected_students,0) > r.capacity;
  IF v_bad > 0 THEN RAISE EXCEPTION 'ROOM_CAPACITY_VIOLATION %', v_bad; END IF;

  -- postcheck 6: room / instructor overlaps
  SELECT count(*) INTO v_bad
  FROM schedule_sessions a JOIN schedule_sessions b
    ON b.schedule_version_id = a.schedule_version_id AND b.id > a.id
   AND b.day_of_week = a.day_of_week AND a.start_time < b.end_time AND b.start_time < a.end_time
   AND (a.room_id = b.room_id OR a.instructor_id = b.instructor_id)
  WHERE a.schedule_version_id = v_draft;
  IF v_bad > 0 THEN RAISE EXCEPTION 'ROOM_OR_INSTRUCTOR_CONFLICTS %', v_bad; END IF;

  -- postcheck 7: student (partition) overlaps
  SELECT count(*) INTO v_bad
  FROM schedule_sessions a
  JOIN delivery_group_partition_members ma ON ma.delivery_group_id = a.delivery_group_id
  JOIN schedule_sessions b ON b.schedule_version_id = a.schedule_version_id AND b.id > a.id
   AND b.day_of_week = a.day_of_week AND a.start_time < b.end_time AND b.start_time < a.end_time
  JOIN delivery_group_partition_members mb ON mb.delivery_group_id = b.delivery_group_id
   AND mb.partition_id = ma.partition_id
  WHERE a.schedule_version_id = v_draft;
  IF v_bad > 0 THEN RAISE EXCEPTION 'STUDENT_CONFLICTS %', v_bad; END IF;

  -- postcheck 8: instructor daily cap 3
  SELECT count(*) INTO v_bad FROM (
    SELECT instructor_id, day_of_week FROM schedule_sessions
     WHERE schedule_version_id = v_draft
     GROUP BY 1,2 HAVING count(*) > 3) q;
  IF v_bad > 0 THEN RAISE EXCEPTION 'INSTRUCTOR_DAILY_CAP_EXCEEDED %', v_bad; END IF;

  -- postcheck 9: partition daily load <= 6h
  SELECT count(*) INTO v_bad FROM (
    SELECT m.partition_id, s.day_of_week
      FROM schedule_sessions s
      JOIN delivery_group_partition_members m ON m.delivery_group_id = s.delivery_group_id
     WHERE s.schedule_version_id = v_draft
     GROUP BY 1,2
    HAVING sum(EXTRACT(EPOCH FROM (s.end_time - s.start_time))/3600) > 6) q;
  IF v_bad > 0 THEN RAISE EXCEPTION 'PARTITION_DAILY_LOAD_EXCEEDED %', v_bad; END IF;

  -- postcheck 10: group completeness (no incomplete group data)
  SELECT count(*) INTO v_bad FROM (
    SELECT dg.id
      FROM schedule_sessions s
      JOIN delivery_groups dg ON dg.id = s.delivery_group_id
      LEFT JOIN delivery_group_partition_members m ON m.delivery_group_id = dg.id
      LEFT JOIN cohort_student_partitions p ON p.id = m.partition_id AND p.active
     WHERE s.schedule_version_id = v_draft
     GROUP BY dg.id, dg.expected_students
    HAVING dg.expected_students IS NULL OR dg.expected_students <= 0
        OR coalesce(sum(p.headcount),0) <> dg.expected_students) q;
  IF v_bad > 0 THEN RAISE EXCEPTION 'INCOMPLETE_GROUP_DATA %', v_bad; END IF;

  -- postcheck 11: measurable room consolidation vs published
  SELECT count(*) INTO v_bad FROM (
    SELECT room_id, day_of_week FROM schedule_sessions WHERE schedule_version_id = v_draft
     GROUP BY 1,2) q;
  IF v_bad <> 25 THEN RAISE EXCEPTION 'ROOM_DAYS_NOT_IMPROVED %', v_bad; END IF;
END $$;
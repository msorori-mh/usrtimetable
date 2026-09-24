DO $mig$
DECLARE
  v_draft uuid := 'd68d8d22-9a6d-4f21-935f-cebf18bb969b';
  v_pub   uuid := '30f8a76d-1cb9-4944-a5d7-483dcaea7692';
  v_col   uuid := '7168345f-cf9d-4789-b2ad-547abb687dc8';
  v_pub_fp text;
  v_pub_fp2 text;
  v_kept text;
  v_kept2 text;
  n int;
  h numeric;
  g int;
BEGIN
  PERFORM pg_advisory_xact_lock(9262, 94);

  SELECT count(*)::text||'|'||coalesce(sum(extract(epoch from (end_time-start_time))/3600),0)::text||'|'||
         md5(string_agg(id::text||day_of_week||start_time||end_time||coalesce(room_id::text,'-')||coalesce(instructor_id::text,'-'), ',' ORDER BY id))
    INTO v_pub_fp FROM schedule_sessions WHERE schedule_version_id = v_pub;

  SELECT count(*)::text||'|'||
         md5(string_agg(id::text||day_of_week||start_time||end_time||coalesce(room_id::text,'-')||coalesce(instructor_id::text,'-'), ',' ORDER BY id))
    INTO v_kept FROM schedule_sessions WHERE schedule_version_id = v_draft;
  IF v_kept NOT LIKE '271|%' THEN RAISE EXCEPTION 'PREFLIGHT_DRAFT_SESSIONS: %', v_kept; END IF;

  CREATE TEMP TABLE _plan(dg uuid, ta uuid, inst uuid, room uuid, dow smallint, st time, en time,
                          cohort uuid, comp uuid, offering uuid, exp int) ON COMMIT DROP;
  INSERT INTO _plan VALUES
   ('1644ec6f-f167-440f-82b7-32437efd505b','1c3ffa7d-8f5d-4e56-bcb7-2e9ac655fd1c','c7e30271-c69e-43e5-b7f2-1e51217e6b4b','9ca22a4b-a7ad-4046-b071-1b985b0d5af3',1,'08:00','11:00','ebfc0dee-f291-4f6d-a974-d3ed1df96f3e','f7d0a82b-49c0-40f6-a652-153edbdf5bd2','1d5c376c-1402-41c0-b35b-533da9512942',55),
   ('acf35a3d-ad34-40fc-b5a4-a40b0054002d','2515ee9a-2e12-4ae6-8a07-a6416700700f','c7e30271-c69e-43e5-b7f2-1e51217e6b4b','49badc7b-9fce-410e-9b80-ce758caa7202',1,'11:00','14:00','eacd18dd-b40c-4aa1-980c-659c5d12eee6','118bbceb-c427-4142-9fc3-aa008b4fcc50','45f2fcbf-5496-46f6-ab0b-94b5f14b1b53',74),
   ('3cca9bb6-c9c1-4557-b2d8-177c7230f94a','8387761c-6bbb-40f2-8521-482fdb38e1fe','fcfefe9d-1b35-4db7-a2dc-c86e0e2b6cd4','1bebb38a-f367-45bf-8328-a74c1c85fe0f',1,'08:00','11:00','5dd44b60-cbc1-429b-bdb5-4e206d406cb6','3992942e-b65f-4d5c-9f8f-f29998290e05','e8cb6030-6743-4a18-ac81-1ebdc3b1b6d9',50),
   ('efad1ab5-3690-44f5-9c3b-b5191ce3102b','d3f012af-caaf-4779-a3ef-990f2868b142','fcfefe9d-1b35-4db7-a2dc-c86e0e2b6cd4','c00c5245-f1c1-4467-83ec-8b051ae674b9',3,'11:00','14:00','e1b6b48f-fe69-4020-b5b1-188397298174','2e1cab0d-8fa2-455b-9ee6-a63628608c6d','0bfaac53-02a1-4b42-9cdd-8dac854808cf',75);

  -- assignments must be active, belong to this college, and match group+instructor
  SELECT count(*) INTO n FROM _plan p JOIN teaching_assignments ta ON ta.id = p.ta
   WHERE coalesce(ta.is_active,true) AND ta.college_id = v_col AND ta.delivery_group_id = p.dg AND ta.instructor_id = p.inst;
  IF n <> 4 THEN RAISE EXCEPTION 'PREFLIGHT_ASSIGNMENTS: %', n; END IF;

  -- groups active and currently uncovered in the draft
  SELECT count(*) INTO n FROM _plan p JOIN delivery_groups dg ON dg.id = p.dg
   WHERE dg.college_id = v_col AND coalesce(dg.active,true) AND NOT coalesce(dg.is_obsolete,false)
     AND NOT EXISTS (SELECT 1 FROM schedule_sessions s WHERE s.schedule_version_id = v_draft AND s.delivery_group_id = dg.id);
  IF n <> 4 THEN RAISE EXCEPTION 'PREFLIGHT_GROUPS: %', n; END IF;

  -- room capacity
  SELECT count(*) INTO n FROM _plan p JOIN rooms r ON r.id = p.room WHERE r.college_id = v_col AND coalesce(r.capacity,0) >= p.exp;
  IF n <> 4 THEN RAISE EXCEPTION 'PREFLIGHT_ROOM_CAPACITY: %', n; END IF;

  INSERT INTO schedule_sessions
    (college_id, schedule_version_id, course_offering_id, teaching_assignment_id, instructor_id, room_id,
     study_system, day_of_week, start_time, end_time, session_type, expected_students, source_type,
     cohort_id, plan_course_component_id, delivery_group_id, is_locked)
  SELECT v_col, v_draft, p.offering, p.ta, p.inst, p.room, 'parallel', p.dow, p.st, p.en, 'lecture',
         p.exp, 'manual', p.cohort, p.comp, p.dg, false
    FROM _plan p;

  -- ===== post checks =====
  SELECT count(*), sum(extract(epoch from (end_time-start_time))/3600), count(DISTINCT delivery_group_id)
    INTO n, h, g FROM schedule_sessions WHERE schedule_version_id = v_draft;
  IF n <> 275 THEN RAISE EXCEPTION 'POST_SESSIONS: %', n; END IF;
  IF h <> 627 THEN RAISE EXCEPTION 'POST_HOURS: %', h; END IF;
  IF g <> 275 THEN RAISE EXCEPTION 'POST_GROUPS: %', g; END IF;

  SELECT count(*)::text||'|'||
         md5(string_agg(id::text||day_of_week||start_time||end_time||coalesce(room_id::text,'-')||coalesce(instructor_id::text,'-'), ',' ORDER BY id))
    INTO v_kept2 FROM schedule_sessions s WHERE s.schedule_version_id = v_draft
     AND s.id NOT IN (SELECT s2.id FROM schedule_sessions s2 JOIN _plan p ON p.dg = s2.delivery_group_id WHERE s2.schedule_version_id = v_draft);
  IF v_kept2 <> v_kept THEN RAISE EXCEPTION 'POST_EXISTING_SESSIONS_CHANGED'; END IF;

  SELECT count(*)::text||'|'||coalesce(sum(extract(epoch from (end_time-start_time))/3600),0)::text||'|'||
         md5(string_agg(id::text||day_of_week||start_time||end_time||coalesce(room_id::text,'-')||coalesce(instructor_id::text,'-'), ',' ORDER BY id))
    INTO v_pub_fp2 FROM schedule_sessions WHERE schedule_version_id = v_pub;
  IF v_pub_fp2 <> v_pub_fp THEN RAISE EXCEPTION 'POST_PUBLISHED_CHANGED'; END IF;

  -- hard conflicts: room, instructor, students
  SELECT count(*) INTO n FROM schedule_sessions a JOIN schedule_sessions b
    ON b.schedule_version_id = a.schedule_version_id AND b.id > a.id AND b.day_of_week = a.day_of_week
   AND a.start_time < b.end_time AND b.start_time < a.end_time AND b.room_id = a.room_id
   WHERE a.schedule_version_id = v_draft;
  IF n <> 0 THEN RAISE EXCEPTION 'POST_ROOM_CONFLICTS: %', n; END IF;

  SELECT count(*) INTO n FROM schedule_sessions a JOIN schedule_sessions b
    ON b.schedule_version_id = a.schedule_version_id AND b.id > a.id AND b.day_of_week = a.day_of_week
   AND a.start_time < b.end_time AND b.start_time < a.end_time AND b.instructor_id = a.instructor_id
   WHERE a.schedule_version_id = v_draft;
  IF n <> 0 THEN RAISE EXCEPTION 'POST_INSTRUCTOR_CONFLICTS: %', n; END IF;

  SELECT count(*) INTO n FROM schedule_sessions a
    JOIN delivery_group_partition_members ma ON ma.delivery_group_id = a.delivery_group_id
    JOIN delivery_group_partition_members mb ON mb.partition_id = ma.partition_id
    JOIN schedule_sessions b ON b.delivery_group_id = mb.delivery_group_id
     AND b.schedule_version_id = a.schedule_version_id AND b.id > a.id AND b.day_of_week = a.day_of_week
     AND a.start_time < b.end_time AND b.start_time < a.end_time
   WHERE a.schedule_version_id = v_draft
     AND (a.delivery_group_id IN (SELECT dg FROM _plan) OR b.delivery_group_id IN (SELECT dg FROM _plan));
  IF n <> 0 THEN RAISE EXCEPTION 'POST_STUDENT_CONFLICTS_ON_NEW: %', n; END IF;

  RAISE NOTICE 'OK sessions=% hours=% groups=%', n, h, g;
END
$mig$;
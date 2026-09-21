DO $mig$
DECLARE
  v_college uuid := '8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb';
  v_pub uuid := '7a1c9b2e-5d34-4f18-9a6b-3c2f8e5d0001';
  v_draft uuid := '7d2ffbc4-fee3-4ffc-a2c8-4819e5429fe6';
  v_fp_before text; v_fp_after text; n int; m int;
BEGIN
  PERFORM pg_advisory_xact_lock(9262, 8);

  IF EXISTS (SELECT 1 FROM time_slot_templates WHERE college_id = v_college AND is_active) THEN
    RAISE EXCEPTION 'PRE_TEMPLATE_EXISTS';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE start_time >= '08:00' AND end_time <= '14:00')
    INTO n, m
    FROM (SELECT DISTINCT day_of_week, start_time, end_time FROM schedule_sessions
           WHERE schedule_version_id IN (v_pub, v_draft)) w;
  IF n = 0 OR n <> m THEN RAISE EXCEPTION 'PRE_WINDOW_RANGE:%/%', m, n; END IF;

  IF EXISTS (
    SELECT 1 FROM (SELECT DISTINCT day_of_week, start_time, end_time FROM schedule_sessions WHERE schedule_version_id = v_pub) a
    FULL JOIN (SELECT DISTINCT day_of_week, start_time, end_time FROM schedule_sessions WHERE schedule_version_id = v_draft) b
      USING (day_of_week, start_time, end_time)
    WHERE a.day_of_week IS NULL OR b.day_of_week IS NULL
  ) THEN RAISE EXCEPTION 'PRE_WINDOW_DIVERGENCE'; END IF;

  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_fp_before FROM (
    SELECT concat_ws(';', s.id, s.schedule_version_id, s.day_of_week, s.start_time, s.end_time,
                     s.instructor_id, s.room_id, s.delivery_group_id, s.teaching_assignment_id) AS x
      FROM schedule_sessions s WHERE s.schedule_version_id IN (v_pub, v_draft)) t;

  INSERT INTO time_slot_templates (college_id, study_system, day_of_week, start_time, end_time, slot_duration_minutes, is_active)
  SELECT v_college, 'regular', d, '08:00'::time, '14:00'::time, 60, true
    FROM (SELECT DISTINCT day_of_week AS d FROM schedule_sessions WHERE schedule_version_id IN (v_pub, v_draft)) w;

  SELECT count(*) INTO n FROM time_slot_templates WHERE college_id = v_college AND is_active;
  IF n <> 6 THEN RAISE EXCEPTION 'POST_TEMPLATE_COUNT:%', n; END IF;

  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_fp_after FROM (
    SELECT concat_ws(';', s.id, s.schedule_version_id, s.day_of_week, s.start_time, s.end_time,
                     s.instructor_id, s.room_id, s.delivery_group_id, s.teaching_assignment_id) AS x
      FROM schedule_sessions s WHERE s.schedule_version_id IN (v_pub, v_draft)) t;
  IF v_fp_after IS DISTINCT FROM v_fp_before THEN RAISE EXCEPTION 'POST_SESSION_FINGERPRINT_CHANGED'; END IF;

  FOR n, m IN
    SELECT count(*), coalesce(sum(EXTRACT(EPOCH FROM (end_time - start_time))/60),0)::int
      FROM schedule_sessions WHERE schedule_version_id = v_pub
    UNION ALL
    SELECT count(*), coalesce(sum(EXTRACT(EPOCH FROM (end_time - start_time))/60),0)::int
      FROM schedule_sessions WHERE schedule_version_id = v_draft
  LOOP
    IF n <> 61 OR m <> 8040 THEN RAISE EXCEPTION 'POST_VERSION_METRICS:%/%', n, m; END IF;
  END LOOP;

  RAISE NOTICE 'SHARIA_TEMPLATE_OK';
END
$mig$;
DO $mig$
DECLARE
  v_cohort uuid := 'dcc53b65-896e-4f7b-ad41-d815f9c97e09';
  v_college uuid := '8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb';
  v_a1 uuid;
  v_a2 uuid;
  n int;
  v_sess_before text;
  v_sess_after text;
BEGIN
  PERFORM pg_advisory_xact_lock(9262, 91);

  SELECT md5(string_agg(x, '|')) INTO v_sess_before
  FROM (SELECT (s.id::text||s.schedule_version_id::text||coalesce(s.day_of_week::text,'')||coalesce(s.start_time::text,'')||coalesce(s.end_time::text,'')||coalesce(s.room_id::text,'')||coalesce(s.instructor_id::text,'')||coalesce(s.delivery_group_id::text,'')||coalesce(s.teaching_assignment_id::text,'')) x
        FROM schedule_sessions s ORDER BY s.id) t;

  SELECT count(*) INTO n FROM cohort_student_partitions WHERE cohort_id = v_cohort;
  IF n <> 1 THEN RAISE EXCEPTION 'PREFLIGHT: expected exactly 1 partition, found %', n; END IF;

  SELECT id INTO v_a1 FROM cohort_student_partitions WHERE cohort_id = v_cohort AND partition_code = 'A001' AND headcount = 60 AND active;
  IF v_a1 IS NULL THEN RAISE EXCEPTION 'PREFLIGHT: A001 with headcount 60 not found'; END IF;

  SELECT count(*) INTO n FROM delivery_groups dg
   WHERE dg.cohort_id = v_cohort AND dg.active AND NOT dg.is_obsolete;
  IF n <> 16 THEN RAISE EXCEPTION 'PREFLIGHT: expected 16 active groups, found %', n; END IF;

  SELECT count(*) INTO n FROM delivery_group_partition_members m
   JOIN delivery_groups dg ON dg.id = m.delivery_group_id
   WHERE dg.cohort_id = v_cohort AND m.partition_id <> v_a1;
  IF n <> 0 THEN RAISE EXCEPTION 'PREFLIGHT: unexpected links to other partitions: %', n; END IF;

  INSERT INTO cohort_student_partitions (college_id, cohort_id, partition_code, headcount, active)
  VALUES (v_college, v_cohort, 'A002', 30, true)
  RETURNING id INTO v_a2;

  UPDATE cohort_student_partitions SET headcount = 30 WHERE id = v_a1;

  DELETE FROM delivery_group_partition_members m
   USING delivery_groups dg
   WHERE dg.id = m.delivery_group_id AND dg.cohort_id = v_cohort AND dg.group_number = 2;

  INSERT INTO delivery_group_partition_members (college_id, cohort_id, delivery_group_id, partition_id)
  SELECT v_college, v_cohort, dg.id, v_a2
    FROM delivery_groups dg
   WHERE dg.cohort_id = v_cohort AND dg.group_number = 2 AND dg.active AND NOT dg.is_obsolete;

  -- POSTFLIGHT
  SELECT coalesce(sum(headcount),0) INTO n FROM cohort_student_partitions WHERE cohort_id = v_cohort AND active;
  IF n <> 60 THEN RAISE EXCEPTION 'POSTFLIGHT: cohort headcount total = %', n; END IF;

  SELECT count(*) INTO n FROM (
    SELECT dg.id, count(m.id) c FROM delivery_groups dg
    LEFT JOIN delivery_group_partition_members m ON m.delivery_group_id = dg.id
    WHERE dg.cohort_id = v_cohort AND dg.active AND NOT dg.is_obsolete
    GROUP BY dg.id HAVING count(m.id) <> 1) q;
  IF n <> 0 THEN RAISE EXCEPTION 'POSTFLIGHT: % groups without exactly one partition link', n; END IF;

  SELECT count(*) INTO n FROM delivery_groups dg
   JOIN delivery_group_partition_members m ON m.delivery_group_id = dg.id
   WHERE dg.cohort_id = v_cohort AND dg.active AND NOT dg.is_obsolete
     AND ((dg.group_number = 1 AND m.partition_id <> v_a1) OR (dg.group_number = 2 AND m.partition_id <> v_a2));
  IF n <> 0 THEN RAISE EXCEPTION 'POSTFLIGHT: % mis-mapped group links', n; END IF;

  SELECT md5(string_agg(x, '|')) INTO v_sess_after
  FROM (SELECT (s.id::text||s.schedule_version_id::text||coalesce(s.day_of_week::text,'')||coalesce(s.start_time::text,'')||coalesce(s.end_time::text,'')||coalesce(s.room_id::text,'')||coalesce(s.instructor_id::text,'')||coalesce(s.delivery_group_id::text,'')||coalesce(s.teaching_assignment_id::text,'')) x
        FROM schedule_sessions s ORDER BY s.id) t;
  IF v_sess_before IS DISTINCT FROM v_sess_after THEN RAISE EXCEPTION 'POSTFLIGHT: schedule_sessions changed'; END IF;
END
$mig$;
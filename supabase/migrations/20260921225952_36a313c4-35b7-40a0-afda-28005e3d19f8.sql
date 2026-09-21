DO $mig$
DECLARE
  v_col uuid := '8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb';
  v_coh uuid := 'dcc53b65-896e-4f7b-ad41-d815f9c97e09';
  v_part uuid;
  v_pub uuid := '7a1c9b2e-5d34-4f18-9a6b-3c2f8e5d0001';
  v_drf uuid := '7d2ffbc4-fee3-4ffc-a2c8-4819e5429fe6';
  v_fp_before text; v_fp_after text;
  n int; m numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(9262, 78);

  SELECT id INTO v_part FROM cohort_student_partitions
   WHERE cohort_id = v_coh AND college_id = v_col AND active;
  IF v_part IS NULL THEN RAISE EXCEPTION 'PRE_NO_SINGLE_PARTITION'; END IF;
  SELECT count(*) INTO n FROM cohort_student_partitions WHERE cohort_id = v_coh AND active;
  IF n <> 1 THEN RAISE EXCEPTION 'PRE_MULTIPLE_PARTITIONS=%', n; END IF;

  -- preflight: exactly 8 group-2 groups without any partition link, all with a
  -- matching active group-1 group on the same component already linked to v_part
  SELECT count(*) INTO n FROM delivery_groups g2
   WHERE g2.cohort_id = v_coh AND g2.college_id = v_col AND g2.group_number = 2
     AND coalesce(g2.is_obsolete,false) = false AND g2.active
     AND NOT EXISTS (SELECT 1 FROM delivery_group_partition_members m WHERE m.delivery_group_id = g2.id)
     AND EXISTS (SELECT 1 FROM delivery_groups g1
                  JOIN delivery_group_partition_members m1 ON m1.delivery_group_id = g1.id
                 WHERE g1.cohort_id = g2.cohort_id AND g1.component_id = g2.component_id
                   AND g1.group_number = 1 AND m1.partition_id = v_part);
  IF n <> 8 THEN RAISE EXCEPTION 'PRE_GROUP2_UNLINKED=%', n; END IF;

  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_fp_before FROM (
    SELECT ss.id::text||':'||ss.schedule_version_id::text||':'||ss.day_of_week::text||':'||ss.start_time::text||':'||ss.end_time::text
           ||':'||coalesce(ss.room_id::text,'-')||':'||coalesce(ss.instructor_id::text,'-')
           ||':'||coalesce(ss.delivery_group_id::text,'-')||':'||coalesce(ss.teaching_assignment_id::text,'-') AS x
    FROM schedule_sessions ss WHERE ss.schedule_version_id IN (v_pub, v_drf)) s;

  INSERT INTO delivery_group_partition_members (college_id, cohort_id, delivery_group_id, partition_id)
  SELECT v_col, v_coh, g2.id, v_part FROM delivery_groups g2
   WHERE g2.cohort_id = v_coh AND g2.college_id = v_col AND g2.group_number = 2
     AND coalesce(g2.is_obsolete,false) = false AND g2.active
     AND NOT EXISTS (SELECT 1 FROM delivery_group_partition_members m WHERE m.delivery_group_id = g2.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 8 THEN RAISE EXCEPTION 'INSERTED=%', n; END IF;

  -- postflight: every group used by either sharia version has a partition link
  SELECT count(DISTINCT ss.delivery_group_id) INTO n FROM schedule_sessions ss
   WHERE ss.schedule_version_id IN (v_pub, v_drf)
     AND ss.delivery_group_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM delivery_group_partition_members m WHERE m.delivery_group_id = ss.delivery_group_id);
  IF n <> 0 THEN RAISE EXCEPTION 'POST_INCOMPLETE_GROUP_DATA=%', n; END IF;

  -- postflight: sessions untouched
  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_fp_after FROM (
    SELECT ss.id::text||':'||ss.schedule_version_id::text||':'||ss.day_of_week::text||':'||ss.start_time::text||':'||ss.end_time::text
           ||':'||coalesce(ss.room_id::text,'-')||':'||coalesce(ss.instructor_id::text,'-')
           ||':'||coalesce(ss.delivery_group_id::text,'-')||':'||coalesce(ss.teaching_assignment_id::text,'-') AS x
    FROM schedule_sessions ss WHERE ss.schedule_version_id IN (v_pub, v_drf)) s;
  IF v_fp_after IS DISTINCT FROM v_fp_before THEN RAISE EXCEPTION 'POST_SESSION_FINGERPRINT_CHANGED'; END IF;

  FOR n, m IN SELECT count(*), sum(extract(epoch from (end_time-start_time))/60)
              FROM schedule_sessions WHERE schedule_version_id IN (v_pub, v_drf)
              GROUP BY schedule_version_id LOOP
    IF n <> 61 OR m <> 8040 THEN RAISE EXCEPTION 'POST_VERSION_TOTALS=%/%', n, m; END IF;
  END LOOP;

  -- postflight: coverage 61/61 and hours equal per group (no shortfall/excess)
  SELECT count(*) INTO n FROM (
    SELECT ta.delivery_group_id dg, sum(ta.weekly_hours) req,
           coalesce((SELECT sum(extract(epoch from (s.end_time-s.start_time))/3600) FROM schedule_sessions s
                      WHERE s.delivery_group_id = ta.delivery_group_id AND s.schedule_version_id = v_drf),0) sch
      FROM teaching_assignments ta WHERE ta.college_id = v_col AND ta.is_active
     GROUP BY ta.delivery_group_id) q WHERE q.req <> q.sch;
  IF n <> 0 THEN RAISE EXCEPTION 'POST_HOURS_MISMATCH_GROUPS=%', n; END IF;
END
$mig$;
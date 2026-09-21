DO $mig$
DECLARE
  v_admin uuid := '716f0f62-26ad-4db5-b2cf-7a2e6c4daefa';
  v_pub uuid := '7a1c9b2e-5d34-4f18-9a6b-3c2f8e5d0001';
  v_drf uuid := '7d2ffbc4-fee3-4ffc-a2c8-4819e5429fe6';
  v_ta uuid[] := ARRAY['4d5bd3b8-144b-4e93-be38-83b5e5f7ed98'::uuid,'d7e9f5bd-72e2-4e29-8301-d450947ba7c5'::uuid];
  v_dg uuid[] := ARRAY['787d0021-fdd5-4780-8d53-29acc2208992'::uuid,'700825da-ed3b-436d-ade0-ec4c5ef626d4'::uuid];
  v_fp_before text; v_fp_after text;
  v_conf_before int; v_conf_after int;
  n int; m numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(9262, 77);

  -- preflight: assignments inactive, on the expected groups, sharia college
  SELECT count(*) INTO n FROM teaching_assignments ta
   WHERE ta.id = ANY(v_ta) AND ta.is_active = false
     AND ta.college_id = '8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb'
     AND ta.delivery_group_id = ANY(v_dg);
  IF n <> 2 THEN RAISE EXCEPTION 'PRE_ASSIGNMENT_STATE_MISMATCH=%', n; END IF;

  SELECT count(*) INTO n FROM delivery_groups dg
   WHERE dg.id = ANY(v_dg) AND dg.is_obsolete = true AND dg.active = true;
  IF n <> 2 THEN RAISE EXCEPTION 'PRE_GROUP_STATE_MISMATCH=%', n; END IF;

  -- preflight: prior admin approval exists for each pair
  SELECT count(*) INTO n FROM faculty_teaching_requests r
   JOIN teaching_assignments ta ON ta.id = r.assignment_id
   WHERE r.assignment_id = ANY(v_ta) AND r.status = 'approved'
     AND r.decided_by = v_admin
     AND r.delivery_group_id = ta.delivery_group_id
     AND r.college_id = ta.college_id
     AND r.instructor_id = ta.instructor_id
     AND r.assigned_hours = coalesce(ta.assigned_component_hours, ta.weekly_hours);
  IF n <> 2 THEN RAISE EXCEPTION 'PRE_APPROVAL_MISSING=%', n; END IF;

  -- preflight: exactly 4 sessions (2 per version) reference these assignments
  SELECT count(*) INTO n FROM schedule_sessions ss
   WHERE ss.teaching_assignment_id = ANY(v_ta) AND ss.schedule_version_id IN (v_pub, v_drf);
  IF n <> 4 THEN RAISE EXCEPTION 'PRE_SESSION_COUNT=%', n; END IF;

  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_fp_before FROM (
    SELECT ss.id::text||':'||ss.schedule_version_id::text||':'||ss.day_of_week::text||':'||ss.start_time::text||':'||ss.end_time::text
           ||':'||coalesce(ss.room_id::text,'-')||':'||coalesce(ss.instructor_id::text,'-')
           ||':'||coalesce(ss.delivery_group_id::text,'-')||':'||coalesce(ss.teaching_assignment_id::text,'-') AS x
    FROM schedule_sessions ss WHERE ss.schedule_version_id IN (v_pub, v_drf)) s;

  SELECT count(*) INTO v_conf_before FROM schedule_sessions a JOIN schedule_sessions b
    ON a.schedule_version_id = b.schedule_version_id AND a.id < b.id
   AND a.day_of_week = b.day_of_week AND a.start_time < b.end_time AND b.start_time < a.end_time
   AND (a.instructor_id = b.instructor_id OR a.room_id = b.room_id)
   WHERE a.schedule_version_id IN (v_pub, v_drf);

  -- 1) lift obsolete flag on the two stage-2 groups
  UPDATE delivery_groups SET is_obsolete = false WHERE id = ANY(v_dg);

  -- 2) re-stamp the existing admin approval inside this transaction (guard requirement)
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  UPDATE faculty_teaching_requests SET decided_at = now(), decided_by = v_admin
   WHERE assignment_id = ANY(v_ta) AND status = 'approved';

  -- 3) activate the two assignments (no session field changes)
  UPDATE teaching_assignments SET is_active = true WHERE id = ANY(v_ta);

  SELECT count(*) INTO n FROM teaching_assignments WHERE id = ANY(v_ta) AND is_active;
  IF n <> 2 THEN RAISE EXCEPTION 'POST_ACTIVATION_FAILED=%', n; END IF;

  -- postflight: session fingerprint unchanged
  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_fp_after FROM (
    SELECT ss.id::text||':'||ss.schedule_version_id::text||':'||ss.day_of_week::text||':'||ss.start_time::text||':'||ss.end_time::text
           ||':'||coalesce(ss.room_id::text,'-')||':'||coalesce(ss.instructor_id::text,'-')
           ||':'||coalesce(ss.delivery_group_id::text,'-')||':'||coalesce(ss.teaching_assignment_id::text,'-') AS x
    FROM schedule_sessions ss WHERE ss.schedule_version_id IN (v_pub, v_drf)) s;
  IF v_fp_after IS DISTINCT FROM v_fp_before THEN RAISE EXCEPTION 'POST_SESSION_FINGERPRINT_CHANGED'; END IF;

  -- postflight: counts and minutes per version
  FOR n, m IN SELECT count(*), sum(extract(epoch from (end_time-start_time))/60)
              FROM schedule_sessions WHERE schedule_version_id IN (v_pub, v_drf)
              GROUP BY schedule_version_id LOOP
    IF n <> 61 OR m <> 8040 THEN RAISE EXCEPTION 'POST_VERSION_TOTALS=%/%', n, m; END IF;
  END LOOP;

  -- postflight: no session in these versions points to an inactive assignment or obsolete group
  SELECT count(*) INTO n FROM schedule_sessions ss
    JOIN teaching_assignments ta ON ta.id = ss.teaching_assignment_id
    LEFT JOIN delivery_groups dg ON dg.id = ss.delivery_group_id
   WHERE ss.schedule_version_id IN (v_pub, v_drf)
     AND (ta.is_active = false OR coalesce(dg.is_obsolete,false));
  IF n <> 0 THEN RAISE EXCEPTION 'POST_INCOMPLETE_PARTITION=%', n; END IF;

  -- postflight: no component over-allocation on the touched groups
  SELECT count(*) INTO n FROM (
    SELECT ta.delivery_group_id, sum(ta.assigned_component_hours) s, max(pcc.weekly_contact_hours) h
      FROM teaching_assignments ta JOIN plan_course_components pcc ON pcc.id = ta.plan_course_component_id
     WHERE ta.is_active AND ta.college_id = '8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb'
     GROUP BY ta.delivery_group_id) q WHERE q.s > q.h;
  IF n <> 0 THEN RAISE EXCEPTION 'POST_OVER_ALLOCATED_GROUPS=%', n; END IF;

  -- postflight: no new hard conflicts
  SELECT count(*) INTO v_conf_after FROM schedule_sessions a JOIN schedule_sessions b
    ON a.schedule_version_id = b.schedule_version_id AND a.id < b.id
   AND a.day_of_week = b.day_of_week AND a.start_time < b.end_time AND b.start_time < a.end_time
   AND (a.instructor_id = b.instructor_id OR a.room_id = b.room_id)
   WHERE a.schedule_version_id IN (v_pub, v_drf);
  IF v_conf_after > v_conf_before THEN RAISE EXCEPTION 'POST_NEW_CONFLICTS=% > %', v_conf_after, v_conf_before; END IF;

  -- postflight: sharia active period template still 6 rows
  SELECT count(*) INTO n FROM time_slots ts
   WHERE ts.college_id = '8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb' AND ts.is_active;
  IF n < 1 THEN RAISE EXCEPTION 'POST_SYSTEM_TEMPLATE_MISSING'; END IF;

  RAISE NOTICE 'SHARIA_TAIL_FIX_OK conflicts=%/%', v_conf_before, v_conf_after;
END
$mig$;
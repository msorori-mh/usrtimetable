DO $mig$
DECLARE
  v_college uuid := '8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb';
  v_pub uuid := '7a1c9b2e-5d34-4f18-9a6b-3c2f8e5d0001';
  v_draft uuid := '7d2ffbc4-fee3-4ffc-a2c8-4819e5429fe6';
  v_old uuid[] := ARRAY[
    '369cf17c-66c4-449b-a52b-39116aff81cc','3ad9b69b-a075-4d5a-a605-443571a76129',
    '5f5f4419-6013-42c9-852a-f9c075a2ef13','73fa5074-90f3-45f3-9668-2a3d8f620cad',
    '8235be81-2c08-4a9b-ad00-ca6dce3a591c','f55bcc2b-adad-44f7-a47e-4615a8e46b1d']::uuid[];
  v_cross uuid[] := ARRAY[
    '4d5bd3b8-144b-4e93-be38-83b5e5f7ed98','d7e9f5bd-72e2-4e29-8301-d450947ba7c5']::uuid[];
  v_dg uuid[] := ARRAY[
    'd2084ecc-adfa-47ec-986e-766b3e3b69c3','76733444-4d61-45a1-a1cc-d10505dd008e',
    '41e2fd2c-a49a-4370-8459-5567ec9c7cd6','9a9a5eca-b4e9-4f8f-a5b9-fdbc67fb83a5',
    'b4e064df-433b-433b-9d8e-96c906f095bf','0c17cb24-7d09-4860-8f96-cb1aed9d67e2']::uuid[];
  v_fp_before text; v_fp_after text; v_ta_fp_before text; v_ta_fp_after text;
  n int; m int; g int;
BEGIN
  PERFORM pg_advisory_xact_lock(9262, 10);

  SELECT count(*) INTO n FROM delivery_groups dg
   WHERE dg.id = ANY(v_dg) AND dg.college_id = v_college AND dg.group_number = 2
     AND dg.is_obsolete = true AND dg.active = true
     AND dg.cohort_id = 'dcc53b65-896e-4f7b-ad41-d815f9c97e09';
  IF n <> 6 THEN RAISE EXCEPTION 'PRE_GROUP_SHAPE:%', n; END IF;

  SELECT count(*) INTO n FROM teaching_assignments ta
   WHERE ta.id = ANY(v_old) AND ta.is_active = false AND ta.college_id = v_college
     AND ta.delivery_group_id = ANY(v_dg);
  IF n <> 6 THEN RAISE EXCEPTION 'PRE_ASSIGNMENT_SHAPE:%', n; END IF;

  -- each assignment owns exactly 2 sessions (one per version), group already matching
  SELECT count(*) INTO n FROM (
    SELECT s.teaching_assignment_id FROM schedule_sessions s
      JOIN teaching_assignments ta ON ta.id = s.teaching_assignment_id
     WHERE s.teaching_assignment_id = ANY(v_old)
       AND s.schedule_version_id IN (v_pub, v_draft)
       AND s.delivery_group_id = ta.delivery_group_id
     GROUP BY s.teaching_assignment_id
    HAVING count(*) = 2 AND count(DISTINCT s.schedule_version_id) = 2
  ) q;
  IF n <> 6 THEN RAISE EXCEPTION 'PRE_SESSION_SHAPE:%', n; END IF;

  -- instructors must be home-college faculty (no cross-college approval bypass)
  IF EXISTS (
    SELECT 1 FROM teaching_assignments ta
      JOIN faculty_identity_links l ON l.instructor_id = ta.instructor_id
      JOIN faculty_private.home_profiles hp ON hp.identity_id = l.identity_id
     WHERE ta.id = ANY(v_old) AND hp.home_college_id IS DISTINCT FROM v_college
  ) THEN RAISE EXCEPTION 'PRE_CROSS_COLLEGE_PRESENT'; END IF;

  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_fp_before FROM (
    SELECT concat_ws(';', s.id, s.schedule_version_id, s.day_of_week, s.start_time, s.end_time,
                     s.instructor_id, s.room_id, s.delivery_group_id, s.teaching_assignment_id) AS x
      FROM schedule_sessions s WHERE s.schedule_version_id IN (v_pub, v_draft)) t;
  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_ta_fp_before FROM (
    SELECT concat_ws(';', ta.id, ta.college_id, ta.course_offering_id, ta.instructor_id,
                     ta.section_number, ta.session_type, ta.weekly_hours, ta.required_room_type,
                     ta.cohort_id, ta.plan_course_component_id, ta.delivery_group_id,
                     ta.assigned_component_hours) AS x
      FROM teaching_assignments ta WHERE ta.id = ANY(v_old)) t;

  UPDATE delivery_groups SET is_obsolete = false WHERE id = ANY(v_dg);
  IF (SELECT count(*) FROM delivery_groups WHERE id = ANY(v_dg) AND is_obsolete = false) <> 6
  THEN RAISE EXCEPTION 'POST_GROUP_FLAG_FAILED'; END IF;

  UPDATE teaching_assignments SET is_active = true WHERE id = ANY(v_old);
  IF (SELECT count(*) FROM teaching_assignments WHERE id = ANY(v_old) AND is_active) <> 6
  THEN RAISE EXCEPTION 'POST_REACTIVATE_FAILED'; END IF;

  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_fp_after FROM (
    SELECT concat_ws(';', s.id, s.schedule_version_id, s.day_of_week, s.start_time, s.end_time,
                     s.instructor_id, s.room_id, s.delivery_group_id, s.teaching_assignment_id) AS x
      FROM schedule_sessions s WHERE s.schedule_version_id IN (v_pub, v_draft)) t;
  IF v_fp_after IS DISTINCT FROM v_fp_before THEN RAISE EXCEPTION 'POST_SESSION_FINGERPRINT_CHANGED'; END IF;

  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_ta_fp_after FROM (
    SELECT concat_ws(';', ta.id, ta.college_id, ta.course_offering_id, ta.instructor_id,
                     ta.section_number, ta.session_type, ta.weekly_hours, ta.required_room_type,
                     ta.cohort_id, ta.plan_course_component_id, ta.delivery_group_id,
                     ta.assigned_component_hours) AS x
      FROM teaching_assignments ta WHERE ta.id = ANY(v_old)) t;
  IF v_ta_fp_after IS DISTINCT FROM v_ta_fp_before THEN RAISE EXCEPTION 'POST_ASSIGNMENT_FIELDS_CHANGED'; END IF;

  FOR n, m, g IN
    SELECT count(*), coalesce(sum(EXTRACT(EPOCH FROM (end_time - start_time))/60),0)::int,
           count(DISTINCT delivery_group_id)
      FROM schedule_sessions WHERE schedule_version_id = v_pub
    UNION ALL
    SELECT count(*), coalesce(sum(EXTRACT(EPOCH FROM (end_time - start_time))/60),0)::int,
           count(DISTINCT delivery_group_id)
      FROM schedule_sessions WHERE schedule_version_id = v_draft
  LOOP
    IF n <> 61 OR m <> 8040 THEN RAISE EXCEPTION 'POST_VERSION_METRICS:%/%/%', n, m, g; END IF;
  END LOOP;

  -- only the two cross-college assignments may still be inactive (4 sessions)
  SELECT count(*) INTO n FROM schedule_sessions s
    JOIN teaching_assignments ta ON ta.id = s.teaching_assignment_id
   WHERE s.schedule_version_id IN (v_pub, v_draft) AND ta.is_active = false
     AND NOT (ta.id = ANY(v_cross));
  IF n <> 0 THEN RAISE EXCEPTION 'POST_UNEXPECTED_INACTIVE_REFS:%', n; END IF;

  IF (SELECT count(*) FROM time_slot_templates WHERE college_id = v_college AND is_active) <> 6
  THEN RAISE EXCEPTION 'POST_TEMPLATE_MISSING'; END IF;

  SELECT count(*) INTO n FROM (
    SELECT s.schedule_version_id, s.delivery_group_id,
           sum(EXTRACT(EPOCH FROM (s.end_time - s.start_time))/60) AS mins,
           max(ta.weekly_hours) * 60 AS allowed
      FROM schedule_sessions s JOIN teaching_assignments ta ON ta.id = s.teaching_assignment_id
     WHERE s.schedule_version_id IN (v_pub, v_draft)
     GROUP BY 1,2
  ) q WHERE mins > allowed;
  IF n <> 0 THEN RAISE EXCEPTION 'POST_OVER_HOURS:%', n; END IF;

  RAISE NOTICE 'SHARIA_SIX_FIX_OK';
END
$mig$;
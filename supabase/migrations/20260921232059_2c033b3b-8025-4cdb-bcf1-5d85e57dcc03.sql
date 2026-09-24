DO $mig$
DECLARE
  v_college uuid := '8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb';
  v_cohort uuid := 'dcc53b65-896e-4f7b-ad41-d815f9c97e09';
  v_pub uuid := '7a1c9b2e-5d34-4f18-9a6b-3c2f8e5d0001';
  v_draft uuid := '7d2ffbc4-fee3-4ffc-a2c8-4819e5429fe6';
  v_sessions_before text;
  v_sessions_after text;
  v_target_ids uuid[];
  v_count integer;
  v_minutes numeric;
  v_covered integer;
  v_required numeric;
  v_scheduled numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(9262, 92);

  SELECT array_agg(g.id ORDER BY g.id)
    INTO v_target_ids
  FROM public.delivery_groups g
  WHERE g.college_id = v_college
    AND g.cohort_id = v_cohort
    AND g.active
    AND NOT g.is_obsolete
    AND g.group_number IN (1, 2);

  IF coalesce(array_length(v_target_ids, 1), 0) <> 16 THEN
    RAISE EXCEPTION 'PREFLIGHT_TARGET_GROUP_COUNT=%', coalesce(array_length(v_target_ids, 1), 0);
  END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT g.plan_course_id, g.component_id,
           count(*) AS pair_count,
           count(*) FILTER (WHERE g.group_number = 1) AS first_count,
           count(*) FILTER (WHERE g.group_number = 2) AS second_count
    FROM public.delivery_groups g
    WHERE g.id = ANY(v_target_ids)
    GROUP BY g.plan_course_id, g.component_id
    HAVING count(*) <> 2
        OR count(*) FILTER (WHERE g.group_number = 1) <> 1
        OR count(*) FILTER (WHERE g.group_number = 2) <> 1
  ) bad_pairs;
  IF v_count <> 0 THEN RAISE EXCEPTION 'PREFLIGHT_ACADEMIC_PAIR_MISMATCH=%', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM public.shared_lecture_links l
  WHERE l.anchor_group_id = ANY(v_target_ids) OR l.member_group_id = ANY(v_target_ids);
  IF v_count <> 0 THEN RAISE EXCEPTION 'PREFLIGHT_UNEXPECTED_SHARED_LINKS=%', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT g.id, count(m.id) AS link_count,
           coalesce(sum(p.headcount) FILTER (WHERE p.active), 0) AS mapped_headcount,
           count(m.id) FILTER (WHERE p.active AND p.cohort_id = v_cohort AND m.cohort_id = v_cohort) AS valid_links
    FROM public.delivery_groups g
    LEFT JOIN public.delivery_group_partition_members m ON m.delivery_group_id = g.id
    LEFT JOIN public.cohort_student_partitions p ON p.id = m.partition_id
    WHERE g.id = ANY(v_target_ids)
    GROUP BY g.id
    HAVING count(m.id) <> 1
        OR coalesce(sum(p.headcount) FILTER (WHERE p.active), 0) <> 30
        OR count(m.id) FILTER (WHERE p.active AND p.cohort_id = v_cohort AND m.cohort_id = v_cohort) <> 1
  ) bad_membership;
  IF v_count <> 0 THEN RAISE EXCEPTION 'PREFLIGHT_PARTITION_MAPPING_MISMATCH=%', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM public.cohort_student_partitions p
  WHERE p.college_id = v_college AND p.cohort_id = v_cohort AND p.active
    AND p.partition_code IN ('A001', 'A002') AND p.headcount = 30;
  IF v_count <> 2 THEN RAISE EXCEPTION 'PREFLIGHT_30_30_PARTITIONS=%', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM public.schedule_sessions s
  WHERE s.schedule_version_id = v_draft AND s.delivery_group_id = ANY(v_target_ids);
  IF v_count <> 16 THEN RAISE EXCEPTION 'PREFLIGHT_DRAFT_TARGET_SESSIONS=%', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM public.schedule_sessions s
  WHERE s.schedule_version_id = v_pub AND s.delivery_group_id = ANY(v_target_ids);
  IF v_count <> 16 THEN RAISE EXCEPTION 'PREFLIGHT_PUBLISHED_TARGET_SESSIONS=%', v_count; END IF;

  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_sessions_before
  FROM (
    SELECT concat_ws(':', s.id, s.schedule_version_id, s.teaching_assignment_id,
      s.delivery_group_id, s.cohort_id, s.day_of_week, s.start_time, s.end_time,
      s.room_id, s.instructor_id, s.updated_at) AS x
    FROM public.schedule_sessions s
    WHERE s.schedule_version_id IN (v_pub, v_draft)
  ) q;

  UPDATE public.delivery_groups
  SET expected_students = 30
  WHERE id = ANY(v_target_ids)
    AND expected_students IS DISTINCT FROM 30;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 16 THEN RAISE EXCEPTION 'UPDATED_TARGET_GROUPS=%', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT g.id
    FROM public.delivery_groups g
    LEFT JOIN public.delivery_group_partition_members m ON m.delivery_group_id = g.id
    LEFT JOIN public.cohort_student_partitions p ON p.id = m.partition_id AND p.active
    WHERE g.id = ANY(v_target_ids)
    GROUP BY g.id, g.expected_students
    HAVING NOT (
      g.expected_students > 0
      AND count(DISTINCT m.partition_id) > 0
      AND coalesce(sum(p.headcount), 0) = g.expected_students
    )
  ) incomplete;
  IF v_count <> 0 THEN RAISE EXCEPTION 'POST_INCOMPLETE_TARGET_GROUPS=%', v_count; END IF;

  SELECT count(*) INTO v_count
  FROM (
    SELECT DISTINCT s.delivery_group_id
    FROM public.schedule_sessions s
    WHERE s.schedule_version_id IN (v_pub, v_draft)
  ) used
  JOIN public.delivery_groups g ON g.id = used.delivery_group_id
  LEFT JOIN public.delivery_group_partition_members m ON m.delivery_group_id = g.id
  LEFT JOIN public.cohort_student_partitions p ON p.id = m.partition_id AND p.active
  GROUP BY used.delivery_group_id, g.expected_students
  HAVING NOT (
    g.expected_students > 0
    AND count(DISTINCT m.partition_id) > 0
    AND coalesce(sum(p.headcount), 0) = g.expected_students
  );
  IF v_count <> 0 THEN RAISE EXCEPTION 'POST_INCOMPLETE_USED_GROUPS=%', v_count; END IF;

  SELECT md5(string_agg(x, '|' ORDER BY x)) INTO v_sessions_after
  FROM (
    SELECT concat_ws(':', s.id, s.schedule_version_id, s.teaching_assignment_id,
      s.delivery_group_id, s.cohort_id, s.day_of_week, s.start_time, s.end_time,
      s.room_id, s.instructor_id, s.updated_at) AS x
    FROM public.schedule_sessions s
    WHERE s.schedule_version_id IN (v_pub, v_draft)
  ) q;
  IF v_sessions_after IS DISTINCT FROM v_sessions_before THEN
    RAISE EXCEPTION 'POST_SCHEDULE_SESSIONS_CHANGED';
  END IF;

  FOR v_count, v_minutes, v_covered, v_required, v_scheduled IN
    WITH versions(id) AS (VALUES (v_pub), (v_draft)),
    session_totals AS (
      SELECT s.schedule_version_id, count(*)::integer AS session_count,
             sum(extract(epoch FROM (s.end_time - s.start_time)) / 60) AS minutes,
             count(DISTINCT s.delivery_group_id)::integer AS covered
      FROM public.schedule_sessions s
      WHERE s.schedule_version_id IN (v_pub, v_draft)
      GROUP BY s.schedule_version_id
    ),
    used_assignments AS (
      SELECT DISTINCT s.schedule_version_id, s.teaching_assignment_id
      FROM public.schedule_sessions s
      WHERE s.schedule_version_id IN (v_pub, v_draft)
    ),
    hours AS (
      SELECT u.schedule_version_id,
             sum(ta.weekly_hours) AS required,
             sum((SELECT coalesce(sum(extract(epoch FROM (s.end_time - s.start_time)) / 3600), 0)
                  FROM public.schedule_sessions s
                  WHERE s.schedule_version_id = u.schedule_version_id
                    AND s.teaching_assignment_id = u.teaching_assignment_id)) AS scheduled
      FROM used_assignments u
      JOIN public.teaching_assignments ta ON ta.id = u.teaching_assignment_id
      GROUP BY u.schedule_version_id
    )
    SELECT st.session_count, st.minutes, st.covered, h.required, h.scheduled
    FROM versions v
    JOIN session_totals st ON st.schedule_version_id = v.id
    JOIN hours h ON h.schedule_version_id = v.id
  LOOP
    IF v_count <> 61 OR v_minutes <> 8040 OR v_covered <> 61
       OR v_required <> 134 OR v_scheduled <> 134 THEN
      RAISE EXCEPTION 'POST_GATE_FAILED sessions=% minutes=% covered=% required=% scheduled=%',
        v_count, v_minutes, v_covered, v_required, v_scheduled;
    END IF;
  END LOOP;
END
$mig$;
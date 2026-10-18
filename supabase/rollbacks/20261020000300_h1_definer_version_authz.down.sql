-- Rollback for H-1 (d): restore the unguarded definitions (pre-20261020000300).

CREATE OR REPLACE FUNCTION public.version_effective_assignments(p_version uuid)
 RETURNS TABLE(assignment_id uuid, delivery_group_id uuid, college_id uuid, assigned_component_hours numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
 SELECT ta.id,ta.delivery_group_id,ta.college_id,ta.assigned_component_hours
 FROM public.teaching_assignments ta
 WHERE ta.is_active AND CASE
  WHEN EXISTS(SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id=ta.id) THEN
   EXISTS(SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id=ta.id AND s.version_id=p_version)
   OR EXISTS(SELECT 1 FROM public.schedule_sessions x WHERE x.schedule_version_id=p_version AND x.teaching_assignment_id=ta.id)
  ELSE NOT EXISTS(SELECT 1 FROM assignment_version_private.scope s
   WHERE s.replaces_assignment_id=ta.id AND (
    s.version_id=p_version OR (
     EXISTS(SELECT 1 FROM public.schedule_sessions x WHERE x.schedule_version_id=p_version AND x.teaching_assignment_id=s.assignment_id)
     AND NOT EXISTS(SELECT 1 FROM public.schedule_sessions x WHERE x.schedule_version_id=p_version AND x.teaching_assignment_id=ta.id))))
 END
$function$;

CREATE OR REPLACE FUNCTION public.schedule_version_session_snapshot(p_version uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id,
           s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id,
           s.cohort_id, s.schedule_version_id), E'\n' ORDER BY s.id), ''))
  FROM public.schedule_sessions s WHERE s.schedule_version_id = p_version
$function$;

CREATE OR REPLACE FUNCTION public.preview_version_session_moves(p_version uuid, p_manifest jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH m AS (SELECT (x->>'session_id')::uuid id, (x->>'day_of_week')::smallint d,
                    (x->>'start_time')::time st, (x->>'end_time')::time et, (x->>'room_id')::uuid r
             FROM jsonb_array_elements(p_manifest) x)
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id,
           coalesce(m.d, s.day_of_week), coalesce(m.st, s.start_time), coalesce(m.et, s.end_time),
           CASE WHEN m.id IS NULL THEN s.room_id ELSE m.r END, s.delivery_group_id,
           s.cohort_id, s.schedule_version_id), E'\n' ORDER BY s.id), ''))
  FROM public.schedule_sessions s LEFT JOIN m ON m.id = s.id
  WHERE s.schedule_version_id = p_version
$function$;

CREATE OR REPLACE FUNCTION public.version_scoped_publish_gate(p_version uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_exp record; v_over int := 0; g record; v_cov jsonb; v_col uuid; v_n int; v_miss int;
BEGIN
  SELECT college_id INTO v_col FROM public.schedule_versions WHERE id = p_version;
  SELECT * INTO v_exp FROM assignment_version_private.publish_expectation WHERE version_id = p_version;
  FOR g IN SELECT DISTINCT e.delivery_group_id, c.weekly_contact_hours AS h
           FROM public.version_effective_assignments(p_version) e
           JOIN public.teaching_assignments ta ON ta.id = e.assignment_id
           LEFT JOIN public.plan_course_components c ON c.id = ta.plan_course_component_id
           WHERE e.college_id = v_col LOOP
    BEGIN PERFORM public.validate_version_assignment_allocation(p_version, g.delivery_group_id, g.h);
    EXCEPTION WHEN check_violation THEN v_over := v_over + 1; END;
  END LOOP;
  v_cov := public.schedule_version_delivery_coverage(v_col, p_version);
  SELECT count(*), count(*) FILTER (WHERE instructor_id IS NULL OR room_id IS NULL)
    INTO v_n, v_miss FROM public.schedule_sessions WHERE schedule_version_id = p_version;
  RETURN jsonb_build_object('sealed', v_exp.version_id IS NOT NULL, 'sessions', v_n,
    'expected_sessions', v_exp.expected_sessions,
    'snapshot_matches', v_exp.expected_snapshot = public.schedule_version_session_snapshot(p_version),
    'missing_instructor_or_room', v_miss, 'over_allocated_groups', v_over,
    'coverage_complete', coalesce((v_cov->>'complete')::boolean, false),
    'multi_assigned_groups', (v_cov->>'multi_assigned_groups')::int,
    'ok', v_exp.version_id IS NOT NULL AND v_n = v_exp.expected_sessions
      AND v_exp.expected_snapshot = public.schedule_version_session_snapshot(p_version)
      AND v_miss = 0 AND v_over = 0 AND coalesce((v_cov->>'complete')::boolean, false));
END $function$;

CREATE OR REPLACE FUNCTION public.validate_version_assignment_allocation(p_version uuid, p_delivery_group_id uuid, p_component_hours numeric)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_count integer; v_nulls integer; v_sum numeric;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE e.assigned_component_hours IS NULL),
         coalesce(sum(e.assigned_component_hours), 0)
    INTO v_count, v_nulls, v_sum
  FROM public.version_effective_assignments(p_version) e
  WHERE e.delivery_group_id = p_delivery_group_id;
  IF v_count > 1 AND v_nulls > 0 THEN
    RAISE EXCEPTION 'VERSION_CO_TEACHING_HOURS_SPLIT_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF p_component_hours IS NOT NULL AND v_sum > p_component_hours THEN
    RAISE EXCEPTION 'VERSION_CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.itcs_cutover_path_rules(p_version uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ver public.schedule_versions%ROWTYPE; r jsonb;
BEGIN
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERSION_NOT_FOUND' USING ERRCODE = 'check_violation'; END IF;

  WITH su AS (SELECT * FROM public.itcs_cutover_session_units(p_version)),
  s AS (SELECT * FROM public.schedule_sessions WHERE schedule_version_id = p_version),
  shared_pair AS (SELECT NULL::uuid aid,NULL::uuid bid WHERE false),
  pu AS (SELECT * FROM su WHERE unit LIKE 'p:%'),   -- complete student paths only
  inc AS (SELECT * FROM su WHERE unit NOT LIKE 'p:%'), -- incomplete fallbacks (fail closed)
  unit_day AS (SELECT unit, day_of_week, count(DISTINCT session_id) n,
                      jsonb_agg(DISTINCT session_id) sids FROM pu GROUP BY 1, 2),
  stu_clash AS (
    SELECT a.unit, a.day_of_week, a.session_id aid, b.session_id bid FROM pu a JOIN pu b
      ON a.unit = b.unit AND a.session_id < b.session_id AND a.day_of_week = b.day_of_week
     AND a.start_time < b.end_time AND b.start_time < a.end_time
     WHERE NOT EXISTS (SELECT 1 FROM shared_pair p WHERE p.aid = a.session_id AND p.bid = b.session_id)),
  room_clash AS (
    SELECT a.id FROM s a JOIN s b ON a.id < b.id AND a.room_id = b.room_id
     AND a.day_of_week = b.day_of_week AND a.start_time < b.end_time AND b.start_time < a.end_time
     WHERE NOT EXISTS (SELECT 1 FROM shared_pair p WHERE p.aid = a.id AND p.bid = b.id)),
  inst_clash AS (
    SELECT a.id FROM s a JOIN s b ON a.id < b.id AND a.instructor_id = b.instructor_id
     AND a.day_of_week = b.day_of_week AND a.start_time < b.end_time AND b.start_time < a.end_time
     WHERE NOT EXISTS (SELECT 1 FROM shared_pair p WHERE p.aid = a.id AND p.bid = b.id)),
  xc AS (
    SELECT a.id FROM s a
      JOIN public.schedule_sessions b ON b.instructor_id = a.instructor_id AND b.schedule_version_id <> p_version
      JOIN public.schedule_versions vb ON vb.id = b.schedule_version_id AND vb.status = 'published'
       AND vb.college_id <> v_ver.college_id
      JOIN public.academic_terms ta ON ta.id = v_ver.academic_term_id
      JOIN public.academic_terms tb ON tb.id = vb.academic_term_id
       AND ta.start_date <= tb.end_date AND tb.start_date <= ta.end_date
     WHERE a.day_of_week = b.day_of_week AND a.start_time < b.end_time AND b.start_time < a.end_time
       AND NOT EXISTS (SELECT 1 FROM public.schedule_version_conflict_exceptions e
                        WHERE e.schedule_version_id = p_version AND e.status = 'approved'
                          AND e.session_id = a.id
                          AND e.approval_type='cross_college_instructor'
                          AND e.conflict_code IN ('instructor_conflict','cross_college_instructor_conflict')
                          AND (e.related_session_id=b.id OR (e.related_session_id IS NULL
                            AND e.metadata->>'external_session_id'=b.id::text
                            AND (e.metadata->>'day_of_week')::int=a.day_of_week
                            AND (e.metadata->>'target_start')::time=a.start_time
                            AND (e.metadata->>'target_end')::time=a.end_time)))),
  -- Rev6 availability policy (matches _ss_iavail_*): an explicit non-preference
  -- 'unavailable' row always rejects an overlapping session; positive windows are
  -- enforced only when the instructor has at least one positive row. An
  -- unrelated unavailable day never implies positive rows are required elsewhere.
  win AS (
    SELECT s.id, s.instructor_id, s.day_of_week, s.start_time, s.end_time,
           CASE WHEN EXISTS (SELECT 1 FROM public.instructor_availability ia
                              WHERE ia.instructor_id = s.instructor_id AND NOT coalesce(ia.is_preference, false)
                                AND ia.availability_type = 'unavailable' AND ia.day_of_week = s.day_of_week
                                AND ia.start_time < s.end_time AND s.start_time < ia.end_time)
                THEN 'explicit_unavailable' ELSE 'outside_positive_window' END reason
      FROM s WHERE s.instructor_id IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.instructor_availability ia
                WHERE ia.instructor_id = s.instructor_id AND NOT coalesce(ia.is_preference, false)
                  AND ia.availability_type = 'unavailable' AND ia.day_of_week = s.day_of_week
                  AND ia.start_time < s.end_time AND s.start_time < ia.end_time)
       OR (EXISTS (SELECT 1 FROM public.instructor_availability ia
                    WHERE ia.instructor_id = s.instructor_id AND NOT coalesce(ia.is_preference, false)
                      AND ia.availability_type <> 'unavailable')
           AND NOT EXISTS (SELECT 1 FROM public.instructor_availability ia
                    WHERE ia.instructor_id = s.instructor_id AND NOT coalesce(ia.is_preference, false)
                      AND ia.availability_type <> 'unavailable' AND ia.day_of_week = s.day_of_week
                      AND ia.start_time <= s.start_time AND ia.end_time >= s.end_time)))),
  over4 AS (SELECT unit, count(*) days, jsonb_agg(day_of_week ORDER BY day_of_week) day_list
              FROM unit_day GROUP BY unit HAVING count(*) > 4)
  SELECT jsonb_build_object(
    'sessions', (SELECT count(*) FROM s),
    'student_units', (SELECT count(DISTINCT unit) FROM pu),
    'unmapped_group_units', (SELECT count(DISTINCT unit) FROM inc WHERE unit LIKE 'g:%'),
    'cohort_fallback_units', (SELECT count(DISTINCT unit) FROM inc WHERE unit LIKE 'c:%'),
    'incomplete_path_detail', (SELECT coalesce(jsonb_agg(jsonb_build_object('unit', unit, 'sessions', sids)), '[]')
       FROM (SELECT unit, jsonb_agg(DISTINCT session_id) sids FROM inc GROUP BY unit) z),
    'sessions_without_units', (SELECT count(*) FROM s WHERE NOT EXISTS (SELECT 1 FROM su WHERE su.session_id = s.id)),
    'student_over_4_days', (SELECT count(*) FROM over4),
    'student_over_4_days_detail', (SELECT coalesce(jsonb_agg(jsonb_build_object('unit', unit, 'days', day_list)), '[]') FROM over4),
    'single_lecture_days', (SELECT count(*) FROM unit_day WHERE n = 1),
    'single_lecture_days_detail', (SELECT coalesce(jsonb_agg(jsonb_build_object('unit', unit, 'day', day_of_week, 'sessions', sids)), '[]')
       FROM unit_day WHERE n = 1),
    'student_clashes', (SELECT count(DISTINCT (aid, bid)) FROM stu_clash),
    'student_clash_detail', (SELECT coalesce(jsonb_agg(jsonb_build_object('unit', unit, 'day', day_of_week, 'a', aid, 'b', bid)), '[]') FROM stu_clash),
    'theory_outside_08_14', (SELECT count(*) FROM s WHERE coalesce(session_type, 'lecture') NOT ILIKE '%lab%'
                               AND coalesce(session_type, '') NOT ILIKE '%practical%'
                               AND (start_time < '08:00' OR end_time > '14:00')),
    'lab_outside_08_16', (SELECT count(*) FROM s WHERE (session_type ILIKE '%lab%' OR session_type ILIKE '%practical%')
                               AND (start_time < '08:00' OR end_time > '16:00')),
    'room_clashes', (SELECT count(*) FROM room_clash),
    'instructor_clashes', (SELECT count(*) FROM inst_clash),
    'cross_college_clashes', (SELECT count(*) FROM xc),
    'instructor_window_violations', (SELECT count(*) FROM win),
    'instructor_window_detail', (SELECT coalesce(jsonb_agg(jsonb_build_object('session', id, 'instructor', instructor_id,
       'day', day_of_week, 'start', start_time, 'end', end_time, 'reason', reason)), '[]') FROM win)) INTO r;

  RETURN r || jsonb_build_object('ok',
    (r->>'sessions_without_units')::int + (r->>'unmapped_group_units')::int + (r->>'cohort_fallback_units')::int
    + (r->>'student_over_4_days')::int + (r->>'single_lecture_days')::int
    + (r->>'student_clashes')::int + (r->>'theory_outside_08_14')::int + (r->>'lab_outside_08_16')::int
    + (r->>'room_clashes')::int + (r->>'instructor_clashes')::int + (r->>'cross_college_clashes')::int
    + (r->>'instructor_window_violations')::int = 0);
END $function$;

DROP FUNCTION IF EXISTS security_private.assert_version_reader(uuid, boolean);
DROP FUNCTION IF EXISTS security_private.caller_is_trusted();
DROP SCHEMA IF EXISTS security_private;

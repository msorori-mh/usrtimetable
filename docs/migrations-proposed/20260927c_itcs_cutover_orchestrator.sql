-- PROPOSED (Rev4) — NOT APPLIED. Requires Rev2 (20260927_itcs_version_scoped_assignments.sql)
-- and Rev3.1 (20260927b_itcs_version_scoped_workload_guards.sql) first.
-- ITCS cutover orchestrator: one Super-Admin RPC that, inside ONE transaction,
-- verifies the manifest (CAS), applies scoped replacements, moves sessions,
-- re-checks independent path rules, seals, runs the quality snapshot and walks
-- draft -> review -> approved -> published through transition_schedule_version.
-- It never approves cross-college requests: those must already be approved by
-- the home college through decide_faculty_teaching_request (auth.uid there).
-- No trigger is disabled; every live guard fires on the ordinary UPDATEs.

BEGIN;

CREATE SCHEMA IF NOT EXISTS itcs_cutover_private;
REVOKE ALL ON SCHEMA itcs_cutover_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS itcs_cutover_private.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL,
  manifest_sha text NOT NULL,
  stage text NOT NULL,
  result jsonb NOT NULL,
  actor uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, manifest_sha, stage)
);
REVOKE ALL ON itcs_cutover_private.runs FROM PUBLIC;

-- Independent path rules (not the scheduler's own logic):
--   students: <= 4 distinct days per cohort/group, no day with exactly one lecture
--   theory/tutorial within 08:00-14:00, labs within 08:00-16:00
--   instructors: sessions inside their availability windows / days
--   room, instructor and student-group clashes inside the version
--   cross-college instructor clashes against every other current published/draft
--   version of an overlapping term (archived excluded).
CREATE OR REPLACE FUNCTION public.itcs_cutover_path_rules(p_version uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ver public.schedule_versions%ROWTYPE; r jsonb := '{}';
  v_days int; v_single int; v_theory int; v_lab int; v_room int; v_inst int; v_grp int;
  v_xc int; v_win int;
BEGIN
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERSION_NOT_FOUND' USING ERRCODE = 'check_violation'; END IF;

  WITH d AS (SELECT coalesce(delivery_group_id, cohort_id) g, day_of_week, count(*) n
             FROM public.schedule_sessions WHERE schedule_version_id = p_version
             GROUP BY 1, 2)
  SELECT count(DISTINCT g) FILTER (WHERE g IN (SELECT g FROM d GROUP BY g HAVING count(*) > 4)),
         count(*) FILTER (WHERE n = 1)
    INTO v_days, v_single FROM d;

  SELECT count(*) FILTER (WHERE coalesce(session_type, 'lecture') NOT ILIKE '%lab%'
                            AND (start_time < '08:00' OR end_time > '14:00')),
         count(*) FILTER (WHERE session_type ILIKE '%lab%' AND (start_time < '08:00' OR end_time > '16:00'))
    INTO v_theory, v_lab FROM public.schedule_sessions WHERE schedule_version_id = p_version;

  SELECT count(*) INTO v_room FROM public.schedule_sessions a JOIN public.schedule_sessions b
    ON a.schedule_version_id = b.schedule_version_id AND a.id < b.id AND a.room_id = b.room_id
   AND a.day_of_week = b.day_of_week AND a.start_time < b.end_time AND b.start_time < a.end_time
   WHERE a.schedule_version_id = p_version;
  SELECT count(*) INTO v_inst FROM public.schedule_sessions a JOIN public.schedule_sessions b
    ON a.schedule_version_id = b.schedule_version_id AND a.id < b.id AND a.instructor_id = b.instructor_id
   AND a.day_of_week = b.day_of_week AND a.start_time < b.end_time AND b.start_time < a.end_time
   WHERE a.schedule_version_id = p_version
     AND NOT (a.delivery_group_id IS NOT NULL AND b.delivery_group_id IN
              (SELECT group_id FROM public.shared_lecture_group_ids(a.delivery_group_id)));
  SELECT count(*) INTO v_grp FROM public.schedule_sessions a JOIN public.schedule_sessions b
    ON a.schedule_version_id = b.schedule_version_id AND a.id < b.id
   AND a.delivery_group_id IS NOT NULL AND public.delivery_groups_share_students(a.delivery_group_id, b.delivery_group_id)
   AND a.day_of_week = b.day_of_week AND a.start_time < b.end_time AND b.start_time < a.end_time
   WHERE a.schedule_version_id = p_version;

  SELECT count(*) INTO v_xc FROM public.schedule_sessions a
   JOIN public.schedule_sessions b ON b.instructor_id = a.instructor_id AND b.schedule_version_id <> a.schedule_version_id
   JOIN public.schedule_versions vb ON vb.id = b.schedule_version_id AND vb.status IN ('published')
    AND vb.college_id <> v_ver.college_id
   JOIN public.academic_terms ta ON ta.id = v_ver.academic_term_id
   JOIN public.academic_terms tb ON tb.id = vb.academic_term_id
    AND ta.start_date <= tb.end_date AND tb.start_date <= ta.end_date
   WHERE a.schedule_version_id = p_version AND a.day_of_week = b.day_of_week
     AND a.start_time < b.end_time AND b.start_time < a.end_time
     AND NOT EXISTS (SELECT 1 FROM public.schedule_version_conflict_exceptions e
                     WHERE e.schedule_version_id = p_version AND e.status = 'approved'
                       AND e.session_id = a.id AND e.related_session_id = b.id);

  SELECT count(*) INTO v_win FROM public.schedule_sessions s
   WHERE s.schedule_version_id = p_version AND s.instructor_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.instructor_availability ia WHERE ia.instructor_id = s.instructor_id)
     AND NOT EXISTS (SELECT 1 FROM public.instructor_availability ia
                     WHERE ia.instructor_id = s.instructor_id AND ia.availability_type <> 'unavailable' AND ia.day_of_week = s.day_of_week
                       AND ia.start_time <= s.start_time AND ia.end_time >= s.end_time);

  r := jsonb_build_object('student_over_4_days', v_days, 'single_lecture_days', v_single,
    'theory_outside_08_14', v_theory, 'lab_outside_08_16', v_lab, 'room_clashes', v_room,
    'instructor_clashes', v_inst, 'student_clashes', v_grp, 'cross_college_clashes', v_xc,
    'instructor_window_violations', v_win);
  RETURN r || jsonb_build_object('ok',
    v_days + v_single + v_theory + v_lab + v_room + v_inst + v_grp + v_xc + v_win = 0);
END $$;

-- Read-only preview for the UI. Super Admin only.
CREATE OR REPLACE FUNCTION public.itcs_cutover_preview(p_version uuid, p_manifest jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_ver public.schedule_versions%ROWTYPE; v_missing int; v_drift int;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_version;
  IF NOT FOUND OR v_ver.status <> 'draft' THEN
    RAISE EXCEPTION 'VERSION_NOT_DRAFT' USING ERRCODE = 'check_violation'; END IF;
  WITH m AS (SELECT x FROM jsonb_array_elements(p_manifest->'sessions') x)
  SELECT count(*) FILTER (WHERE s.id IS NULL),
         count(*) FILTER (WHERE s.id IS NOT NULL AND (
            s.day_of_week <> (x->'old'->>'day_of_week')::smallint OR s.start_time <> (x->'old'->>'start_time')::time
            OR s.end_time <> (x->'old'->>'end_time')::time OR s.room_id IS DISTINCT FROM (x->'old'->>'room_id')::uuid
            OR s.instructor_id IS DISTINCT FROM (x->'old'->>'instructor_id')::uuid
            OR s.teaching_assignment_id IS DISTINCT FROM (x->'old'->>'teaching_assignment_id')::uuid))
    INTO v_missing, v_drift
    FROM m LEFT JOIN public.schedule_sessions s ON s.id = (x->>'session_id')::uuid AND s.schedule_version_id = p_version;
  RETURN jsonb_build_object('sessions_live', (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id = p_version),
    'sessions_manifest', jsonb_array_length(p_manifest->'sessions'), 'missing', v_missing, 'drift', v_drift,
    'before_snapshot', public.schedule_version_session_snapshot(p_version),
    'path_rules_current', public.itcs_cutover_path_rules(p_version),
    'pending_cross_college', (SELECT count(*) FROM jsonb_array_elements(p_manifest->'replacements') x
       WHERE (x->>'cross_college')::boolean AND NOT EXISTS (
         SELECT 1 FROM public.faculty_teaching_requests r WHERE r.id = (x->>'request_id')::uuid
           AND r.status = 'approved' AND r.instructor_id = (x->>'instructor')::uuid))));
END $$;

-- Execute. Any RAISE rolls back the whole cutover (single statement = single transaction).
CREATE OR REPLACE FUNCTION public.itcs_cutover_execute(
  p_version uuid, p_published uuid, p_manifest jsonb, p_manifest_sha text,
  p_expected_before text, p_expected_after text, p_expected_published_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_ver public.schedule_versions%ROWTYPE; v_pub public.schedule_versions%ROWTYPE;
  v_prev jsonb; v_moves jsonb; v_repl jsonb; v_rules jsonb; v_gate jsonb; v_q jsonb; v_n int; v_untouched_snap text;
  v_repl_ids uuid[]; x jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF md5(p_manifest::text) <> p_manifest_sha THEN
    RAISE EXCEPTION 'MANIFEST_HASH_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_version FOR UPDATE;
  SELECT * INTO v_pub FROM public.schedule_versions WHERE id = p_published FOR SHARE;
  IF v_ver.status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'VERSION_NOT_DRAFT' USING ERRCODE = 'check_violation'; END IF;
  IF v_pub.status IS DISTINCT FROM 'published' OR v_pub.college_id <> v_ver.college_id OR v_pub.academic_term_id <> v_ver.academic_term_id THEN
    RAISE EXCEPTION 'PUBLISHED_BASELINE_INVALID' USING ERRCODE = 'check_violation'; END IF;
  IF (p_manifest->>'draft_version_id')::uuid <> p_version OR (p_manifest->>'published_version_id')::uuid <> p_published
     OR (p_manifest->>'term_id')::uuid <> v_ver.academic_term_id OR (p_manifest->>'college_id')::uuid <> v_ver.college_id THEN
    RAISE EXCEPTION 'MANIFEST_IDENTITY_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  IF public.schedule_version_session_snapshot(p_published) <> p_expected_published_snapshot THEN
    RAISE EXCEPTION 'PUBLISHED_SNAPSHOT_DRIFT' USING ERRCODE = 'check_violation'; END IF;

  v_prev := public.itcs_cutover_preview(p_version, p_manifest);
  IF (v_prev->>'missing')::int <> 0 OR (v_prev->>'drift')::int <> 0
     OR (v_prev->>'sessions_live')::int <> (v_prev->>'sessions_manifest')::int THEN
    RAISE EXCEPTION 'MANIFEST_LIVE_MISMATCH: %', v_prev USING ERRCODE = 'check_violation'; END IF;
  IF (v_prev->>'pending_cross_college')::int <> 0 THEN
    RAISE EXCEPTION 'CROSS_COLLEGE_APPROVAL_PENDING' USING ERRCODE = 'check_violation'; END IF;
  IF p_expected_before <> v_prev->>'before_snapshot' THEN
    RAISE EXCEPTION 'MOVE_BEFORE_SNAPSHOT_MISMATCH' USING ERRCODE = 'check_violation'; END IF;

  -- 1) scoped replacements (same-college create; cross-college consume approved request via Rev2 path)
  SELECT array_agg((r->>'replaces')::uuid) INTO v_repl_ids FROM jsonb_array_elements(p_manifest->'replacements') r;
  SELECT count(*), md5(coalesce(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id,
      s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id), E'\n' ORDER BY s.id), ''))
    INTO v_n, v_untouched_snap FROM public.schedule_sessions s
   WHERE s.schedule_version_id = p_version AND NOT (s.teaching_assignment_id = ANY (coalesce(v_repl_ids, '{}')));
  v_repl := public.apply_version_scoped_replacements(p_version, p_manifest->'replacements', v_n, v_untouched_snap);

  -- 2) moves (272 changed placements; CAS before/after inside Rev2)
  SELECT coalesce(jsonb_agg(jsonb_build_object('session_id', x->>'session_id') || (x->'new')), '[]')
    INTO v_moves FROM jsonb_array_elements(p_manifest->'sessions') x WHERE (x->>'changed')::boolean;
  v_moves := public.apply_version_session_moves(p_version, v_moves, jsonb_array_length(v_moves),
    public.schedule_version_session_snapshot(p_version), p_expected_after);

  -- 3) independent path rules, seal, gate, exact quality
  v_rules := public.itcs_cutover_path_rules(p_version);
  IF NOT (v_rules->>'ok')::boolean THEN RAISE EXCEPTION 'PATH_RULES_FAILED: %', v_rules USING ERRCODE = 'check_violation'; END IF;
  PERFORM public.seal_version_publish_expectation(p_version, (v_prev->>'sessions_manifest')::int, p_expected_after);
  v_gate := public.version_scoped_publish_gate(p_version);
  IF NOT (v_gate->>'ok')::boolean THEN RAISE EXCEPTION 'PUBLISH_GATE_FAILED: %', v_gate USING ERRCODE = 'check_violation'; END IF;
  v_q := public.begin_schedule_quality_snapshot(v_ver.college_id, p_version);

  -- 4) official lifecycle (each call enforces its own guards incl. current quality revision)
  PERFORM public.transition_schedule_version(v_ver.college_id, p_version, 'draft', 'review', 'ITCS cutover ' || p_manifest_sha);
  PERFORM public.transition_schedule_version(v_ver.college_id, p_version, 'review', 'approved', 'ITCS cutover ' || p_manifest_sha);
  PERFORM public.transition_schedule_version(v_ver.college_id, p_version, 'approved', 'published', 'ITCS cutover ' || p_manifest_sha);

  -- 5) historical published version must be byte-identical
  IF public.schedule_version_session_snapshot(p_published) <> p_expected_published_snapshot THEN
    RAISE EXCEPTION 'PUBLISHED_HISTORY_CHANGED' USING ERRCODE = 'check_violation'; END IF;

  INSERT INTO itcs_cutover_private.runs(version_id, manifest_sha, stage, result, actor)
  VALUES (p_version, p_manifest_sha, 'published', jsonb_build_object('replacements', v_repl, 'moves', v_moves,
          'rules', v_rules, 'gate', v_gate, 'quality', v_q), v_uid);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'itcs_cutover_published', 'schedule_versions', p_version, v_ver.college_id,
          jsonb_build_object('manifest_sha', p_manifest_sha, 'previous_published', p_published,
                             'moved', v_moves->'moved', 'rules', v_rules, 'gate', v_gate));
  RETURN jsonb_build_object('ok', true, 'moves', v_moves, 'replacements', v_repl, 'rules', v_rules, 'gate', v_gate, 'quality', v_q);
END $$;

REVOKE ALL ON FUNCTION public.itcs_cutover_path_rules(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.itcs_cutover_preview(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.itcs_cutover_execute(uuid, uuid, jsonb, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.itcs_cutover_path_rules(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.itcs_cutover_preview(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.itcs_cutover_execute(uuid, uuid, jsonb, text, text, text, text) TO authenticated;

COMMIT;

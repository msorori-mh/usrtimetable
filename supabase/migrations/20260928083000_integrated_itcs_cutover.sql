-- Production cutover for the exact reviewed 2026-09-28 manifest. Requires Rev2 (20260927_itcs_version_scoped_assignments.sql)
-- and Rev3.1 (20260927b_itcs_version_scoped_workload_guards.sql) first.
--
-- ITCS cutover orchestrator, staged and idempotent. Nothing here disables a
-- trigger, bypasses RLS, or approves a cross-college request.
--
--   stage 'requests' : CAS the manifest against the exact 282 live sessions and
--                      submit ONE version-scoped request per cross-college
--                      replacement (submit_version_scoped_teaching_request).
--                      Existing scoped requests are reused, never duplicated.
--                      A generic (non version-scoped) approval is NOT proof.
--   (home colleges decide with decide_faculty_teaching_request; that decision
--    itself creates the scoped assignment and relinks the draft sessions.)
--   stage 'apply'    : verify every cross-college replacement is already an
--                      approved, version-scoped, relinked assignment; call the
--                      replacement writer ONLY for internal replacements; apply
--                      the 279 moves with CAS; verify every session equals the
--                      manifest target; run independent path rules; seal.
--                      Draft stays draft.
--   (client runs the official quality pipeline scoreScheduleVersion ->
--    begin_schedule_quality_snapshot + persist_schedule_quality_run.)
--   stage 'publish'  : require a persisted quality run at the CURRENT
--                      eligibility revision with 0 unapproved hard conflicts,
--                      the seal, coverage and path rules; then
--                      draft->review->approved->published and archive the prior
--                      published version, all via transition_schedule_version,
--                      verifying all 556 historical sessions are byte-identical and that
--                      exactly one version is published for college/term.
--
-- Manifest (itcs_cutover_manifest_2026-09-28.json):
--   { term_id, draft_version_id, published_version_id,
--     sessions[282]: { session_id, changed, session_type,
--        old{day,start,end,room,instructor,teaching_assignment_id}, new{day,start,end,room} },
--     replacements[8]: { replaces, instructor, hours, cross_college, request_id } }

BEGIN;

CREATE SCHEMA IF NOT EXISTS itcs_cutover_private;
REVOKE ALL ON SCHEMA itcs_cutover_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS itcs_cutover_private.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL,
  manifest_sha text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('requests','applied','published')),
  result jsonb NOT NULL,
  actor uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, manifest_sha, stage)
);
REVOKE ALL ON itcs_cutover_private.runs FROM PUBLIC;

DROP FUNCTION IF EXISTS public.itcs_cutover_execute(uuid, uuid, jsonb, text, text, text);

-- ---------------------------------------------------------------------------
-- Student path units. A session reaches every active cohort partition that is a
-- member of its delivery group or of any group linked to it as a shared (common)
-- lecture. Groups without partition mapping fall back to the group itself;
-- sessions without a delivery group fall back to the cohort. The number of
-- such fallbacks is reported (unmapped_*), never silently treated as clashes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.itcs_cutover_session_units(p_version uuid)
RETURNS TABLE (session_id uuid, unit text, day_of_week smallint, start_time time, end_time time)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  WITH s AS MATERIALIZED (SELECT * FROM public.schedule_sessions WHERE schedule_version_id=p_version),
  batches AS (
    SELECT array_agg(gid ORDER BY gid) gids FROM (
      SELECT gid,(row_number() OVER(ORDER BY gid)-1)/100 batch
      FROM (SELECT DISTINCT delivery_group_id gid FROM s WHERE delivery_group_id IS NOT NULL) g
    ) numbered GROUP BY batch),
  memberships AS MATERIALIZED (
    SELECT DISTINCT m.delivery_group_id,m.cohort_id,m.partition_id
    FROM batches b CROSS JOIN LATERAL public.schedule_version_student_memberships(p_version,b.gids) m)
  SELECT DISTINCT s.id,
    CASE WHEN m.partition_id IS NOT NULL THEN 'p:'||m.partition_id
      WHEN s.delivery_group_id IS NOT NULL THEN 'g:'||s.delivery_group_id
      ELSE 'c:'||coalesce(s.cohort_id::text,'missing') END,
    s.day_of_week,s.start_time,s.end_time
  FROM s LEFT JOIN memberships m ON m.delivery_group_id=s.delivery_group_id;
END $$;

-- Independent path rules (not the scheduler's own logic):
--   students (per partition unit): <= 4 distinct days, no day with exactly one
--     session, no two distinct overlapping sessions (a common lecture is ONE
--     session reaching several units, so it never clashes with itself)
--   theory/tutorial 08:00-14:00, labs 08:00-16:00
--   room / instructor clashes inside the version, excluding pairs that belong to
--     the same shared-lecture link (same common lecture held jointly)
--   instructor availability windows
--   cross-college instructor clashes vs published versions of overlapping terms
--     (archived excluded), minus approved version-scoped exceptions
CREATE OR REPLACE FUNCTION public.itcs_cutover_path_rules(p_version uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

CREATE OR REPLACE FUNCTION public.itcs_cutover_published_snapshot(p_published uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501'; END IF;
  RETURN public.schedule_version_session_snapshot(p_published);
END $$;

-- Per-replacement status (internal / cross-college scoped request / applied).
CREATE OR REPLACE FUNCTION itcs_cutover_private.replacement_status(p_version uuid, p_manifest jsonb)
RETURNS TABLE (replaces uuid, instructor uuid, hours numeric, cross_college boolean,
               manifest_request uuid, scoped_request uuid, request_status text,
               scoped_assignment uuid, relinked boolean, state text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT x.replaces, x.instructor, x.hours, x.cross_college, x.request_id,
         rs.request_id, fr.status, sc.assignment_id,
         (sc.assignment_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.schedule_sessions s
                           WHERE s.schedule_version_id = p_version AND s.teaching_assignment_id = x.replaces)),
         CASE
           WHEN sc.assignment_id IS NOT NULL AND ta.instructor_id = x.instructor AND ta.is_active
                AND ta.delivery_group_id = old.delivery_group_id
                AND (NOT x.cross_college OR (fr.status = 'approved' AND fr.assignment_id = sc.assignment_id
                     AND fr.delivery_group_id = old.delivery_group_id AND fr.instructor_id = x.instructor))
             THEN 'applied'
           WHEN sc.assignment_id IS NOT NULL THEN 'scoped_mismatch'
           WHEN NOT x.cross_college THEN 'internal_pending'
           WHEN rs.request_id IS NULL THEN 'request_missing'
           WHEN fr.status = 'pending' THEN 'awaiting_home_decision'
           ELSE 'request_' || coalesce(fr.status, 'unknown')
         END
    FROM jsonb_to_recordset(p_manifest->'replacements')
         AS x(replaces uuid, instructor uuid, hours numeric, cross_college boolean, request_id uuid)
    LEFT JOIN public.teaching_assignments old ON old.id = x.replaces
    LEFT JOIN assignment_version_private.scope sc ON sc.version_id = p_version AND sc.replaces_assignment_id = x.replaces
    LEFT JOIN public.teaching_assignments ta ON ta.id = sc.assignment_id
    LEFT JOIN assignment_version_private.request_scope rs ON rs.version_id = p_version AND rs.replaces_assignment_id = x.replaces
    LEFT JOIN public.faculty_teaching_requests fr ON fr.id = coalesce(sc.request_id, rs.request_id)
$$;

-- Read-only preview. CAS of manifest.old against the exact live draft. For a
-- replacement already applied (scoped), the live row must carry the scoped
-- assignment and new instructor with unchanged placement.
CREATE OR REPLACE FUNCTION public.itcs_cutover_preview(p_version uuid, p_manifest jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_ver public.schedule_versions%ROWTYPE;
  v_missing int; v_drift int; v_at_target int; v_extra int; v_repl jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_super_admin(v_uid) THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_version;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERSION_NOT_FOUND' USING ERRCODE = 'check_violation'; END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(z)), '[]') INTO v_repl
    FROM itcs_cutover_private.replacement_status(p_version, p_manifest) z;

  WITH m AS (
    SELECT (x->>'session_id')::uuid sid,
           (x->'old'->>'day')::smallint od, (x->'old'->>'start')::time ost, (x->'old'->>'end')::time oet,
           nullif(x->'old'->>'room', '')::uuid orm, nullif(x->'old'->>'instructor', '')::uuid oi,
           nullif(x->'old'->>'teaching_assignment_id', '')::uuid ota,
           (x->'new'->>'day')::smallint nd, (x->'new'->>'start')::time nst, (x->'new'->>'end')::time net,
           nullif(x->'new'->>'room', '')::uuid nrm
      FROM jsonb_array_elements(p_manifest->'sessions') x),
  exp AS (   -- expected assignment/instructor given replacement state
    SELECT m.*, coalesce(sc.assignment_id, m.ota) eta,
           CASE WHEN sc.assignment_id IS NOT NULL THEN ta.instructor_id ELSE m.oi END ei
      FROM m LEFT JOIN assignment_version_private.scope sc
             ON sc.version_id = p_version AND sc.replaces_assignment_id = m.ota
           LEFT JOIN public.teaching_assignments ta ON ta.id = sc.assignment_id)
  SELECT count(*) FILTER (WHERE s.id IS NULL),
         count(*) FILTER (WHERE s.id IS NOT NULL AND NOT (
             s.teaching_assignment_id IS NOT DISTINCT FROM e.eta AND s.instructor_id IS NOT DISTINCT FROM e.ei
             AND ((s.day_of_week = e.od AND s.start_time = e.ost AND s.end_time = e.oet AND s.room_id IS NOT DISTINCT FROM e.orm)
               OR (s.day_of_week = e.nd AND s.start_time = e.nst AND s.end_time = e.net AND s.room_id IS NOT DISTINCT FROM e.nrm)))),
         count(*) FILTER (WHERE s.id IS NOT NULL AND s.day_of_week = e.nd AND s.start_time = e.nst
             AND s.end_time = e.net AND s.room_id IS NOT DISTINCT FROM e.nrm)
    INTO v_missing, v_drift, v_at_target
    FROM exp e LEFT JOIN public.schedule_sessions s ON s.id = e.sid AND s.schedule_version_id = p_version;

  SELECT count(*) INTO v_extra FROM public.schedule_sessions s
   WHERE s.schedule_version_id = p_version
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_manifest->'sessions') x
                      WHERE (x->>'session_id')::uuid = s.id);

  RETURN jsonb_build_object(
    'version_status', v_ver.status,
    'manifest_sha', md5(p_manifest::text),
    'identity_ok', (p_manifest->>'draft_version_id')::uuid = p_version
                   AND (p_manifest->>'term_id')::uuid = v_ver.academic_term_id,
    'sessions_live', (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id = p_version),
    'sessions_manifest', jsonb_array_length(p_manifest->'sessions'),
    'changed_manifest', (SELECT count(*) FROM jsonb_array_elements(p_manifest->'sessions') x WHERE (x->>'changed')::boolean),
    'missing', v_missing, 'drift', v_drift, 'extra', v_extra, 'at_target', v_at_target,
    'replacements', v_repl,
    'cross_college_not_applied', (SELECT count(*) FROM jsonb_array_elements(v_repl) z
       WHERE (z->>'cross_college')::boolean AND z->>'state' <> 'applied'),
    'current_snapshot', public.schedule_version_session_snapshot(p_version),
    'path_rules_current', public.itcs_cutover_path_rules(p_version),
    'runs', (SELECT coalesce(jsonb_agg(jsonb_build_object('stage', stage, 'at', created_at)), '[]')
               FROM itcs_cutover_private.runs WHERE version_id = p_version AND manifest_sha = md5(p_manifest::text)));
END $$;

CREATE OR REPLACE FUNCTION itcs_cutover_private.assert_history(p_manifest jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE h record; n int; snap text; full_snap text;
BEGIN
 IF jsonb_typeof(p_manifest->'history') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_manifest->'history')<>2
    OR (SELECT count(DISTINCT (x->>'version_id')::uuid)
        FROM jsonb_array_elements(p_manifest->'history') x
        WHERE (x->>'version_id')::uuid IN ('d68d8d22-9a6d-4f21-935f-cebf18bb969b','30f8a76d-1cb9-4944-a5d7-483dcaea7692'))<>2
 THEN RAISE EXCEPTION 'HISTORY_MANIFEST_INVALID' USING ERRCODE='23514'; END IF;
 FOR h IN SELECT * FROM jsonb_to_recordset(p_manifest->'history')
   AS x(version_id uuid,sessions integer,snapshot text,full_snapshot text) ORDER BY version_id LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended(h.version_id::text,9174));
   PERFORM 1 FROM public.schedule_versions WHERE id=h.version_id FOR UPDATE;
   SELECT count(*),md5(string_agg(to_jsonb(ss)::text,'|' ORDER BY ss.id)) INTO n,full_snap
     FROM public.schedule_sessions ss WHERE ss.schedule_version_id=h.version_id;
   snap:=public.schedule_version_session_snapshot(h.version_id);
   IF n<>h.sessions OR snap IS DISTINCT FROM h.snapshot OR full_snap IS DISTINCT FROM h.full_snapshot THEN
     RAISE EXCEPTION 'PUBLISHED_HISTORY_CHANGED %',h.version_id USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION itcs_cutover_private.assert_history(jsonb) FROM PUBLIC;

-- Shared fail-closed preflight used by every stage.
CREATE OR REPLACE FUNCTION itcs_cutover_private.preflight(
  p_version uuid, p_published uuid, p_manifest jsonb, p_manifest_sha text, p_expected_published_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ver public.schedule_versions%ROWTYPE; v_pub public.schedule_versions%ROWTYPE; v_prev jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501'; END IF;
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '120s', true);
  IF p_version IS DISTINCT FROM '258f6f60-539e-43e1-a4bb-f0b07c20c9ab'::uuid
     OR p_published IS DISTINCT FROM 'd68d8d22-9a6d-4f21-935f-cebf18bb969b'::uuid
     OR p_manifest IS NULL OR p_manifest_sha IS NULL OR p_expected_published_snapshot IS NULL THEN
    RAISE EXCEPTION 'CUTOVER_BASELINE_NOT_ENABLED' USING ERRCODE='23514'; END IF;
  PERFORM itcs_cutover_private.assert_history(p_manifest);
  IF md5(p_manifest::text) <> p_manifest_sha THEN
    RAISE EXCEPTION 'MANIFEST_HASH_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  -- Same advisory key as transition/quality functions: serialises all writers.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_version::text, 9174));
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_version FOR UPDATE;
  SELECT * INTO v_pub FROM public.schedule_versions WHERE id = p_published FOR UPDATE;
  IF v_ver.id IS NULL OR v_pub.id IS NULL OR v_pub.college_id <> v_ver.college_id
     OR v_pub.academic_term_id <> v_ver.academic_term_id OR p_version = p_published THEN
    RAISE EXCEPTION 'PUBLISHED_BASELINE_INVALID' USING ERRCODE = 'check_violation'; END IF;
  IF (p_manifest->>'draft_version_id')::uuid IS DISTINCT FROM p_version
     OR (p_manifest->>'published_version_id')::uuid IS DISTINCT FROM p_published
     OR (p_manifest->>'term_id')::uuid IS DISTINCT FROM v_ver.academic_term_id
     OR jsonb_array_length(p_manifest->'sessions') <> 282
     OR (SELECT count(DISTINCT x->>'session_id') FROM jsonb_array_elements(p_manifest->'sessions') x) <> 282
     OR (SELECT count(*) FROM jsonb_array_elements(p_manifest->'sessions') x WHERE (x->>'changed')::boolean) <> 279
     OR jsonb_array_length(p_manifest->'replacements') <> 8
     OR (SELECT count(*) FROM jsonb_array_elements(p_manifest->'replacements') x WHERE (x->>'cross_college')::boolean) <> 8
     OR (SELECT count(DISTINCT x->>'replaces') FROM jsonb_array_elements(p_manifest->'replacements') x) <> 8 THEN
    RAISE EXCEPTION 'MANIFEST_IDENTITY_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  -- Historical version: byte-identical, whether still published or already archived by this cutover.
  IF public.schedule_version_session_snapshot(p_published) <> p_expected_published_snapshot
     OR (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id = p_published) <> 282 THEN
    RAISE EXCEPTION 'PUBLISHED_SNAPSHOT_DRIFT' USING ERRCODE = 'check_violation'; END IF;
  v_prev := public.itcs_cutover_preview(p_version, p_manifest);
  IF (v_prev->>'missing')::int <> 0 OR (v_prev->>'drift')::int <> 0 OR (v_prev->>'extra')::int <> 0
     OR (v_prev->>'sessions_live')::int <> 282 THEN
    RAISE EXCEPTION 'MANIFEST_LIVE_MISMATCH: %', v_prev - 'current_snapshot' - 'path_rules_current'
      USING ERRCODE = 'check_violation'; END IF;
  RETURN v_prev;
END $$;

CREATE OR REPLACE FUNCTION public.itcs_cutover_execute(
  p_stage text, p_version uuid, p_published uuid, p_manifest jsonb, p_manifest_sha text,
  p_expected_published_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_ver public.schedule_versions%ROWTYPE; v_prev jsonb; v_run jsonb;
  z record; v_out jsonb := '[]'; v_internal jsonb; v_ids uuid[]; v_n int; v_snap text;
  v_repl jsonb; v_moves jsonb; v_after text; v_rules jsonb; v_gate jsonb; v_q record; v_bad int;
  v_exp record; v_pub_count int;
BEGIN
  IF p_stage NOT IN ('requests', 'apply', 'publish') THEN
    RAISE EXCEPTION 'STAGE_INVALID' USING ERRCODE = 'check_violation'; END IF;

  -- Idempotent replay of a completed stage.
  SELECT result INTO v_run FROM itcs_cutover_private.runs
   WHERE version_id = p_version AND manifest_sha = p_manifest_sha
     AND stage = CASE p_stage WHEN 'approve' THEN 'applied' WHEN 'apply' THEN 'applied' WHEN 'publish' THEN 'published' ELSE '-' END;
  IF v_run IS NOT NULL AND p_stage = 'publish' THEN
    IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
      RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501'; END IF;
    IF (SELECT status FROM public.schedule_versions WHERE id = p_version) <> 'published' THEN
      RAISE EXCEPTION 'CUTOVER_RECEIPT_STATE_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
    RETURN v_run || jsonb_build_object('replayed', true);
  END IF;

  v_prev := itcs_cutover_private.preflight(p_version, p_published, p_manifest, p_manifest_sha, p_expected_published_snapshot);
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_version;
  IF v_ver.status <> 'draft' THEN RAISE EXCEPTION 'VERSION_NOT_DRAFT' USING ERRCODE = 'check_violation'; END IF;
  IF (SELECT status FROM public.schedule_versions WHERE id = p_published) <> 'published' THEN
    RAISE EXCEPTION 'PUBLISHED_BASELINE_NOT_PUBLISHED' USING ERRCODE = 'check_violation'; END IF;

  -- ------------------------------------------------------------ requests
  IF p_stage = 'requests' THEN
    FOR z IN SELECT * FROM itcs_cutover_private.replacement_status(p_version, p_manifest) WHERE cross_college LOOP
      IF z.state = 'request_missing' THEN
        v_out := v_out || public.submit_version_scoped_teaching_request(p_version, z.replaces, z.instructor, z.hours,
                   'ITCS cutover ' || p_manifest_sha);
      ELSIF z.state IN ('awaiting_home_decision', 'applied') THEN
        v_out := v_out || jsonb_build_object('replaces', z.replaces, 'request_id', z.scoped_request, 'state', z.state);
      ELSE
        RAISE EXCEPTION 'CROSS_COLLEGE_REQUEST_STATE_INVALID: % %', z.replaces, z.state USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'itcs_cutover_requests', 'schedule_versions', p_version, v_ver.college_id,
            jsonb_build_object('manifest_sha', p_manifest_sha, 'requests', v_out));
    INSERT INTO itcs_cutover_private.runs(version_id, manifest_sha, stage, result, actor)
    VALUES (p_version, p_manifest_sha, 'requests', jsonb_build_object('requests', v_out), v_uid)
    ON CONFLICT (version_id, manifest_sha, stage) DO UPDATE SET result = EXCLUDED.result, created_at = now();
    RETURN jsonb_build_object('ok', true, 'stage', 'requests', 'requests', v_out);
  END IF;

  -- ------------------------------------------------------------ apply
  IF p_stage = 'apply' THEN
    IF v_run IS NOT NULL THEN   -- replay: live must still equal the sealed result
      IF public.schedule_version_session_snapshot(p_version) <> v_run->>'after_snapshot' THEN
        RAISE EXCEPTION 'APPLIED_RECEIPT_DRIFT' USING ERRCODE = 'check_violation'; END IF;
      RETURN v_run || jsonb_build_object('replayed', true);
    END IF;
    IF (v_prev->>'cross_college_not_applied')::int <> 0 THEN
      RAISE EXCEPTION 'CROSS_COLLEGE_HOME_DECISION_PENDING: %', v_prev->'replacements' USING ERRCODE = 'check_violation'; END IF;
    IF (v_prev->>'at_target')::int <> 3 THEN   -- exactly the 3 unchanged placements
      RAISE EXCEPTION 'MOVES_PARTIALLY_APPLIED: at_target=%', v_prev->>'at_target' USING ERRCODE = 'check_violation'; END IF;

    -- internal replacements only; cross-college ones were created by the home decision.
    SELECT coalesce(jsonb_agg(jsonb_build_object('replaces', z2.replaces, 'instructor', z2.instructor, 'hours', z2.hours)), '[]'),
           array_agg(z2.replaces)
      INTO v_internal, v_ids
      FROM itcs_cutover_private.replacement_status(p_version, p_manifest) z2
     WHERE NOT z2.cross_college AND z2.state = 'internal_pending';
    IF EXISTS (SELECT 1 FROM itcs_cutover_private.replacement_status(p_version, p_manifest) z3
                WHERE NOT z3.cross_college AND z3.state NOT IN ('internal_pending', 'applied')) THEN
      RAISE EXCEPTION 'INTERNAL_REPLACEMENT_STATE_INVALID' USING ERRCODE = 'check_violation'; END IF;
    IF jsonb_array_length(v_internal) > 0 THEN
      SELECT count(*), md5(coalesce(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id,
          s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id), E'\n' ORDER BY s.id), ''))
        INTO v_n, v_snap FROM public.schedule_sessions s
       WHERE s.schedule_version_id = p_version AND NOT (s.teaching_assignment_id = ANY (v_ids));
      v_repl := public.apply_version_scoped_replacements(p_version, v_internal, v_n, v_snap);
    END IF;
    IF EXISTS (SELECT 1 FROM itcs_cutover_private.replacement_status(p_version, p_manifest) z4 WHERE z4.state <> 'applied' OR NOT z4.relinked) THEN
      RAISE EXCEPTION 'REPLACEMENTS_NOT_ALL_APPLIED' USING ERRCODE = 'check_violation'; END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object('session_id', x->>'session_id',
             'day_of_week', (x->'new'->>'day')::int, 'start_time', x->'new'->>'start',
             'end_time', x->'new'->>'end', 'room_id', x->'new'->>'room')), '[]')
      INTO v_moves FROM jsonb_array_elements(p_manifest->'sessions') x WHERE (x->>'changed')::boolean;
    v_after := public.preview_version_session_moves(p_version, v_moves);
    v_moves := public.apply_version_session_moves(p_version, v_moves, 279,
                 public.schedule_version_session_snapshot(p_version), v_after);

    -- every one of the 282 sessions now equals manifest.new
    SELECT count(*) INTO v_bad FROM jsonb_array_elements(p_manifest->'sessions') x
      LEFT JOIN public.schedule_sessions s ON s.id = (x->>'session_id')::uuid AND s.schedule_version_id = p_version
     WHERE s.id IS NULL OR s.day_of_week <> (x->'new'->>'day')::smallint OR s.start_time <> (x->'new'->>'start')::time
        OR s.end_time <> (x->'new'->>'end')::time OR s.room_id IS DISTINCT FROM nullif(x->'new'->>'room', '')::uuid;
    IF v_bad <> 0 THEN RAISE EXCEPTION 'TARGET_PLACEMENT_MISMATCH: %', v_bad USING ERRCODE = 'check_violation'; END IF;

    v_rules := public.itcs_cutover_path_rules(p_version);
    IF NOT (v_rules->>'ok')::boolean THEN RAISE EXCEPTION 'PATH_RULES_FAILED: %', v_rules USING ERRCODE = 'check_violation'; END IF;
    v_after := public.schedule_version_session_snapshot(p_version);
    PERFORM public.seal_version_publish_expectation(p_version, 282, v_after);

    v_run := jsonb_build_object('ok', true, 'stage', 'applied', 'replacements', v_repl, 'moves', v_moves,
                                'rules', v_rules, 'after_snapshot', v_after);
    INSERT INTO itcs_cutover_private.runs(version_id, manifest_sha, stage, result, actor)
    VALUES (p_version, p_manifest_sha, 'applied', v_run, v_uid);
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'itcs_cutover_applied', 'schedule_versions', p_version, v_ver.college_id,
            jsonb_build_object('manifest_sha', p_manifest_sha, 'moved', v_moves->'moved',
                               'internal_replacements', jsonb_array_length(v_internal), 'rules', v_rules));
    RETURN v_run;
  END IF;

  -- ------------------------------------------------------------ publish
  SELECT result INTO v_run FROM itcs_cutover_private.runs
   WHERE version_id = p_version AND manifest_sha = p_manifest_sha AND stage = 'applied';
  IF v_run IS NULL THEN RAISE EXCEPTION 'APPLY_STAGE_REQUIRED' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO v_exp FROM assignment_version_private.publish_expectation WHERE version_id = p_version;
  IF v_exp IS NULL OR v_exp.expected_snapshot <> public.schedule_version_session_snapshot(p_version)
     OR v_exp.expected_snapshot <> v_run->>'after_snapshot' THEN
    RAISE EXCEPTION 'SEAL_BROKEN' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO v_q FROM public.schedule_quality_runs
   WHERE schedule_version_id = p_version AND college_id = v_ver.college_id
   ORDER BY created_at DESC, id DESC LIMIT 1;
  IF v_q.id IS NULL OR v_q.eligibility_revision IS DISTINCT FROM v_ver.eligibility_revision
     OR v_q.hard_conflicts_count <> 0 OR v_q.created_at < (SELECT created_at FROM itcs_cutover_private.runs
          WHERE version_id = p_version AND manifest_sha = p_manifest_sha AND stage = 'applied') THEN
    RAISE EXCEPTION 'QUALITY_RUN_REQUIRED_AT_CURRENT_REVISION' USING ERRCODE = 'check_violation'; END IF;
  v_rules := public.itcs_cutover_path_rules(p_version);
  IF NOT (v_rules->>'ok')::boolean THEN RAISE EXCEPTION 'PATH_RULES_FAILED: %', v_rules USING ERRCODE = 'check_violation'; END IF;
  v_gate := public.version_scoped_publish_gate(p_version);
  IF NOT (v_gate->>'ok')::boolean THEN RAISE EXCEPTION 'PUBLISH_GATE_FAILED: %', v_gate USING ERRCODE = 'check_violation'; END IF;

  PERFORM public.transition_schedule_version(v_ver.college_id, p_version, 'draft', 'review', 'ITCS cutover ' || p_manifest_sha);
  PERFORM public.transition_schedule_version(v_ver.college_id, p_version, 'review', 'approved', 'ITCS cutover ' || p_manifest_sha);
  PERFORM public.transition_schedule_version(v_ver.college_id, p_version, 'approved', 'published', 'ITCS cutover ' || p_manifest_sha);
  FOR z IN SELECT (x->>'version_id')::uuid id FROM jsonb_array_elements(p_manifest->'history') x LOOP
    IF (SELECT status FROM public.schedule_versions WHERE id=z.id)='published' THEN
      PERFORM public.transition_schedule_version(v_ver.college_id,z.id,'published','archived',
        'Superseded by '||p_version||' (ITCS cutover '||p_manifest_sha||')');
    END IF;
  END LOOP;
  PERFORM itcs_cutover_private.assert_history(p_manifest);

  IF public.schedule_version_session_snapshot(p_published) <> p_expected_published_snapshot
     OR (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id = p_published) <> 282 THEN
    RAISE EXCEPTION 'PUBLISHED_HISTORY_CHANGED' USING ERRCODE = 'check_violation'; END IF;
  SELECT count(*) INTO v_pub_count FROM public.schedule_versions
   WHERE college_id = v_ver.college_id AND academic_term_id = v_ver.academic_term_id AND status = 'published';
  IF v_pub_count <> 1 THEN RAISE EXCEPTION 'PUBLISHED_VERSION_COUNT_%', v_pub_count USING ERRCODE = 'check_violation'; END IF;

  v_run := jsonb_build_object('ok', true, 'stage', 'published', 'quality_run_id', v_q.id,
    'quality_revision', v_q.eligibility_revision, 'rules', v_rules, 'gate', v_gate,
    'archived_previous', p_manifest->'history', 'previous_sessions_preserved', 556);
  INSERT INTO itcs_cutover_private.runs(version_id, manifest_sha, stage, result, actor)
  VALUES (p_version, p_manifest_sha, 'published', v_run, v_uid);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'itcs_cutover_published', 'schedule_versions', p_version, v_ver.college_id,
          jsonb_build_object('manifest_sha', p_manifest_sha, 'previous_published', p_published) || v_run);
  RETURN v_run;
END $$;

REVOKE ALL ON FUNCTION public.itcs_cutover_session_units(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.itcs_cutover_path_rules(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.itcs_cutover_published_snapshot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.itcs_cutover_preview(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.itcs_cutover_execute(text, uuid, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION itcs_cutover_private.replacement_status(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION itcs_cutover_private.preflight(uuid, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.itcs_cutover_session_units(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.itcs_cutover_path_rules(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.itcs_cutover_published_snapshot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.itcs_cutover_preview(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.itcs_cutover_execute(text, uuid, uuid, jsonb, text, text) TO authenticated;

COMMIT;

BEGIN;
-- Production migration, reviewed against the live 2026-09-28 baseline. Version-scoped teaching assignments (ITCS draft
-- d68d8d22 vs published 30f8a76d). Revision 2 (review of 2026-09-27).
--
-- Contract
--  * Old assignments stay active and keep serving every other version.
--  * A replacement row is scoped to one DRAFT version; only the version-scoped
--    validator and coverage count it there.
--  * Cross-college replacements follow the legal path: host college submits a
--    pending request carrying the version scope; the HOME college decides it
--    with public.decide_faculty_teaching_request. The assignment row is
--    inserted inside that decision, so faculty_private.guard_assignment_request
--    sees decided_by=auth.uid() and decided_at=now() exactly as it requires.
--  * No trigger is disabled or bypassed.
--  * Live function bodies are patched in place from pg_get_functiondef with
--    exact-text replacement; the migration aborts if a pattern is missing.
--    Originals are stored verbatim for the rollback.
--  * Order: replacements (CAS on untouched rows) -> moves manifest (CAS
--    before/after) -> seal expectation -> publish.

CREATE SCHEMA IF NOT EXISTS assignment_version_private;
REVOKE ALL ON SCHEMA assignment_version_private FROM PUBLIC;

CREATE TABLE assignment_version_private.original_defs (
  signature text PRIMARY KEY, definition text NOT NULL, saved_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE assignment_version_private.scope (
  assignment_id uuid PRIMARY KEY
    REFERENCES public.teaching_assignments(id) DEFERRABLE INITIALLY DEFERRED,
  version_id uuid NOT NULL REFERENCES public.schedule_versions(id),
  replaces_assignment_id uuid NOT NULL REFERENCES public.teaching_assignments(id),
  request_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, replaces_assignment_id));

-- Pending cross-college request -> version scope (written by the host college).
CREATE TABLE assignment_version_private.request_scope (
  request_id uuid PRIMARY KEY REFERENCES public.faculty_teaching_requests(id),
  version_id uuid NOT NULL REFERENCES public.schedule_versions(id),
  replaces_assignment_id uuid NOT NULL REFERENCES public.teaching_assignments(id),
  UNIQUE (version_id, replaces_assignment_id));

CREATE TABLE assignment_version_private.publish_expectation (
  version_id uuid PRIMARY KEY REFERENCES public.schedule_versions(id),
  expected_sessions integer NOT NULL CHECK (expected_sessions > 0),
  expected_snapshot text NOT NULL,
  set_by uuid NOT NULL, set_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE assignment_version_private.move_receipts (
  version_id uuid NOT NULL REFERENCES public.schedule_versions(id),
  before_snapshot text NOT NULL, after_snapshot text NOT NULL,
  moved integer NOT NULL, actor uuid NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());

REVOKE ALL ON ALL TABLES IN SCHEMA assignment_version_private FROM PUBLIC;
GRANT USAGE ON SCHEMA assignment_version_private TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA assignment_version_private TO service_role;

INSERT INTO assignment_version_private.original_defs(signature, definition)
SELECT s, pg_get_functiondef(s::regprocedure) FROM unnest(ARRAY[
  'public.validate_assignment_allocation_locked(uuid,uuid,numeric,numeric,boolean)',
  'public.schedule_version_delivery_coverage(uuid,uuid)',
  'public.decide_faculty_teaching_request(uuid,text,text)']) s;

-- Exact-text patch helper (fails closed when the live body drifted).
CREATE FUNCTION assignment_version_private.patch_function(p_sig text, p_from text, p_to text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_def text := pg_get_functiondef(p_sig::regprocedure);
BEGIN
  IF position(p_from IN v_def) = 0 THEN
    RAISE EXCEPTION 'LIVE_FUNCTION_DRIFT %', p_sig;
  END IF;
  IF position(p_from IN substr(v_def, position(p_from IN v_def) + 1)) > 0 THEN
    RAISE EXCEPTION 'LIVE_FUNCTION_PATTERN_NOT_UNIQUE %', p_sig;
  END IF;
  EXECUTE replace(v_def, p_from, p_to);
END $$;

-- Assignments effective inside one version (unscoped rows not replaced here + rows scoped here).
CREATE FUNCTION public.version_effective_assignments(p_version uuid)
RETURNS TABLE (assignment_id uuid, delivery_group_id uuid, college_id uuid, assigned_component_hours numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT ta.id, ta.delivery_group_id, ta.college_id, ta.assigned_component_hours
  FROM public.teaching_assignments ta
  WHERE ta.is_active
    AND (EXISTS (SELECT 1 FROM assignment_version_private.scope s
                 WHERE s.assignment_id = ta.id AND s.version_id = p_version)
      OR (NOT EXISTS (SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id = ta.id)
          AND NOT EXISTS (SELECT 1 FROM assignment_version_private.scope s
                          WHERE s.replaces_assignment_id = ta.id AND s.version_id = p_version)))
$$;

CREATE FUNCTION public.validate_version_assignment_allocation(
  p_version uuid, p_delivery_group_id uuid, p_component_hours numeric)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

-- (A) Global validator: skip only the row being inserted by the scoped writer.
SELECT assignment_version_private.patch_function(
  'public.validate_assignment_allocation_locked(uuid,uuid,numeric,numeric,boolean)',
  'BEGIN
  SELECT COUNT(*)::integer,',
  'BEGIN
  IF p_include_new_row AND p_exclude_assignment_id IS NULL
     AND nullif(current_setting(''app.version_scoped_pending_assignment'', true), '''') IS NOT NULL
     AND EXISTS (SELECT 1 FROM assignment_version_private.scope s
       WHERE s.assignment_id = nullif(current_setting(''app.version_scoped_pending_assignment'', true), '''')::uuid)
     AND NOT EXISTS (SELECT 1 FROM public.teaching_assignments t
       WHERE t.id = nullif(current_setting(''app.version_scoped_pending_assignment'', true), '''')::uuid) THEN
    RETURN;
  END IF;
  SELECT COUNT(*)::integer,');
SELECT assignment_version_private.patch_function(
  'public.validate_assignment_allocation_locked(uuid,uuid,numeric,numeric,boolean)',
  '    AND ta.is_active = TRUE;',
  '    AND ta.is_active = TRUE
    AND NOT EXISTS (SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id = ta.id);');

-- (B) Coverage: count assignments effective in THIS version. Colleges without
--     scope rows get exactly the previous result.
SELECT assignment_version_private.patch_function(
  'public.schedule_version_delivery_coverage(uuid,uuid)',
  'count(*) FILTER (WHERE ta.is_active=true)::integer AS active_assignments
    FROM public.teaching_assignments ta
    WHERE ta.college_id = p_college_id
    GROUP BY ta.delivery_group_id',
  'count(*)::integer AS active_assignments
    FROM public.version_effective_assignments(p_schedule_version_id) ta
    WHERE ta.college_id = p_college_id
    GROUP BY ta.delivery_group_id');

-- Snapshot of one version (ids, links, placement).
CREATE FUNCTION public.schedule_version_session_snapshot(p_version uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id,
           s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id,
           s.cohort_id, s.schedule_version_id), E'\n' ORDER BY s.id), ''))
  FROM public.schedule_sessions s WHERE s.schedule_version_id = p_version
$$;

-- Core writer. Caller has already authorised; request (if any) is decided in this transaction.
CREATE FUNCTION assignment_version_private.apply_replacement(
  p_version uuid, p_replaces uuid, p_instructor uuid, p_hours numeric, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid(); v_ver public.schedule_versions%ROWTYPE;
  v_old public.teaching_assignments%ROWTYPE; v_new uuid := gen_random_uuid();
  v_before int; v_after int; v_hist_b text; v_hist_a text; v_fix_b text; v_fix_a text;
  v_component numeric;
BEGIN
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_version FOR UPDATE;
  IF NOT FOUND OR v_ver.status <> 'draft' THEN
    RAISE EXCEPTION 'VERSION_NOT_DRAFT' USING ERRCODE = 'check_violation'; END IF;
  SELECT * INTO v_old FROM public.teaching_assignments WHERE id = p_replaces FOR UPDATE;
  IF NOT FOUND OR NOT v_old.is_active OR v_old.college_id <> v_ver.college_id THEN
    RAISE EXCEPTION 'REPLACED_ASSIGNMENT_INVALID' USING ERRCODE = 'check_violation'; END IF;
  IF EXISTS (SELECT 1 FROM assignment_version_private.scope WHERE assignment_id = p_replaces) THEN
    RAISE EXCEPTION 'REPLACED_ASSIGNMENT_IS_VERSION_SCOPED' USING ERRCODE = 'check_violation'; END IF;
  IF EXISTS (SELECT 1 FROM assignment_version_private.scope
             WHERE version_id = p_version AND replaces_assignment_id = p_replaces) THEN
    RAISE EXCEPTION 'ASSIGNMENT_ALREADY_REPLACED_IN_VERSION' USING ERRCODE = 'unique_violation'; END IF;
  SELECT count(*) INTO v_before FROM public.schedule_sessions
  WHERE schedule_version_id = p_version AND teaching_assignment_id = p_replaces;
  IF v_before = 0 THEN
    RAISE EXCEPTION 'REPLACED_ASSIGNMENT_NOT_IN_VERSION' USING ERRCODE = 'check_violation'; END IF;

  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.schedule_version_id, s.teaching_assignment_id,
      s.instructor_id, s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id),
      E'\n' ORDER BY s.id), '')) INTO v_hist_b FROM public.schedule_sessions s
  WHERE s.teaching_assignment_id = p_replaces AND s.schedule_version_id <> p_version;
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.day_of_week, s.start_time, s.end_time,
      s.room_id, s.delivery_group_id, s.cohort_id), E'\n' ORDER BY s.id), '')) INTO v_fix_b
  FROM public.schedule_sessions s WHERE s.schedule_version_id = p_version AND s.teaching_assignment_id = p_replaces;

  INSERT INTO assignment_version_private.scope
    (assignment_id, version_id, replaces_assignment_id, request_id, created_by)
  VALUES (v_new, p_version, p_replaces, p_request_id, v_uid);
  PERFORM set_config('app.version_scoped_pending_assignment', v_new::text, true);
  -- All live triggers on teaching_assignments fire here, including
  -- faculty_private.guard_assignment_request.
  INSERT INTO public.teaching_assignments
    (id, college_id, course_offering_id, instructor_id, section_number, session_type,
     weekly_hours, required_room_type, notes, expected_students, section_id, cohort_id,
     plan_course_component_id, delivery_group_id, assigned_component_hours, is_active)
  VALUES (v_new, v_old.college_id, v_old.course_offering_id, p_instructor, v_old.section_number,
     v_old.session_type, v_old.weekly_hours, v_old.required_room_type,
     concat_ws(' ', v_old.notes, '[version-scoped ' || p_version || ']'),
     v_old.expected_students, v_old.section_id, v_old.cohort_id, v_old.plan_course_component_id,
     v_old.delivery_group_id, p_hours, true);
  PERFORM set_config('app.version_scoped_pending_assignment', '', true);

  SELECT c.weekly_contact_hours INTO v_component FROM public.plan_course_components c
  WHERE c.id = v_old.plan_course_component_id;
  PERFORM public.validate_version_assignment_allocation(p_version, v_old.delivery_group_id, v_component);

  UPDATE public.schedule_sessions SET teaching_assignment_id = v_new, instructor_id = p_instructor
  WHERE schedule_version_id = p_version AND teaching_assignment_id = p_replaces;
  GET DIAGNOSTICS v_after = ROW_COUNT;

  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.schedule_version_id, s.teaching_assignment_id,
      s.instructor_id, s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id),
      E'\n' ORDER BY s.id), '')) INTO v_hist_a FROM public.schedule_sessions s
  WHERE s.teaching_assignment_id = p_replaces AND s.schedule_version_id <> p_version;
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.day_of_week, s.start_time, s.end_time,
      s.room_id, s.delivery_group_id, s.cohort_id), E'\n' ORDER BY s.id), '')) INTO v_fix_a
  FROM public.schedule_sessions s WHERE s.schedule_version_id = p_version AND s.teaching_assignment_id = v_new;
  IF v_after <> v_before OR v_hist_a IS DISTINCT FROM v_hist_b OR v_fix_a IS DISTINCT FROM v_fix_b
     OR NOT EXISTS (SELECT 1 FROM public.teaching_assignments WHERE id = p_replaces AND is_active) THEN
    RAISE EXCEPTION 'VERSION_SCOPED_REPLACEMENT_INVARIANT_VIOLATION' USING ERRCODE = 'check_violation'; END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'version_scoped_assignment_replacement', 'teaching_assignments', v_new, v_ver.college_id,
    jsonb_build_object('version_id', p_version, 'old_assignment_id', p_replaces, 'new_assignment_id', v_new,
      'request_id', p_request_id, 'draft_sessions_relinked', v_after, 'historical_hash', v_hist_b));
  RETURN jsonb_build_object('ok', true, 'action', 'version_scoped_created', 'assignment_id', v_new,
    'old_assignment_id', p_replaces, 'draft_sessions_relinked', v_after);
END $$;

-- Same-college replacement (host college manager). Cross-college is refused here.
CREATE FUNCTION public.create_version_scoped_replacement_assignment(
  p_version uuid, p_replaces uuid, p_instructor uuid, p_hours numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_col uuid; v_ins record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT college_id INTO v_col FROM public.schedule_versions WHERE id = p_version;
  IF v_col IS NULL OR NOT public.can_manage_college(v_uid, v_col) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT college_id, is_active, availability_status INTO v_ins FROM public.instructors WHERE id = p_instructor;
  IF NOT FOUND OR NOT v_ins.is_active OR v_ins.availability_status <> 'available' THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_AVAILABLE' USING ERRCODE = 'check_violation'; END IF;
  IF v_ins.college_id <> v_col THEN
    RAISE EXCEPTION 'CROSS_COLLEGE_REQUIRES_HOME_DECISION' USING ERRCODE = 'check_violation'; END IF;
  RETURN assignment_version_private.apply_replacement(p_version, p_replaces, p_instructor, p_hours, NULL);
END $$;

-- Host college submits a pending cross-college request bound to a version.
CREATE FUNCTION public.submit_version_scoped_teaching_request(
  p_version uuid, p_replaces uuid, p_instructor uuid, p_hours numeric, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_ver public.schedule_versions%ROWTYPE;
  v_old public.teaching_assignments%ROWTYPE; h record; v_comp numeric; v_req uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_version FOR UPDATE;
  IF NOT FOUND OR v_ver.status <> 'draft' THEN
    RAISE EXCEPTION 'VERSION_NOT_DRAFT' USING ERRCODE = 'check_violation'; END IF;
  IF NOT public.can_manage_college(v_uid, v_ver.college_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_old FROM public.teaching_assignments WHERE id = p_replaces;
  IF NOT FOUND OR NOT v_old.is_active OR v_old.college_id <> v_ver.college_id
     OR NOT EXISTS (SELECT 1 FROM public.schedule_sessions WHERE schedule_version_id = p_version
                    AND teaching_assignment_id = p_replaces) THEN
    RAISE EXCEPTION 'REPLACED_ASSIGNMENT_INVALID' USING ERRCODE = 'check_violation'; END IF;
  SELECT hp.* INTO h FROM faculty_private.home_profiles hp
  JOIN public.faculty_identity_links l ON l.identity_id = hp.identity_id
  WHERE l.instructor_id = p_instructor AND hp.is_active;
  IF h.home_college_id IS NULL OR h.home_college_id = v_ver.college_id THEN
    RAISE EXCEPTION 'NOT_A_CROSS_COLLEGE_LECTURER' USING ERRCODE = 'check_violation'; END IF;
  SELECT weekly_contact_hours INTO v_comp FROM public.plan_course_components WHERE id = v_old.plan_course_component_id;
  INSERT INTO public.faculty_teaching_requests (identity_id, instructor_id, home_college_id, college_id,
    delivery_group_id, term_id, component_hours, assigned_hours, notes, status, requested_by)
  VALUES (h.identity_id, p_instructor, h.home_college_id, v_ver.college_id, v_old.delivery_group_id,
    v_ver.academic_term_id, v_comp, p_hours, p_notes, 'pending', v_uid)
  RETURNING id INTO v_req;
  INSERT INTO assignment_version_private.request_scope VALUES (v_req, p_version, p_replaces);
  RETURN jsonb_build_object('ok', true, 'request_id', v_req, 'status', 'pending');
END $$;

-- (C) Home-college decision: branch into the scoped writer for scoped requests.
SELECT assignment_version_private.patch_function(
  'public.decide_faculty_teaching_request(uuid,text,text)',
  'v_result:=faculty_private.apply_create_assignment(r.delivery_group_id,r.instructor_id,r.assigned_hours,r.notes);',
  'IF EXISTS (SELECT 1 FROM assignment_version_private.request_scope rs WHERE rs.request_id=r.id) THEN
    v_result:=assignment_version_private.apply_replacement(
      (SELECT rs.version_id FROM assignment_version_private.request_scope rs WHERE rs.request_id=r.id),
      (SELECT rs.replaces_assignment_id FROM assignment_version_private.request_scope rs WHERE rs.request_id=r.id),
      r.instructor_id,r.assigned_hours,r.id);
   ELSE
    v_result:=faculty_private.apply_create_assignment(r.delivery_group_id,r.instructor_id,r.assigned_hours,r.notes);
   END IF;');

-- Replacements batch: CAS on every session NOT being relinked. Does not seal.
CREATE FUNCTION public.apply_version_scoped_replacements(
  p_version uuid, p_items jsonb, p_expected_untouched integer, p_expected_untouched_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); it jsonb; v_n int; v_snap text; v_repl uuid[]; v_res jsonb := '[]';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.schedule_versions WHERE id = p_version FOR UPDATE;
  SELECT array_agg((x->>'replaces')::uuid) INTO v_repl FROM jsonb_array_elements(p_items) x;
  IF v_repl IS NULL OR cardinality(v_repl) <> (SELECT count(DISTINCT u) FROM unnest(v_repl) u) THEN
    RAISE EXCEPTION 'BATCH_ITEMS_INVALID' USING ERRCODE = 'check_violation'; END IF;
  SELECT count(*), md5(coalesce(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id,
      s.day_of_week, s.start_time, s.end_time, s.room_id, s.delivery_group_id), E'\n' ORDER BY s.id), ''))
    INTO v_n, v_snap FROM public.schedule_sessions s
  WHERE s.schedule_version_id = p_version AND NOT (s.teaching_assignment_id = ANY (v_repl));
  IF v_n <> p_expected_untouched OR v_snap <> p_expected_untouched_snapshot THEN
    RAISE EXCEPTION 'BATCH_SNAPSHOT_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_res := v_res || public.create_version_scoped_replacement_assignment(p_version,
      (it->>'replaces')::uuid, (it->>'instructor')::uuid, (it->>'hours')::numeric);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'untouched', v_n, 'replacements', v_res);
END $$;

-- Deterministic projection of a moves manifest (same formula as the snapshot).
-- p_manifest: [{"session_id":uuid,"day_of_week":n,"start_time":"08:00","end_time":"10:00","room_id":uuid}]
CREATE FUNCTION public.preview_version_session_moves(p_version uuid, p_manifest jsonb)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH m AS (SELECT (x->>'session_id')::uuid id, (x->>'day_of_week')::smallint d,
                    (x->>'start_time')::time st, (x->>'end_time')::time et, (x->>'room_id')::uuid r
             FROM jsonb_array_elements(p_manifest) x)
  SELECT md5(coalesce(string_agg(concat_ws('|', s.id, s.teaching_assignment_id, s.instructor_id,
           coalesce(m.d, s.day_of_week), coalesce(m.st, s.start_time), coalesce(m.et, s.end_time),
           CASE WHEN m.id IS NULL THEN s.room_id ELSE m.r END, s.delivery_group_id,
           s.cohort_id, s.schedule_version_id), E'\n' ORDER BY s.id), ''))
  FROM public.schedule_sessions s LEFT JOIN m ON m.id = s.id
  WHERE s.schedule_version_id = p_version
$$;

-- Atomic moves (day/time/room only) with CAS before and after.
CREATE FUNCTION public.apply_version_session_moves(
  p_version uuid, p_manifest jsonb, p_expected_count integer,
  p_expected_before text, p_expected_after text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_ver public.schedule_versions%ROWTYPE; v_n int; v_after text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_version FOR UPDATE;
  IF NOT FOUND OR v_ver.status <> 'draft' THEN
    RAISE EXCEPTION 'VERSION_NOT_DRAFT' USING ERRCODE = 'check_violation'; END IF;
  IF NOT public.can_manage_college(v_uid, v_ver.college_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF jsonb_array_length(p_manifest) <> p_expected_count
     OR (SELECT count(DISTINCT x->>'session_id') FROM jsonb_array_elements(p_manifest) x) <> p_expected_count
     OR (SELECT count(*) FROM jsonb_array_elements(p_manifest) x JOIN public.schedule_sessions s
         ON s.id = (x->>'session_id')::uuid AND s.schedule_version_id = p_version) <> p_expected_count THEN
    RAISE EXCEPTION 'MOVE_MANIFEST_INVALID' USING ERRCODE = 'check_violation'; END IF;
  IF public.schedule_version_session_snapshot(p_version) <> p_expected_before THEN
    RAISE EXCEPTION 'MOVE_BEFORE_SNAPSHOT_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  IF public.preview_version_session_moves(p_version, p_manifest) <> p_expected_after THEN
    RAISE EXCEPTION 'MOVE_MANIFEST_AFTER_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  -- Ordinary UPDATE: live session triggers (room, college, coordination) fire.
  UPDATE public.schedule_sessions s
  SET day_of_week = (x->>'day_of_week')::smallint, start_time = (x->>'start_time')::time,
      end_time = (x->>'end_time')::time, room_id = (x->>'room_id')::uuid
  FROM jsonb_array_elements(p_manifest) x
  WHERE s.id = (x->>'session_id')::uuid AND s.schedule_version_id = p_version;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_after := public.schedule_version_session_snapshot(p_version);
  IF v_n <> p_expected_count OR v_after <> p_expected_after THEN
    RAISE EXCEPTION 'MOVE_AFTER_SNAPSHOT_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO assignment_version_private.move_receipts VALUES (p_version, p_expected_before, v_after, v_n, v_uid);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'version_session_moves', 'schedule_versions', p_version, v_ver.college_id,
    jsonb_build_object('moved', v_n, 'before', p_expected_before, 'after', v_after));
  RETURN jsonb_build_object('ok', true, 'moved', v_n, 'after_snapshot', v_after);
END $$;

-- Seal after replacements and moves; any later edit breaks the seal.
CREATE FUNCTION public.seal_version_publish_expectation(
  p_version uuid, p_expected_sessions integer, p_expected_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_col uuid; v_n int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT college_id INTO v_col FROM public.schedule_versions WHERE id = p_version AND status = 'draft' FOR UPDATE;
  IF v_col IS NULL OR NOT public.can_manage_college(v_uid, v_col) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT count(*) INTO v_n FROM public.schedule_sessions WHERE schedule_version_id = p_version;
  IF v_n <> p_expected_sessions OR public.schedule_version_session_snapshot(p_version) <> p_expected_snapshot THEN
    RAISE EXCEPTION 'SEAL_SNAPSHOT_MISMATCH' USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO assignment_version_private.publish_expectation VALUES (p_version, v_n, p_expected_snapshot, v_uid)
  ON CONFLICT (version_id) DO UPDATE SET expected_sessions = EXCLUDED.expected_sessions,
    expected_snapshot = EXCLUDED.expected_snapshot, set_by = EXCLUDED.set_by, set_at = now();
  RETURN jsonb_build_object('ok', true, 'sessions', v_n);
END $$;

-- Blocking gate for versions that use scoped assignments. Deliberately limited
-- to facts this migration owns; all live publication triggers still apply.
CREATE FUNCTION public.version_scoped_publish_gate(p_version uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

CREATE FUNCTION public.guard_version_scoped_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb;
BEGIN
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published'
     AND EXISTS (SELECT 1 FROM assignment_version_private.scope WHERE version_id = NEW.id) THEN
    r := public.version_scoped_publish_gate(NEW.id);
    IF NOT coalesce((r->>'ok')::boolean, false) THEN
      RAISE EXCEPTION 'VERSION_SCOPED_PUBLISH_BLOCKED: %', r USING ERRCODE = 'check_violation'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_version_scoped_publish BEFORE UPDATE OF status ON public.schedule_versions
FOR EACH ROW EXECUTE FUNCTION public.guard_version_scoped_publish();

CREATE FUNCTION public.guard_session_version_scoped_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.teaching_assignment_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM assignment_version_private.scope s
       WHERE s.assignment_id = NEW.teaching_assignment_id AND s.version_id <> NEW.schedule_version_id) THEN
    RAISE EXCEPTION 'VERSION_SCOPED_ASSIGNMENT_OTHER_VERSION' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_session_version_scoped_assignment
BEFORE INSERT OR UPDATE OF teaching_assignment_id, schedule_version_id ON public.schedule_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_session_version_scoped_assignment();

REVOKE ALL ON FUNCTION assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assignment_version_private.patch_function(text,text,text) FROM PUBLIC;
DROP FUNCTION assignment_version_private.patch_function(text,text,text);
REVOKE ALL ON FUNCTION public.version_effective_assignments(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_version_assignment_allocation(uuid,uuid,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_version_scoped_replacement_assignment(uuid,uuid,uuid,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_version_scoped_teaching_request(uuid,uuid,uuid,numeric,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_version_scoped_replacements(uuid,jsonb,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_version_session_moves(uuid,jsonb,integer,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.seal_version_publish_expectation(uuid,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_version_scoped_replacement_assignment(uuid,uuid,uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_version_scoped_teaching_request(uuid,uuid,uuid,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_version_scoped_replacements(uuid,jsonb,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preview_version_session_moves(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_version_session_moves(uuid,jsonb,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seal_version_publish_expectation(uuid,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.version_scoped_publish_gate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_version_session_snapshot(uuid) TO authenticated;

COMMIT;

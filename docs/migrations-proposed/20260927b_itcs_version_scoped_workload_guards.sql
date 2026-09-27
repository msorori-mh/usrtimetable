-- PROPOSED — NOT APPLIED. Revision 3 on top of
-- 20260927_itcs_version_scoped_assignments.sql (must run after it).
--
-- P0 found in review of the live database (read-only, 2026-09-27):
--  * public.enforce_instructor_extra_hours_limit() calls
--    faculty_private.workload(); its allocation_pending flag counts every
--    active assignment on the same delivery group GLOBALLY, so a draft-scoped
--    replacement makes BOTH the old (published) and the new lecturer
--    "allocation pending" -> FACULTY_ALLOCATION_REVIEW_REQUIRED before any
--    version coverage runs. ITCS existing_schedule_intake_enabled = false, so
--    the trigger is not skipped.
--  * public.v_instructor_delivery_workload uses the same global peer count
--    (old row with NULL hours drops to 0) and adds a same-identity clone a
--    second time (term hours doubled).
--  * faculty_private.guard_assignment_request raises DUPLICATE_FACULTY_ASSIGNMENT
--    for the same faculty identity on the same group globally.
--  * Session triggers: trg_ss_lock_row refuses instructor/day/time/room edits
--    on is_locked rows; coordination_sessions_final and
--    instructor_daily_session_cap_final are DEFERRABLE INITIALLY DEFERRED, so
--    they only fire at COMMIT, after the RPC's own after-snapshot assertion.
--
-- Minimum change: a (replacement, replaced) pair registered in
-- assignment_version_private.scope for an ALLOW-LISTED draft is not treated
-- as co-teaching and a same-identity clone is not summed twice. With no scope
-- rows (every other college, every other version) every patched expression is
-- identical to the live one. No trigger is disabled or bypassed.

-- 1. Allow-list: only this draft may carry version-scoped replacements.
CREATE TABLE assignment_version_private.enabled_versions (
  version_id uuid PRIMARY KEY REFERENCES public.schedule_versions(id),
  college_code text NOT NULL, note text NOT NULL);
REVOKE ALL ON assignment_version_private.enabled_versions FROM PUBLIC;
GRANT ALL ON assignment_version_private.enabled_versions TO service_role;
INSERT INTO assignment_version_private.enabled_versions VALUES
  ('d68d8d22-9a6d-4f21-935f-cebf18bb969b', 'ITCS', 'ITCS draft vs published 30f8a76d');

-- 2. Save originals for the rollback (functions verbatim, view as full DDL).
INSERT INTO assignment_version_private.original_defs(signature, definition)
SELECT s, pg_get_functiondef(s::regprocedure) FROM unnest(ARRAY[
  'faculty_private.workload(uuid,uuid)',
  'faculty_private.guard_assignment_request()',
  'assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid)',
  'public.apply_version_session_moves(uuid,jsonb,integer,text,text)']) s;
INSERT INTO assignment_version_private.original_defs(signature, definition)
VALUES ('view:public.v_instructor_delivery_workload',
  'CREATE OR REPLACE VIEW public.v_instructor_delivery_workload AS '
  || pg_get_viewdef('public.v_instructor_delivery_workload'::regclass));

-- 3. Pair predicates. Only scope rows of an allow-listed draft count.
CREATE FUNCTION assignment_version_private.is_replacement_pair(a uuid, b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM assignment_version_private.scope s
    JOIN assignment_version_private.enabled_versions e ON e.version_id = s.version_id
    JOIN public.schedule_versions v ON v.id = s.version_id AND v.status = 'draft'
    WHERE (s.assignment_id = a AND s.replaces_assignment_id = b)
       OR (s.assignment_id = b AND s.replaces_assignment_id = a))
$$;
-- A scoped row whose replaced row belongs to the same faculty identity (or
-- the same instructor row). Its hours are already carried by the old row.
CREATE FUNCTION assignment_version_private.is_same_identity_clone(a uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM assignment_version_private.scope s
    JOIN assignment_version_private.enabled_versions e ON e.version_id = s.version_id
    JOIN public.schedule_versions v ON v.id = s.version_id AND v.status = 'draft'
    JOIN public.teaching_assignments n ON n.id = s.assignment_id
    JOIN public.teaching_assignments o ON o.id = s.replaces_assignment_id AND o.is_active
    WHERE s.assignment_id = a
      AND (o.instructor_id = n.instructor_id OR EXISTS (
        SELECT 1 FROM public.faculty_identity_links la
        JOIN public.faculty_identity_links lb ON lb.identity_id = la.identity_id
        WHERE la.instructor_id = o.instructor_id AND lb.instructor_id = n.instructor_id)))
$$;
REVOKE ALL ON FUNCTION assignment_version_private.is_replacement_pair(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION assignment_version_private.is_same_identity_clone(uuid) FROM PUBLIC;

-- Exact-text helper (re-created; Rev2 dropped its copy).
CREATE FUNCTION assignment_version_private.patch_text(p_src text, p_from text, p_to text, p_expect int)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n int := (length(p_src) - length(replace(p_src, p_from, ''))) / greatest(length(p_from), 1);
BEGIN
  IF n <> p_expect THEN
    RAISE EXCEPTION 'LIVE_DEFINITION_DRIFT expected % got % for: %', p_expect, n, left(p_from, 80);
  END IF;
  RETURN replace(p_src, p_from, p_to);
END $$;

DO $patch$
DECLARE d text;
BEGIN
  -- 4a. View: peer count ignores the replacement pair; same-identity clone not summed.
  d := pg_get_viewdef('public.v_instructor_delivery_workload'::regclass);
  d := assignment_version_private.patch_text(d,
    '(ta2.is_active = true))) > 1)',
    '(ta2.is_active = true) AND (NOT assignment_version_private.is_replacement_pair(ta.id, ta2.id)))) > 1)', 2);
  d := assignment_version_private.patch_text(d,
    'WHERE ((ta.delivery_group_id IS NOT NULL) AND (ta.is_active = true))',
    'WHERE ((ta.delivery_group_id IS NOT NULL) AND (ta.is_active = true) AND (NOT assignment_version_private.is_same_identity_clone(ta.id)))', 1);
  EXECUTE 'CREATE OR REPLACE VIEW public.v_instructor_delivery_workload AS ' || d;

  -- 4b. workload(): allocation_pending uses the same pair rules.
  d := pg_get_functiondef('faculty_private.workload(uuid,uuid)'::regprocedure);
  d := assignment_version_private.patch_text(d,
    'WHERE b.delivery_group_id=a.delivery_group_id AND b.is_active)>1',
    'WHERE b.delivery_group_id=a.delivery_group_id AND b.is_active AND NOT assignment_version_private.is_replacement_pair(a.id,b.id))>1', 1);
  d := assignment_version_private.patch_text(d,
    'WHERE a.instructor_id=ANY(v_ids) AND a.is_active AND a.delivery_group_id IS NOT NULL AND',
    'WHERE a.instructor_id=ANY(v_ids) AND a.is_active AND a.delivery_group_id IS NOT NULL AND NOT assignment_version_private.is_same_identity_clone(a.id) AND', 1);
  EXECUTE d;

  -- 4c. guard_assignment_request(): duplicate-identity checks skip only the
  --     replaced row of NEW's own scope pair. The scope row is inserted by
  --     apply_replacement before the teaching_assignments INSERT.
  d := pg_get_functiondef('faculty_private.guard_assignment_request()'::regprocedure);
  d := assignment_version_private.patch_text(d,
    'WHERE a.delivery_group_id=NEW.delivery_group_id AND a.is_active AND a.id<>NEW.id AND l.identity_id=h.identity_id)',
    'WHERE a.delivery_group_id=NEW.delivery_group_id AND a.is_active AND a.id<>NEW.id AND l.identity_id=h.identity_id AND NOT assignment_version_private.is_replacement_pair(NEW.id,a.id))', 1);
  d := assignment_version_private.patch_text(d,
    'AND other.is_active AND other.id<>NEW.id',
    'AND other.is_active AND other.id<>NEW.id AND NOT assignment_version_private.is_replacement_pair(NEW.id,other.id)', 1);
  EXECUTE d;
END $patch$;
DROP FUNCTION assignment_version_private.patch_text(text,text,text,int);

-- 5. Writer: allow-list, same-identity hours cap, locked-row precheck.
DO $w$
DECLARE d text := pg_get_functiondef(
  'assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid)'::regprocedure);
  f text := '  SELECT count(*) INTO v_before FROM public.schedule_sessions
  WHERE schedule_version_id = p_version AND teaching_assignment_id = p_replaces;';
BEGIN
  IF position(f IN d) = 0 THEN RAISE EXCEPTION 'REV2_WRITER_DRIFT'; END IF;
  EXECUTE replace(d, f, '  IF NOT EXISTS (SELECT 1 FROM assignment_version_private.enabled_versions WHERE version_id = p_version) THEN
    RAISE EXCEPTION ''VERSION_NOT_ENABLED_FOR_SCOPED_ASSIGNMENTS'' USING ERRCODE = ''check_violation''; END IF;
  IF EXISTS (SELECT 1 FROM public.schedule_sessions WHERE schedule_version_id = p_version
             AND teaching_assignment_id = p_replaces AND is_locked) THEN
    RAISE EXCEPTION ''REPLACED_SESSION_LOCKED'' USING ERRCODE = ''check_violation''; END IF;
  IF (p_instructor = v_old.instructor_id OR EXISTS (SELECT 1 FROM public.faculty_identity_links la
        JOIN public.faculty_identity_links lb ON lb.identity_id = la.identity_id
        WHERE la.instructor_id = v_old.instructor_id AND lb.instructor_id = p_instructor))
     AND p_hours > coalesce(v_old.assigned_component_hours, v_old.weekly_hours) THEN
    RAISE EXCEPTION ''SAME_IDENTITY_REPLACEMENT_HOURS_INCREASE'' USING ERRCODE = ''check_violation''; END IF;
' || f);
END $w$;

-- 6. Moves: locked rows fail closed; deferred constraint triggers are forced
--    to run inside the call so a conflict aborts before the receipt is written.
DO $m$
DECLARE d text := pg_get_functiondef(
  'public.apply_version_session_moves(uuid,jsonb,integer,text,text)'::regprocedure);
  f1 text := '  -- Ordinary UPDATE: live session triggers (room, college, coordination) fire.';
  f2 text := '  GET DIAGNOSTICS v_n = ROW_COUNT;';
BEGIN
  IF position(f1 IN d) = 0 OR position(f2 IN d) = 0 THEN RAISE EXCEPTION 'REV2_MOVES_DRIFT'; END IF;
  d := replace(d, f1, '  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_manifest) x JOIN public.schedule_sessions s
             ON s.id = (x->>''session_id'')::uuid WHERE s.is_locked) THEN
    RAISE EXCEPTION ''MOVE_LOCKED_SESSION'' USING ERRCODE = ''check_violation''; END IF;
' || f1);
  d := replace(d, f2, f2 || '
  SET CONSTRAINTS public.coordination_sessions_final, public.instructor_daily_session_cap_final IMMEDIATE;
  SET CONSTRAINTS public.coordination_sessions_final, public.instructor_daily_session_cap_final DEFERRED;');
  EXECUTE d;
END $m$;

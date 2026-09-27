-- PROPOSED — NOT APPLIED. Revision 3.1 on top of
-- 20260927_itcs_version_scoped_assignments.sql (must run after it).
--
-- Live findings (read-only, 2026-09-27):
--  * enforce_instructor_extra_hours_limit() -> faculty_private.workload():
--    allocation_pending counts every active row on a delivery group globally.
--  * v_instructor_delivery_workload: same global peer count (old NULL-hours
--    row drops to 0) and a same-identity clone is summed twice.
--  * guard_assignment_request: DUPLICATE_FACULTY_ASSIGNMENT is global.
--  * Session triggers: trg_ss_lock_row blocks lecturer/day/time/room edits on
--    is_locked rows; coordination_sessions_final and
--    instructor_daily_session_cap_final are DEFERRABLE INITIALLY DEFERRED.
--  * transition_schedule_version allows draft->review->approved->published->
--    archived (+ review->draft, approved->review). Archived is terminal, so a
--    rollback is "publish another version", never "re-publish 30f8a76d".
--
-- Lifecycle contract (Rev3.1 — status-independent pairing):
--  * A (new, replaced) pair registered in scope for an allow-listed version is
--    never co-teaching and never a duplicate, in EVERY status
--    (draft/review/approved/published/archived). Both rows stay is_active.
--  * Exactly ONE side of a pair is counted in workload:
--      - OLD counts until the scoped version has been PUBLISHED (promotion row
--        written by the publish trigger);
--      - NEW counts after promotion, until a LATER-published version of the
--        same college/term again renders the OLD assignment (clone rollback).
--  * Before promotion the NEW lecturer's load is checked as a projection
--    (writer, draft->review, review->approved, approved->published): it may not
--    exceed quota+12 nor get worse than the lecturer's current counted load.
--  * Historical versions keep their sessions and assignment rows untouched,
--    so they stay renderable.
--  * With no scope rows every patched expression equals the live one; other
--    colleges and terms are unaffected. No trigger is disabled or bypassed.

-- 1. Allow-list and promotion ledger.
CREATE TABLE assignment_version_private.enabled_versions (
  version_id uuid PRIMARY KEY REFERENCES public.schedule_versions(id),
  college_code text NOT NULL, note text NOT NULL);
CREATE TABLE assignment_version_private.promotions (
  version_id uuid PRIMARY KEY REFERENCES public.schedule_versions(id),
  promoted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  promoted_by uuid);
REVOKE ALL ON assignment_version_private.enabled_versions, assignment_version_private.promotions FROM PUBLIC;
GRANT ALL ON assignment_version_private.enabled_versions, assignment_version_private.promotions TO service_role;
INSERT INTO assignment_version_private.enabled_versions VALUES
  ('d68d8d22-9a6d-4f21-935f-cebf18bb969b', 'ITCS', 'ITCS draft 282 sessions vs published 30f8a76d 274 sessions');

-- 2. Originals for the rollback.
INSERT INTO assignment_version_private.original_defs(signature, definition)
SELECT s, pg_get_functiondef(s::regprocedure) FROM unnest(ARRAY[
  'faculty_private.workload(uuid,uuid)',
  'faculty_private.guard_assignment_request()',
  'assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid)',
  'public.apply_version_session_moves(uuid,jsonb,integer,text,text)',
  'public.version_effective_assignments(uuid)',
  'public.guard_session_version_scoped_assignment()',
  'public.guard_version_scoped_publish()']) s;
INSERT INTO assignment_version_private.original_defs(signature, definition)
VALUES ('view:public.v_instructor_delivery_workload',
  'CREATE OR REPLACE VIEW public.v_instructor_delivery_workload AS '
  || pg_get_viewdef('public.v_instructor_delivery_workload'::regclass));

-- 3. Predicates.
CREATE FUNCTION assignment_version_private.is_replacement_pair(a uuid, b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM assignment_version_private.scope s
    JOIN assignment_version_private.enabled_versions e ON e.version_id = s.version_id
    WHERE (s.assignment_id = a AND s.replaces_assignment_id = b)
       OR (s.assignment_id = b AND s.replaces_assignment_id = a))
$$;
CREATE FUNCTION assignment_version_private.is_promoted(p_version uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM assignment_version_private.promotions WHERE version_id = p_version)
      OR coalesce(current_setting('app.assume_promoted_version', true), '') = p_version::text
$$;
-- NEW side of one scope row wins?
CREATE FUNCTION assignment_version_private.new_side_wins(p_new uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM assignment_version_private.scope s
    JOIN assignment_version_private.enabled_versions e ON e.version_id = s.version_id
    JOIN public.schedule_versions sv ON sv.id = s.version_id
    WHERE s.assignment_id = p_new
      AND assignment_version_private.is_promoted(s.version_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.schedule_versions later
        JOIN assignment_version_private.promotions p ON p.version_id = s.version_id
        JOIN public.schedule_sessions ls ON ls.schedule_version_id = later.id
          AND ls.teaching_assignment_id = s.replaces_assignment_id
        WHERE later.status = 'published' AND later.id <> s.version_id
          AND later.college_id = sv.college_id AND later.academic_term_id = sv.academic_term_id
          AND later.created_at > p.promoted_at))
$$;
-- Exactly one side of every enabled pair is counted; all other rows: true.
CREATE FUNCTION assignment_version_private.is_counted(a uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM assignment_version_private.scope s
                 JOIN assignment_version_private.enabled_versions e ON e.version_id = s.version_id
                 WHERE s.assignment_id = a)
      THEN assignment_version_private.new_side_wins(a)
    WHEN EXISTS (SELECT 1 FROM assignment_version_private.scope s
                 JOIN assignment_version_private.enabled_versions e ON e.version_id = s.version_id
                 WHERE s.replaces_assignment_id = a)
      THEN NOT EXISTS (SELECT 1 FROM assignment_version_private.scope s
                 JOIN assignment_version_private.enabled_versions e ON e.version_id = s.version_id
                 WHERE s.replaces_assignment_id = a
                   AND assignment_version_private.new_side_wins(s.assignment_id))
    ELSE true END
$$;
REVOKE ALL ON FUNCTION assignment_version_private.is_replacement_pair(uuid,uuid),
  assignment_version_private.is_promoted(uuid), assignment_version_private.new_side_wins(uuid),
  assignment_version_private.is_counted(uuid) FROM PUBLIC;

CREATE FUNCTION assignment_version_private.patch_text(p_src text, p_from text, p_to text, p_expect int)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE n int := (length(p_src) - length(replace(p_src, p_from, ''))) / greatest(length(p_from), 1);
BEGIN
  IF n <> p_expect THEN
    RAISE EXCEPTION 'LIVE_DEFINITION_DRIFT expected % got % for: %', p_expect, n, left(p_from, 80);
  END IF;
  RETURN replace(p_src, p_from, p_to);
END $$;

-- 4. Live view / workload / request guard.
DO $patch$
DECLARE d text;
BEGIN
  d := pg_get_viewdef('public.v_instructor_delivery_workload'::regclass);
  d := assignment_version_private.patch_text(d,
    '(ta2.is_active = true))) > 1)',
    '(ta2.is_active = true) AND (NOT assignment_version_private.is_replacement_pair(ta.id, ta2.id)))) > 1)', 2);
  d := assignment_version_private.patch_text(d,
    'WHERE ((ta.delivery_group_id IS NOT NULL) AND (ta.is_active = true))',
    'WHERE ((ta.delivery_group_id IS NOT NULL) AND (ta.is_active = true) AND assignment_version_private.is_counted(ta.id))', 1);
  EXECUTE 'CREATE OR REPLACE VIEW public.v_instructor_delivery_workload AS ' || d;

  d := pg_get_functiondef('faculty_private.workload(uuid,uuid)'::regprocedure);
  d := assignment_version_private.patch_text(d,
    'WHERE b.delivery_group_id=a.delivery_group_id AND b.is_active)>1',
    'WHERE b.delivery_group_id=a.delivery_group_id AND b.is_active AND NOT assignment_version_private.is_replacement_pair(a.id,b.id))>1', 1);
  d := assignment_version_private.patch_text(d,
    'WHERE a.instructor_id=ANY(v_ids) AND a.is_active AND',
    'WHERE a.instructor_id=ANY(v_ids) AND a.is_active AND assignment_version_private.is_counted(a.id) AND', 2);
  EXECUTE d;

  d := pg_get_functiondef('faculty_private.guard_assignment_request()'::regprocedure);
  d := assignment_version_private.patch_text(d,
    'WHERE a.delivery_group_id=NEW.delivery_group_id AND a.is_active AND a.id<>NEW.id AND l.identity_id=h.identity_id)',
    'WHERE a.delivery_group_id=NEW.delivery_group_id AND a.is_active AND a.id<>NEW.id AND l.identity_id=h.identity_id AND NOT assignment_version_private.is_replacement_pair(NEW.id,a.id))', 1);
  d := assignment_version_private.patch_text(d,
    'AND other.is_active AND other.id<>NEW.id',
    'AND other.is_active AND other.id<>NEW.id AND NOT assignment_version_private.is_replacement_pair(NEW.id,other.id)', 1);
  EXECUTE d;
END $patch$;

-- 5. Projected-load check for a version before it is promoted.
--    Mirrors enforce_instructor_extra_hours_limit (pending, hourly contract,
--    quota, quota+12) and never accepts a load worse than today's counted one.
CREATE FUNCTION assignment_version_private.assert_projected_load(p_version uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_now jsonb; v_proj jsonb; v_quota numeric; v_prev text;
BEGIN
  v_prev := coalesce(current_setting('app.assume_promoted_version', true), '');
  FOR r IN
    SELECT DISTINCT ta.instructor_id, o.term_id
    FROM assignment_version_private.scope s
    JOIN public.teaching_assignments ta ON ta.id IN (s.assignment_id, s.replaces_assignment_id)
    JOIN public.course_offerings o ON o.id = ta.course_offering_id
    WHERE s.version_id = p_version
  LOOP
    PERFORM set_config('app.assume_promoted_version', '', true);
    v_now := faculty_private.workload(r.instructor_id, r.term_id);
    PERFORM set_config('app.assume_promoted_version', p_version::text, true);
    v_proj := faculty_private.workload(r.instructor_id, r.term_id);
    PERFORM set_config('app.assume_promoted_version', v_prev, true);
    IF (v_proj->>'allocation_pending')::boolean THEN
      RAISE EXCEPTION 'PROJECTED_ALLOCATION_PENDING %', r.instructor_id USING ERRCODE = '23514'; END IF;
    IF (v_proj->>'quota_applicable')::boolean IS FALSE AND EXISTS (
      SELECT 1 FROM public.instructors i JOIN public.instructor_types t ON t.id = i.instructor_type_id
      WHERE i.id = r.instructor_id AND i.employment_type = 'contract' AND t.code = 'con') THEN CONTINUE; END IF;
    v_quota := (v_proj->>'required_load_hours')::numeric;
    IF v_quota IS NULL THEN
      RAISE EXCEPTION 'PROJECTED_QUOTA_REQUIRED %', r.instructor_id USING ERRCODE = '23514'; END IF;
    IF (v_proj->>'standard_assigned_hours')::numeric > greatest(v_quota + 12,
         coalesce((v_now->>'standard_assigned_hours')::numeric, 0)) THEN
      RAISE EXCEPTION 'PROJECTED_EXTRA_HOURS_LIMIT_EXCEEDED %', r.instructor_id USING ERRCODE = '23514'; END IF;
  END LOOP;
  PERFORM set_config('app.assume_promoted_version', v_prev, true);
END $$;
REVOKE ALL ON FUNCTION assignment_version_private.assert_projected_load(uuid) FROM PUBLIC;

-- 6. Writer: allow-list, locked rows, same-identity hours cap, projection.
DO $w$
DECLARE d text := pg_get_functiondef(
  'assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid)'::regprocedure);
BEGIN
  d := assignment_version_private.patch_text(d,
'  SELECT count(*) INTO v_before FROM public.schedule_sessions
  WHERE schedule_version_id = p_version AND teaching_assignment_id = p_replaces;',
'  IF NOT EXISTS (SELECT 1 FROM assignment_version_private.enabled_versions WHERE version_id = p_version) THEN
    RAISE EXCEPTION ''VERSION_NOT_ENABLED_FOR_SCOPED_ASSIGNMENTS'' USING ERRCODE = ''check_violation''; END IF;
  IF EXISTS (SELECT 1 FROM public.schedule_sessions WHERE schedule_version_id = p_version
             AND teaching_assignment_id = p_replaces AND is_locked) THEN
    RAISE EXCEPTION ''REPLACED_SESSION_LOCKED'' USING ERRCODE = ''check_violation''; END IF;
  IF (p_instructor = v_old.instructor_id OR EXISTS (SELECT 1 FROM public.faculty_identity_links la
        JOIN public.faculty_identity_links lb ON lb.identity_id = la.identity_id
        WHERE la.instructor_id = v_old.instructor_id AND lb.instructor_id = p_instructor))
     AND p_hours > coalesce(v_old.assigned_component_hours, v_old.weekly_hours) THEN
    RAISE EXCEPTION ''SAME_IDENTITY_REPLACEMENT_HOURS_INCREASE'' USING ERRCODE = ''check_violation''; END IF;
  SELECT count(*) INTO v_before FROM public.schedule_sessions
  WHERE schedule_version_id = p_version AND teaching_assignment_id = p_replaces;', 1);
  d := assignment_version_private.patch_text(d,
'  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, ''version_scoped_assignment_replacement''',
'  PERFORM assignment_version_private.assert_projected_load(p_version);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, ''version_scoped_assignment_replacement''', 1);
  EXECUTE d;
END $w$;

-- 7. Moves: locked rows fail closed; deferred checks run inside the call.
DO $m$
DECLARE d text := pg_get_functiondef(
  'public.apply_version_session_moves(uuid,jsonb,integer,text,text)'::regprocedure);
BEGIN
  d := assignment_version_private.patch_text(d,
'  -- Ordinary UPDATE: live session triggers (room, college, coordination) fire.',
'  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_manifest) x JOIN public.schedule_sessions s
             ON s.id = (x->>''session_id'')::uuid WHERE s.is_locked) THEN
    RAISE EXCEPTION ''MOVE_LOCKED_SESSION'' USING ERRCODE = ''check_violation''; END IF;
  -- Ordinary UPDATE: live session triggers (room, college, coordination) fire.', 1);
  d := assignment_version_private.patch_text(d,
'  GET DIAGNOSTICS v_n = ROW_COUNT;',
'  GET DIAGNOSTICS v_n = ROW_COUNT;
  SET CONSTRAINTS public.coordination_sessions_final, public.instructor_daily_session_cap_final IMMEDIATE;
  SET CONSTRAINTS public.coordination_sessions_final, public.instructor_daily_session_cap_final DEFERRED;', 1);
  EXECUTE d;
END $m$;
DROP FUNCTION assignment_version_private.patch_text(text,text,text,int);

-- 8. Per-version effective assignments are session-driven for every version
--    other than the scoped draft itself (published clones, rollback clones).
CREATE OR REPLACE FUNCTION public.version_effective_assignments(p_version uuid)
RETURNS TABLE (assignment_id uuid, delivery_group_id uuid, college_id uuid, assigned_component_hours numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT ta.id, ta.delivery_group_id, ta.college_id, ta.assigned_component_hours
  FROM public.teaching_assignments ta
  WHERE ta.is_active
    AND CASE
      WHEN EXISTS (SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id = ta.id) THEN
        EXISTS (SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id = ta.id AND s.version_id = p_version)
        OR EXISTS (SELECT 1 FROM public.schedule_sessions x WHERE x.schedule_version_id = p_version AND x.teaching_assignment_id = ta.id)
      ELSE NOT EXISTS (SELECT 1 FROM assignment_version_private.scope s
             WHERE s.replaces_assignment_id = ta.id
               AND (s.version_id = p_version OR EXISTS (SELECT 1 FROM public.schedule_sessions x
                     WHERE x.schedule_version_id = p_version AND x.teaching_assignment_id = s.assignment_id))
               AND NOT EXISTS (SELECT 1 FROM public.schedule_sessions x
                     WHERE x.schedule_version_id = p_version AND x.teaching_assignment_id = ta.id))
    END
$$;

-- 9. After promotion a scoped row may be carried into later versions of the
--    same college/term (clone of the published timetable); never before.
CREATE OR REPLACE FUNCTION public.guard_session_version_scoped_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.teaching_assignment_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM assignment_version_private.scope s
       JOIN public.schedule_versions sv ON sv.id = s.version_id
       JOIN public.schedule_versions nv ON nv.id = NEW.schedule_version_id
       WHERE s.assignment_id = NEW.teaching_assignment_id AND s.version_id <> NEW.schedule_version_id
         AND NOT (EXISTS (SELECT 1 FROM assignment_version_private.promotions p WHERE p.version_id = s.version_id)
                  AND nv.college_id = sv.college_id AND nv.academic_term_id = sv.academic_term_id)) THEN
    RAISE EXCEPTION 'VERSION_SCOPED_ASSIGNMENT_OTHER_VERSION' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;

-- 10. Lifecycle trigger: projection on every forward step, gate + promotion
--     on publish. Runs inside transition_schedule_version's UPDATE.
CREATE OR REPLACE FUNCTION public.guard_version_scoped_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r jsonb;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('review','approved','published')
     AND EXISTS (SELECT 1 FROM assignment_version_private.scope WHERE version_id = NEW.id) THEN
    PERFORM assignment_version_private.assert_projected_load(NEW.id);
    IF NEW.status = 'published' THEN
      r := public.version_scoped_publish_gate(NEW.id);
      IF NOT coalesce((r->>'ok')::boolean, false) THEN
        RAISE EXCEPTION 'VERSION_SCOPED_PUBLISH_BLOCKED: %', r USING ERRCODE = 'check_violation'; END IF;
      INSERT INTO assignment_version_private.promotions(version_id, promoted_by)
      VALUES (NEW.id, auth.uid()) ON CONFLICT (version_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

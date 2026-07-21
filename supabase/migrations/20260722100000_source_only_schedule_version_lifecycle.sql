-- SOURCE ONLY — NOT APPLIED — gate APPROVE_DB_MIGRATION_APPLY
-- A4 (USRTIMETABLE-AUTONOMOUS-SOURCE-CLOSURE-WAVE-03, TRACK 5): schedule version
-- lifecycle transitions — role-per-edge enforcement, review-notes capture,
-- actor-role lifecycle history, audit_logs integration, and college-scoped RLS
-- for the lifecycle history table.
--
-- Builds on (does NOT redefine except where stated):
--   20260718120000_source_only_atomic_schedule_version_lifecycle.sql
--     - public.transition_schedule_version(uuid, uuid, text, text, text): atomic,
--       advisory-locked, tenant-scoped transition RPC with optimistic
--       STALE_VERSION_STATUS rejection, six-edge transition matrix, quality gates,
--       and schedule_version_events insert. THIS FILE replaces that function via
--       CREATE OR REPLACE with an IDENTICAL signature (client-compatible); every
--       pre-existing gate is preserved verbatim and extended with role-per-edge
--       enforcement, review-notes capture, actor_role history, and audit_logs.
--     - eligibility_revision machinery, dependency invalidation triggers, and the
--       published/archived immutability triggers: unchanged, not repeated here.
--   20260721180000_source_only_scheduling_headcount_foundation.sql: house style
--     for REVOKE/GRANT discipline and audit_logs inserts (followed here).
--   PR #38 (draft, codex/lifecycle-optimistic-transition): introduced the
--     expected-source-status compare concept client-side. It was superseded on
--     main by the atomic server-side p_expected_status compare inside
--     transition_schedule_version (20260718120000), retained here unchanged.
--
-- Status vocabulary on main is lowercase: draft, review, approved, published,
-- archived. The track's DRAFT -> UNDER_REVIEW -> APPROVED -> PUBLISHED ->
-- ARCHIVED maps to draft -> review -> approved -> published -> archived.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Lifecycle history table: safety-net DDL + actor_role + college-scoped RLS.
--    public.schedule_version_events already exists on main (written by the
--    atomic transition RPC and by the web client for clone events). Its defining
--    migration could not be located by source inspection, so CREATE TABLE IF NOT
--    EXISTS is a no-op where the table exists and closes the gap where it does
--    not. Columns match the shape used by all known writers. actor_role is added
--    idempotently either way. History is append-only for clients (no UPDATE or
--    DELETE for authenticated/anon); the SECURITY DEFINER transition RPC writes
--    it directly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.schedule_version_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  performed_by uuid,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schedule_version_events
  ADD COLUMN IF NOT EXISTS actor_role text;

ALTER TABLE public.schedule_version_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.schedule_version_events TO authenticated;
GRANT ALL ON public.schedule_version_events TO service_role;
REVOKE UPDATE, DELETE ON public.schedule_version_events FROM authenticated, anon;

DROP POLICY IF EXISTS sve_select ON public.schedule_version_events;
CREATE POLICY sve_select ON public.schedule_version_events FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
DROP POLICY IF EXISTS sve_insert ON public.schedule_version_events;
CREATE POLICY sve_insert ON public.schedule_version_events FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id)
              AND performed_by = auth.uid());

CREATE INDEX IF NOT EXISTS idx_sve_version_created
  ON public.schedule_version_events (schedule_version_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sve_college_created
  ON public.schedule_version_events (college_id, created_at);

-- ---------------------------------------------------------------------------
-- 2) Transition RPC — CREATE OR REPLACE, identical signature.
--    Roles per edge:
--      draft->review (submit)          can_manage_college (college_admin of the
--                                      owning college, or super_admin)
--      review->approved (approve)      can_manage_college
--      approved->published (publish)   college_admin of the owning college;
--                                      super_admin only as an audited override
--                                      with mandatory justification notes
--      published->archived (archive)   can_manage_college
--      review->draft (reject back)     can_manage_college + mandatory notes
--      approved->review (revoke)       can_manage_college + mandatory notes
--    archived is terminal: the matrix has no outgoing edges from it, and the
--    20260718120000 immutability triggers lock published/archived rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_schedule_version(
  p_college_id uuid,
  p_schedule_version_id uuid,
  p_expected_status text,
  p_target_status text,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_event_type text;
  v_session_count integer;
  v_quality_score numeric;
  v_hard_conflicts integer;
  v_quality_revision bigint;
  v_is_super boolean;
  v_is_college_admin boolean;
  v_actor_role text;
  v_super_override boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_schedule_version_id::text, 9174));
  SELECT * INTO v_version FROM public.schedule_versions
  WHERE id = p_schedule_version_id AND college_id = p_college_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_manage_college(v_actor, p_college_id) THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_TRANSITION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_version.status <> p_expected_status THEN
    RAISE EXCEPTION 'STALE_VERSION_STATUS' USING ERRCODE = '40001';
  END IF;
  -- Transition matrix. archived is terminal: no outgoing edges exist, so every
  -- transition out of archived raises INVALID_SCHEDULE_VERSION_TRANSITION.
  IF NOT ((p_expected_status, p_target_status) IN (
    ('draft', 'review'), ('review', 'approved'), ('approved', 'published'),
    ('published', 'archived'), ('review', 'draft'), ('approved', 'review')
  )) THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE_VERSION_TRANSITION' USING ERRCODE = '23514';
  END IF;

  -- Role resolution for edge-specific enforcement and history capture. The
  -- college_admin label wins so a dual-role actor publishing within their own
  -- college is not misclassified as a super_admin override.
  v_is_super := public.is_super_admin(v_actor);
  v_is_college_admin := public.has_role(v_actor, 'college_admin')
                        AND public.user_in_college(v_actor, p_college_id);
  v_actor_role := CASE
    WHEN v_is_college_admin THEN 'college_admin'
    WHEN v_is_super THEN 'super_admin'
    ELSE 'unknown'
  END;

  -- Review-notes capture: backward edges (reject back to draft, revoke
  -- approval) require non-empty notes explaining the decision.
  IF (p_expected_status, p_target_status) IN (('review', 'draft'), ('approved', 'review'))
     AND (p_notes IS NULL OR btrim(p_notes) = '') THEN
    RAISE EXCEPTION 'REVIEW_NOTES_REQUIRED' USING ERRCODE = '23514';
  END IF;

  -- Publish is restricted to a college_admin of the owning college. The base
  -- can_manage_college check above guarantees that an actor who reaches this
  -- point without v_is_college_admin is a super_admin; they may publish only
  -- as an audited override with mandatory justification notes.
  IF p_expected_status = 'approved' AND p_target_status = 'published'
     AND NOT v_is_college_admin THEN
    IF p_notes IS NULL OR btrim(p_notes) = '' THEN
      RAISE EXCEPTION 'PUBLISH_OVERRIDE_NOTES_REQUIRED' USING ERRCODE = '23514';
    END IF;
    v_super_override := true;
  END IF;

  IF p_target_status IN ('review', 'approved', 'published') THEN
    SELECT count(*)::integer INTO v_session_count FROM public.schedule_sessions
    WHERE schedule_version_id = p_schedule_version_id AND college_id = p_college_id;
    IF p_target_status = 'review' AND v_session_count = 0 THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:NO_SESSIONS' USING ERRCODE = '23514';
    END IF;

    SELECT total_score, hard_conflicts_count, eligibility_revision
    INTO v_quality_score, v_hard_conflicts, v_quality_revision
    FROM public.schedule_quality_runs
    WHERE schedule_version_id = p_schedule_version_id AND college_id = p_college_id
    ORDER BY created_at DESC, id DESC LIMIT 1;
    IF v_quality_revision IS NULL THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:QUALITY_RUN_REQUIRED' USING ERRCODE = '23514';
    END IF;
    IF v_quality_revision IS DISTINCT FROM v_version.eligibility_revision THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:QUALITY_RUN_STALE' USING ERRCODE = '23514';
    END IF;
    IF COALESCE(v_hard_conflicts, 0) > 0 THEN
      RAISE EXCEPTION 'PUBLISH_BLOCKER:UNAPPROVED_HARD_CONFLICTS' USING ERRCODE = '23514';
    END IF;
  END IF;

  v_event_type := CASE p_expected_status || '->' || p_target_status
    WHEN 'draft->review' THEN 'submitted_for_review'
    WHEN 'review->approved' THEN 'approved'
    WHEN 'approved->published' THEN 'published'
    WHEN 'published->archived' THEN 'archived'
    WHEN 'review->draft' THEN 'rolled_back_to_draft'
    WHEN 'approved->review' THEN 'rolled_back_to_review'
  END;
  UPDATE public.schedule_versions SET status = p_target_status
  WHERE id = p_schedule_version_id AND college_id = p_college_id AND status = p_expected_status;
  IF NOT FOUND THEN RAISE EXCEPTION 'STALE_VERSION_STATUS' USING ERRCODE = '40001'; END IF;

  INSERT INTO public.schedule_version_events (
    college_id, schedule_version_id, event_type, from_status, to_status,
    performed_by, actor_role, notes, metadata
  ) VALUES (
    p_college_id, p_schedule_version_id, v_event_type, p_expected_status,
    p_target_status, v_actor, v_actor_role, p_notes,
    jsonb_build_object('atomic', true, 'actor_role', v_actor_role,
      'super_admin_override', v_super_override,
      'quality_score', v_quality_score,
      'eligibility_revision', v_version.eligibility_revision,
      'unapproved_hard_conflicts', COALESCE(v_hard_conflicts, 0))
  );

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_actor, 'schedule_version_transition', 'schedule_versions', p_schedule_version_id,
    p_college_id,
    jsonb_build_object('event_type', v_event_type,
      'from_status', p_expected_status, 'to_status', p_target_status,
      'actor_role', v_actor_role, 'super_admin_override', v_super_override,
      'notes', p_notes, 'quality_score', v_quality_score,
      'eligibility_revision', v_version.eligibility_revision,
      'unapproved_hard_conflicts', COALESCE(v_hard_conflicts, 0))
  );

  RETURN jsonb_build_object('id', p_schedule_version_id, 'status', p_target_status,
    'event_type', v_event_type, 'actor_role', v_actor_role);
END;
$$;

REVOKE ALL ON FUNCTION public.transition_schedule_version(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_schedule_version(uuid, uuid, text, text, text) TO authenticated, service_role;

-- No general bypass: direct status mutation stays closed; only name/notes are
-- editable directly. Re-asserted from 20260718120000 so this file alone
-- guarantees the invariant.
REVOKE UPDATE ON public.schedule_versions FROM authenticated;
GRANT UPDATE (name, notes) ON public.schedule_versions TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Lifecycle history read RPC: review, approval, publish, and archive
--    history for any college viewer, without broadening table grants.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_schedule_version_lifecycle_events(
  p_college_id uuid,
  p_schedule_version_id uuid
) RETURNS TABLE (
  id uuid,
  event_type text,
  from_status text,
  to_status text,
  performed_by uuid,
  actor_role text,
  notes text,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_view_college(v_actor, p_college_id) THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_HISTORY_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.schedule_versions sv
    WHERE sv.id = p_schedule_version_id AND sv.college_id = p_college_id
  ) THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY
  SELECT e.id, e.event_type, e.from_status, e.to_status, e.performed_by,
         e.actor_role, e.notes, e.metadata, e.created_at
  FROM public.schedule_version_events e
  WHERE e.schedule_version_id = p_schedule_version_id
    AND e.college_id = p_college_id
  ORDER BY e.created_at ASC, e.id ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_schedule_version_lifecycle_events(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_schedule_version_lifecycle_events(uuid, uuid) TO authenticated, service_role;

COMMIT;

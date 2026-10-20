-- Product decision (2026-10-18): no new conflict exceptions or rule waivers from now on.
-- Only what was already approved in the current term stays valid. A hard conflict must be
-- fixed in the timetable; it can no longer be approved away.
--
--  * schedule_version_conflict_exceptions: no new rows, except the carry-over that
--    clone_schedule_version_current makes when a draft is cloned from a version of the SAME
--    term (re-drafting the current timetable keeps its existing approvals). Re-approving a
--    revoked exception is refused; revoking stays possible.
--  * scheduling_policy_exceptions: no new rule waivers. Publication markers
--    (education_source_publication) are not exceptions and stay allowed.
--  * approve_conflict_exception refuses every call with CONFLICT_EXCEPTIONS_CLOSED.

CREATE OR REPLACE FUNCTION public.freeze_conflict_exceptions()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_source_exception uuid;
  v_same_term boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_source_exception := NULLIF(NEW.metadata->>'cloned_from_exception_id', '')::uuid;
    IF v_source_exception IS NOT NULL THEN
      SELECT sv.academic_term_id = tv.academic_term_id INTO v_same_term
        FROM public.schedule_version_conflict_exceptions src
        JOIN public.schedule_versions sv ON sv.id = src.schedule_version_id
        JOIN public.schedule_versions tv ON tv.id = NEW.schedule_version_id
       WHERE src.id = v_source_exception AND src.status = 'approved'
         AND src.conflict_code = NEW.conflict_code;
      IF COALESCE(v_same_term, false) THEN
        RETURN NEW;
      END IF;
      -- Cloned into another term: the exception does not travel. Skip the row silently so the
      -- clone itself still succeeds.
      RETURN NULL;
    END IF;
    RAISE EXCEPTION 'CONFLICT_EXCEPTIONS_CLOSED' USING ERRCODE = 'P0001',
      DETAIL = 'New conflict exceptions are no longer accepted; fix the conflict in the timetable.';
  END IF;
  -- UPDATE: revoking is allowed; turning a non-approved row (back) into an approval is not.
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'CONFLICT_EXCEPTIONS_CLOSED' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.freeze_conflict_exceptions() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_freeze_conflict_exceptions ON public.schedule_version_conflict_exceptions;
CREATE TRIGGER zz_freeze_conflict_exceptions
  BEFORE INSERT OR UPDATE ON public.schedule_version_conflict_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.freeze_conflict_exceptions();

CREATE OR REPLACE FUNCTION public.freeze_policy_waivers()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.rule_code <> 'education_source_publication'
     AND (TG_OP = 'INSERT' OR NEW.rule_code IS DISTINCT FROM OLD.rule_code
          OR NEW.schedule_version_id IS DISTINCT FROM OLD.schedule_version_id
          OR NEW.college_id IS DISTINCT FROM OLD.college_id
          OR (NEW.expires_at IS DISTINCT FROM OLD.expires_at
              AND (NEW.expires_at IS NULL OR (OLD.expires_at IS NOT NULL AND NEW.expires_at > OLD.expires_at)))) THEN
    -- No new waiver, no widening of an existing one (shortening its expiry is allowed).
    RAISE EXCEPTION 'POLICY_WAIVERS_CLOSED' USING ERRCODE = 'P0001',
      DETAIL = 'New or widened rule waivers are no longer accepted.';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.freeze_policy_waivers() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_freeze_policy_waivers ON public.scheduling_policy_exceptions;
CREATE TRIGGER zz_freeze_policy_waivers
  BEFORE INSERT OR UPDATE ON public.scheduling_policy_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.freeze_policy_waivers();

-- The approve RPC stays (same signature, so callers get a clear answer) but always refuses.
CREATE OR REPLACE FUNCTION public.approve_conflict_exception(
  p_schedule_version_id uuid, p_conflict_code text, p_session_id uuid, p_related_session_id uuid,
  p_approval_type text, p_reason text, p_source text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;
  RAISE EXCEPTION 'CONFLICT_EXCEPTIONS_CLOSED' USING ERRCODE = 'P0001',
    DETAIL = 'New conflict exceptions are no longer accepted; fix the conflict in the timetable.';
END $fn$;
REVOKE ALL ON FUNCTION public.approve_conflict_exception(uuid, text, uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_conflict_exception(uuid, text, uuid, uuid, text, text, text, jsonb) TO authenticated, service_role;

-- H-7 (track C): conflict exceptions are approved and revoked only through audited RPCs.
--
-- * approve_conflict_exception(...) / revoke_conflict_exception(...) (SECURITY DEFINER):
--   approved_by = auth.uid(), approved_at = now(); can_manage_college for ordinary approval
--   types, is_super_admin for 'cross_college_instructor' (it waives a clash with ANOTHER
--   college's timetable); never for itcs_theory_after_14 / cohort_component_single_instructor;
--   only on draft/review versions; both sessions must belong to the version; audit_logs row.
-- * BEFORE INSERT/UPDATE trigger enforces the same rules for any other path: client roles may
--   not write the table at all; server functions (clone carry-over, one-off migrations) must
--   still produce an approver timestamp and a valid session/version scope.
-- * Clients keep SELECT only.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_conflict_exception_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'CONFLICT_EXCEPTION_RPC_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NEW.conflict_code IN ('itcs_theory_after_14', 'cohort_component_single_instructor') THEN
    RAISE EXCEPTION 'CONFLICT_NOT_EXCEPTIONABLE:%', NEW.conflict_code USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'approved' THEN
    IF NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;
    IF NEW.approved_by IS NULL AND NOT (COALESCE(NEW.metadata, '{}'::jsonb) ? 'cloned_from_exception_id') THEN
      NEW.approved_by := auth.uid();
      IF NEW.approved_by IS NULL THEN
        RAISE EXCEPTION 'CONFLICT_EXCEPTION_APPROVER_REQUIRED' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.schedule_version_id, NEW.conflict_code, NEW.session_id,
       NEW.related_session_id, NEW.approval_type, NEW.college_id)
     IS DISTINCT FROM (OLD.schedule_version_id, OLD.conflict_code, OLD.session_id,
       OLD.related_session_id, OLD.approval_type, OLD.college_id) THEN
    RAISE EXCEPTION 'CONFLICT_EXCEPTION_SCOPE_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'revoked' AND NEW.status = 'approved' THEN
    RAISE EXCEPTION 'CONFLICT_EXCEPTION_REVOKED_IS_FINAL' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.enforce_conflict_exception_integrity() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_svce_integrity ON public.schedule_version_conflict_exceptions;
CREATE TRIGGER trg_svce_integrity BEFORE INSERT OR UPDATE ON public.schedule_version_conflict_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_conflict_exception_integrity();

CREATE OR REPLACE FUNCTION public.approve_conflict_exception(
  p_schedule_version_id uuid, p_conflict_code text, p_session_id uuid,
  p_related_session_id uuid, p_approval_type text, p_reason text,
  p_source text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_ver public.schedule_versions%ROWTYPE;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ver FROM public.schedule_versions WHERE id = p_schedule_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'CONFLICT_EXCEPTION_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_approval_type, '')), '') IS NULL THEN
    RAISE EXCEPTION 'CONFLICT_EXCEPTION_TYPE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_conflict_code IN ('itcs_theory_after_14', 'cohort_component_single_instructor') THEN
    RAISE EXCEPTION 'CONFLICT_NOT_EXCEPTIONABLE:%', p_conflict_code USING ERRCODE = '23514';
  END IF;
  IF p_approval_type = 'cross_college_instructor' THEN
    IF NOT public.is_super_admin(v_uid) THEN
      RAISE EXCEPTION 'CROSS_COLLEGE_EXCEPTION_SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.can_manage_college(v_uid, v_ver.college_id) THEN
    RAISE EXCEPTION 'CONFLICT_EXCEPTION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_ver.status NOT IN ('draft', 'review') THEN
    RAISE EXCEPTION 'VERSION_LOCKED:%', v_ver.status USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schedule_sessions WHERE id = p_session_id AND schedule_version_id = v_ver.id)
     OR (p_related_session_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.schedule_sessions WHERE id = p_related_session_id AND schedule_version_id = v_ver.id)) THEN
    RAISE EXCEPTION 'CONFLICT_EXCEPTION_SESSION_SCOPE' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.schedule_version_conflict_exceptions (
    college_id, schedule_version_id, conflict_code, session_id, related_session_id,
    approval_type, reason, source, status, approved_by, approved_at, metadata)
  VALUES (v_ver.college_id, v_ver.id, p_conflict_code, p_session_id, p_related_session_id,
    p_approval_type, btrim(p_reason), p_source, 'approved', v_uid, now(), COALESCE(p_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'approve_conflict_exception', 'schedule_version_conflict_exceptions', v_id, v_ver.college_id,
    jsonb_build_object('schedule_version_id', v_ver.id, 'conflict_code', p_conflict_code,
      'session_id', p_session_id, 'related_session_id', p_related_session_id,
      'approval_type', p_approval_type, 'reason', btrim(p_reason)));
  RETURN v_id;
END $fn$;
REVOKE ALL ON FUNCTION public.approve_conflict_exception(uuid, text, uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_conflict_exception(uuid, text, uuid, uuid, text, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_conflict_exception(p_exception_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_ex public.schedule_version_conflict_exceptions%ROWTYPE;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'CONFLICT_EXCEPTION_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_ex FROM public.schedule_version_conflict_exceptions WHERE id = p_exception_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONFLICT_EXCEPTION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_ex.approval_type = 'cross_college_instructor' THEN
    IF NOT public.is_super_admin(v_uid) THEN
      RAISE EXCEPTION 'CROSS_COLLEGE_EXCEPTION_SUPER_ADMIN_REQUIRED' USING ERRCODE = '42501';
    END IF;
  ELSIF NOT public.can_manage_college(v_uid, v_ex.college_id) THEN
    RAISE EXCEPTION 'CONFLICT_EXCEPTION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM public.schedule_versions WHERE id = v_ex.schedule_version_id;
  IF v_status NOT IN ('draft', 'review') THEN
    RAISE EXCEPTION 'VERSION_LOCKED:%', v_status USING ERRCODE = '23514';
  END IF;
  IF v_ex.status = 'revoked' THEN RETURN; END IF;
  UPDATE public.schedule_version_conflict_exceptions
  SET status = 'revoked',
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'revoked_by', v_uid, 'revoked_at', now(), 'revoke_reason', btrim(p_reason))
  WHERE id = p_exception_id;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_uid, 'revoke_conflict_exception', 'schedule_version_conflict_exceptions', p_exception_id,
    v_ex.college_id, jsonb_build_object('schedule_version_id', v_ex.schedule_version_id,
      'conflict_code', v_ex.conflict_code, 'reason', btrim(p_reason)));
END $fn$;
REVOKE ALL ON FUNCTION public.revoke_conflict_exception(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_conflict_exception(uuid, text) TO authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.schedule_version_conflict_exceptions FROM authenticated, anon;

COMMIT;

-- Rollback of 20261027000200_freeze_conflict_exceptions.sql
DROP TRIGGER IF EXISTS zz_freeze_policy_waivers ON public.scheduling_policy_exceptions;
DROP FUNCTION IF EXISTS public.freeze_policy_waivers();
DROP TRIGGER IF EXISTS zz_freeze_conflict_exceptions ON public.schedule_version_conflict_exceptions;
DROP FUNCTION IF EXISTS public.freeze_conflict_exceptions();
CREATE OR REPLACE FUNCTION public.approve_conflict_exception(p_schedule_version_id uuid, p_conflict_code text, p_session_id uuid, p_related_session_id uuid, p_approval_type text, p_reason text, p_source text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$

;
REVOKE ALL ON FUNCTION public.approve_conflict_exception(uuid, text, uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_conflict_exception(uuid, text, uuid, uuid, text, text, text, jsonb) TO authenticated, service_role;

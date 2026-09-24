-- SECURITY-HARDENING-01 (phase 3/4/6): fail-closed audit writes, admin-only account
-- creation guard accepting both metadata carriers, sensitive-op rate limiting.
-- Reversible: see the DOWN notes in each block comment. No table data is touched.

-- 1) Server-derived audit writes. The client may no longer INSERT into audit_logs
--    directly; it calls this SECURITY DEFINER RPC which stamps actor_id from the
--    verified JWT, so actor_id can no longer be forged.
--    DOWN: drop function; GRANT INSERT ON public.audit_logs TO authenticated;
--          recreate policy al_insert (see block 2 comment for its definition).
CREATE OR REPLACE FUNCTION public.record_audit_log(
  p_action text,
  p_entity text,
  p_entity_id uuid DEFAULT NULL,
  p_college_id uuid DEFAULT NULL,
  p_details jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUDIT_REQUIRES_AUTH';
  END IF;
  IF public.password_change_required() OR public.security_mfa_required() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUDIT_BLOCKED_SESSION_NOT_READY';
  END IF;
  IF public.is_institutional_read_only_actor(v_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUDIT_READ_ONLY_ACTOR';
  END IF;
  IF coalesce(btrim(p_action), '') = '' OR coalesce(btrim(p_entity), '') = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'AUDIT_ACTION_AND_ENTITY_REQUIRED';
  END IF;
  IF p_college_id IS NOT NULL
     AND NOT (public.is_super_admin(v_actor) OR public.user_in_college(v_actor, p_college_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'AUDIT_COLLEGE_NOT_PERMITTED';
  END IF;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_actor, left(btrim(p_action), 120), left(btrim(p_entity), 120), p_entity_id, p_college_id,
          p_details)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_audit_log(text, text, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_audit_log(text, text, uuid, uuid, jsonb) TO authenticated;

-- 2) Remove the direct client INSERT path.
--    Previous policy (for rollback):
--      CREATE POLICY al_insert ON public.audit_logs FOR INSERT TO authenticated
--      WITH CHECK ((actor_id = auth.uid()) AND (NOT is_institutional_read_only_actor(auth.uid())));
DROP POLICY IF EXISTS al_insert ON public.audit_logs;
REVOKE INSERT, UPDATE, DELETE ON public.audit_logs FROM authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;

-- 3) Admin-only account creation guard: Auth writes app_metadata AFTER the
--    auth.users INSERT, so the guard must also accept the provisioning tag from
--    user_metadata, which admin.createUser sets in the same INSERT. Public and
--    anonymous signup are disabled at the provider, so no self-service path can
--    supply this tag.
--    DOWN: restore the previous body that read raw_app_meta_data only.
CREATE OR REPLACE FUNCTION public.enforce_admin_account_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE provisioned_role text;
BEGIN
  SELECT coalesce(u.raw_app_meta_data->>'provisioning_role',
                  u.raw_user_meta_data->>'provisioning_role')
    INTO provisioned_role
  FROM auth.users u WHERE u.id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF coalesce(provisioned_role, '') NOT IN
     ('super_admin','college_admin','read_only','institutional_viewer','university_leadership') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ACCOUNT_CREATION_ADMIN_ONLY';
  END IF;
  RETURN NULL;
END;
$$;

-- 4) Rate limiting for sensitive admin operations. Extends the existing
--    consume_security_limit with conservative per-actor caps and keeps the
--    fail-closed contract (NULL actor => denied).
--    DOWN: restore the previous CASE with only 'password_change' and 'user_admin'.
CREATE OR REPLACE FUNCTION public.consume_security_limit(p_actor uuid, p_action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer; cap integer; duration interval;
BEGIN
 CASE p_action
  WHEN 'password_change' THEN cap:=5; duration:=interval '15 minutes';
  WHEN 'user_admin' THEN cap:=20; duration:=interval '1 minute';
  WHEN 'user_create' THEN cap:=10; duration:=interval '10 minutes';
  WHEN 'password_reset_admin' THEN cap:=10; duration:=interval '15 minutes';
  WHEN 'role_change' THEN cap:=20; duration:=interval '10 minutes';
  WHEN 'data_import' THEN cap:=30; duration:=interval '10 minutes';
  ELSE RAISE EXCEPTION 'Unsupported security action';
 END CASE;
 IF p_actor IS NULL THEN RETURN false; END IF;
 INSERT INTO public.security_rate_buckets AS b(actor_id,action,window_start,attempts)
 VALUES(p_actor,p_action,clock_timestamp(),1)
 ON CONFLICT(actor_id,action) DO UPDATE SET
  attempts=CASE WHEN b.window_start+duration<=clock_timestamp() THEN 1 ELSE least(b.attempts+1,1000000) END,
  window_start=CASE WHEN b.window_start+duration<=clock_timestamp() THEN clock_timestamp() ELSE b.window_start END
 RETURNING attempts INTO n;
 IF n=cap+1 THEN
  INSERT INTO public.security_events(actor_id,event,severity,details)
  VALUES(p_actor,'rate_limit_exceeded','warning',jsonb_build_object('action',p_action));
 END IF;
 RETURN n<=cap;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_security_limit(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_security_limit(uuid, text) TO service_role;

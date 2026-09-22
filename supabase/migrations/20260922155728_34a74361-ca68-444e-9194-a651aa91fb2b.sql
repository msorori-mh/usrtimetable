-- PROVISIONING-GRANT-01
CREATE SCHEMA IF NOT EXISTS provisioning_private;
REVOKE ALL ON SCHEMA provisioning_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS provisioning_private.account_provisioning_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  email_normalized text NOT NULL,
  provisioning_role text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_user_id uuid,
  CONSTRAINT grant_ttl_max_60s CHECK (expires_at > created_at AND expires_at <= created_at + interval '60 seconds'),
  CONSTRAINT grant_role_allowed CHECK (provisioning_role IN
    ('super_admin','college_admin','read_only','institutional_viewer','university_leadership'))
);

-- Blocks double/parallel outstanding grants for the same address.
CREATE UNIQUE INDEX IF NOT EXISTS account_provisioning_grants_open_email
  ON provisioning_private.account_provisioning_grants (email_normalized)
  WHERE consumed_at IS NULL;

ALTER TABLE provisioning_private.account_provisioning_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON provisioning_private.account_provisioning_grants FROM PUBLIC;

-- Atomic single-use consumption, callable only by the guard (definer-owned).
CREATE OR REPLACE FUNCTION provisioning_private.consume_grant(
  p_email text, p_user_id uuid, p_nonce text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_id uuid; v_role text; v_nonce text;
BEGIN
  SELECT g.id, g.provisioning_role, g.nonce INTO v_id, v_role, v_nonce
  FROM provisioning_private.account_provisioning_grants g
  WHERE g.email_normalized = lower(btrim(coalesce(p_email, '')))
    AND g.consumed_at IS NULL
    AND g.expires_at > now()
  ORDER BY g.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF p_nonce IS NOT NULL AND p_nonce <> v_nonce THEN RETURN NULL; END IF;

  UPDATE provisioning_private.account_provisioning_grants
     SET consumed_at = now(), consumed_user_id = p_user_id
   WHERE id = v_id AND consumed_at IS NULL;

  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_role;
END;
$fn$;
REVOKE ALL ON FUNCTION provisioning_private.consume_grant(text, uuid, text) FROM PUBLIC;

-- Server-only issuance. The caller proves super_admin in server code; execute is
-- restricted to service_role so no browser session can reach it.
CREATE OR REPLACE FUNCTION public.issue_account_provisioning_grant(
  p_email text, p_role text, p_created_by uuid
) RETURNS TABLE (grant_id uuid, nonce text, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_email text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF v_email = '' OR p_created_by IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROVISIONING_GRANT_INVALID_INPUT';
  END IF;
  IF coalesce(p_role, '') NOT IN
     ('super_admin','college_admin','read_only','institutional_viewer','university_leadership') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PROVISIONING_GRANT_ROLE_NOT_ALLOWED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_created_by AND ur.role = 'super_admin'::public.app_role
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'PROVISIONING_GRANT_REQUIRES_SUPER_ADMIN';
  END IF;

  -- Stale/expired outstanding grants for the same address never block a retry.
  DELETE FROM provisioning_private.account_provisioning_grants g
   WHERE g.email_normalized = v_email AND g.consumed_at IS NULL AND g.expires_at <= now();

  RETURN QUERY
  INSERT INTO provisioning_private.account_provisioning_grants
    (email_normalized, provisioning_role, created_by, expires_at)
  VALUES (v_email, p_role, p_created_by, now() + interval '60 seconds')
  RETURNING account_provisioning_grants.id,
            account_provisioning_grants.nonce,
            account_provisioning_grants.expires_at;
END;
$fn$;
REVOKE ALL ON FUNCTION public.issue_account_provisioning_grant(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_account_provisioning_grant(text, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.revoke_account_provisioning_grant(p_grant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_n int;
BEGIN
  DELETE FROM provisioning_private.account_provisioning_grants
   WHERE id = p_grant_id AND consumed_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$fn$;
REVOKE ALL ON FUNCTION public.revoke_account_provisioning_grant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_account_provisioning_grant(uuid) TO service_role;

-- Guard: accept a matching single-use grant, otherwise the pre-existing
-- trusted-metadata path, otherwise fail closed. Role list unchanged.
CREATE OR REPLACE FUNCTION public.enforce_admin_account_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_email text;
  v_meta_role text;
  v_meta_nonce text;
  v_granted_role text;
BEGIN
  SELECT u.email,
         coalesce(u.raw_app_meta_data->>'provisioning_role',
                  u.raw_user_meta_data->>'provisioning_role'),
         coalesce(u.raw_app_meta_data->>'provisioning_nonce',
                  u.raw_user_meta_data->>'provisioning_nonce')
    INTO v_email, v_meta_role, v_meta_nonce
  FROM auth.users u WHERE u.id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_granted_role := provisioning_private.consume_grant(v_email, NEW.id, v_meta_nonce);

  IF v_granted_role IS NOT NULL THEN
    IF v_meta_role IS NOT NULL AND v_meta_role <> v_granted_role THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ACCOUNT_CREATION_ADMIN_ONLY';
    END IF;
    RETURN NULL;
  END IF;

  IF coalesce(v_meta_role, '') NOT IN
     ('super_admin','college_admin','read_only','institutional_viewer','university_leadership') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ACCOUNT_CREATION_ADMIN_ONLY';
  END IF;
  RETURN NULL;
END;
$fn$;
REVOKE ALL ON FUNCTION public.enforce_admin_account_creation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_admin_account_creation() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.enforce_admin_account_creation() TO service_role;
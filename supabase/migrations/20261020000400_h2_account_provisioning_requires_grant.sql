-- H-2: account creation guard hardening.
--  * enforce_admin_account_creation read provisioning_role/nonce from
--    raw_user_meta_data (attacker-controlled on self-signup) as a fallback and
--    accepted any allowed role WITHOUT consuming a grant. It now trusts only
--    raw_app_meta_data (settable only by the Auth admin API / service role) and
--    always requires a consumed single-use provisioning grant.
--  * Every real public.app_role value (including college_dean) is accepted by
--    the grant issuer, the grant table and the guard.
--  * handle_new_user no longer promotes the first account to super_admin when no
--    super admin exists (any account created while user_roles had no
--    super_admin row became one). New accounts get read_only; the provisioning
--    flow then sets the real role. Bootstrap of the first super admin is an
--    operator action (SQL with service/owner credentials).

-- Grant store (originally 20260922155728). Re-asserted idempotently: on a
-- database where the original CREATE TABLE failed it is created here, and on
-- production (where it exists) this is a no-op.
CREATE SCHEMA IF NOT EXISTS provisioning_private;
REVOKE ALL ON SCHEMA provisioning_private FROM PUBLIC;

DO $$
BEGIN
  IF to_regclass('provisioning_private.account_provisioning_grants') IS NULL THEN
    CREATE TABLE provisioning_private.account_provisioning_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      nonce text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
      email_normalized text NOT NULL,
      provisioning_role text NOT NULL,
      created_by uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      consumed_user_id uuid,
      CONSTRAINT grant_ttl_max_60s CHECK (expires_at > created_at AND expires_at <= created_at + interval '60 seconds')
    );
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS account_provisioning_grants_open_email
  ON provisioning_private.account_provisioning_grants (email_normalized)
  WHERE consumed_at IS NULL;
ALTER TABLE provisioning_private.account_provisioning_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON provisioning_private.account_provisioning_grants FROM PUBLIC;

ALTER TABLE provisioning_private.account_provisioning_grants
  DROP CONSTRAINT IF EXISTS grant_role_allowed;
ALTER TABLE provisioning_private.account_provisioning_grants
  ADD CONSTRAINT grant_role_allowed CHECK (provisioning_role IN
    ('super_admin','college_admin','read_only','institutional_viewer','university_leadership','college_dean'));

CREATE OR REPLACE FUNCTION public.issue_account_provisioning_grant(p_email text, p_role text, p_created_by uuid)
 RETURNS TABLE(grant_id uuid, nonce text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_temp'
AS $function$
DECLARE v_email text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF v_email = '' OR p_created_by IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PROVISIONING_GRANT_INVALID_INPUT';
  END IF;
  IF p_role IS NULL OR NOT (p_role = ANY (enum_range(NULL::public.app_role)::text[])) THEN
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
$function$;
REVOKE ALL ON FUNCTION public.issue_account_provisioning_grant(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_account_provisioning_grant(text, text, uuid) TO service_role;

-- Guard: a matching, unexpired, single-use grant must be consumed. Only
-- raw_app_meta_data is consulted (provisioning_role / provisioning_nonce);
-- raw_user_meta_data is never trusted. If app_metadata names a role it must
-- equal the granted role.
CREATE OR REPLACE FUNCTION public.enforce_admin_account_creation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_temp'
AS $function$
DECLARE
  v_email text;
  v_meta_role text;
  v_meta_nonce text;
  v_granted_role text;
BEGIN
  SELECT u.email,
         u.raw_app_meta_data->>'provisioning_role',
         u.raw_app_meta_data->>'provisioning_nonce'
    INTO v_email, v_meta_role, v_meta_nonce
  FROM auth.users u WHERE u.id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_granted_role := provisioning_private.consume_grant(v_email, NEW.id, v_meta_nonce);

  IF v_granted_role IS NULL
     OR NOT (v_granted_role = ANY (enum_range(NULL::public.app_role)::text[]))
     OR (v_meta_role IS NOT NULL AND v_meta_role <> v_granted_role) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ACCOUNT_CREATION_ADMIN_ONLY';
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_admin_account_creation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_admin_account_creation() TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT EXECUTE ON FUNCTION public.enforce_admin_account_creation() TO supabase_auth_admin;
  END IF;
END $$;

-- New accounts: profile + default read_only role. No implicit super_admin.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'read_only') ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
  END IF;
END $$;

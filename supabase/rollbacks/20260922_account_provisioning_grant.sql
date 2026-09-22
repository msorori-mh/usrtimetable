-- Rollback for PROVISIONING-GRANT-01.
-- Restores the metadata-only admin guard and removes the grant mechanism.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_admin_account_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
$fn$;
REVOKE ALL ON FUNCTION public.enforce_admin_account_creation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_admin_account_creation() TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.enforce_admin_account_creation() TO service_role;

DROP FUNCTION IF EXISTS public.issue_account_provisioning_grant(text, text, uuid);
DROP FUNCTION IF EXISTS public.revoke_account_provisioning_grant(uuid);
DROP FUNCTION IF EXISTS provisioning_private.consume_grant(text, uuid, text);
DROP TABLE IF EXISTS provisioning_private.account_provisioning_grants;
DROP SCHEMA IF EXISTS provisioning_private;

COMMIT;

-- Only the authenticated super-admin server action can provide provisioning_role
-- in protected app_metadata. Public sign-up data is user_metadata and is ignored.
BEGIN;
CREATE OR REPLACE FUNCTION public.enforce_admin_account_creation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF coalesce(NEW.raw_app_meta_data->>'provisioning_role','') NOT IN
    ('super_admin','college_admin','read_only','institutional_viewer','university_leadership') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='ACCOUNT_CREATION_ADMIN_ONLY';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_admin_account_creation() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS admin_only_account_creation ON auth.users;
CREATE TRIGGER admin_only_account_creation BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_account_creation();
COMMIT;

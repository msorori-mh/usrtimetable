-- Auth admin.createUser inserts first, then updates protected app_metadata
-- in the same transaction. Validate final state before commit, never user_metadata.
CREATE OR REPLACE FUNCTION public.enforce_admin_account_creation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE provisioned_role text;
BEGIN
 SELECT u.raw_app_meta_data->>'provisioning_role' INTO provisioned_role
 FROM auth.users u WHERE u.id = NEW.id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF coalesce(provisioned_role,'') NOT IN
 ('super_admin','college_admin','read_only','institutional_viewer','university_leadership') THEN
   RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='ACCOUNT_CREATION_ADMIN_ONLY';
 END IF;
 RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS admin_only_account_creation ON auth.users;
CREATE CONSTRAINT TRIGGER admin_only_account_creation
AFTER INSERT ON auth.users DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_admin_account_creation();

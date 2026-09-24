-- Allow the admin-only provisioning flow to create college dean accounts.
-- Public self-signup remains disabled; this only extends the existing role allow-list.
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
  FROM auth.users u
  WHERE u.id = NEW.id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF coalesce(provisioned_role, '') NOT IN (
    'super_admin',
    'college_admin',
    'read_only',
    'institutional_viewer',
    'university_leadership',
    'college_dean'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'ACCOUNT_CREATION_ADMIN_ONLY';
  END IF;

  RETURN NULL;
END;
$$;

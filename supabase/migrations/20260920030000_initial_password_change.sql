-- Password onboarding, independent of timetable data and college permissions.
-- Existing accounts are not reset by this migration. The explicit reset is a
-- separate, counted operation after the UI is deployed and verified.
BEGIN;

CREATE OR REPLACE FUNCTION public.password_change_required()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT public.is_super_admin(auth.uid())
    AND EXISTS (
      SELECT 1 FROM auth.users u WHERE u.id = auth.uid()
        AND (u.raw_app_meta_data->>'must_change_password' = 'true'
          OR coalesce((auth.jwt()->>'iat')::bigint, 0) <
            coalesce((u.raw_app_meta_data->>'password_reset_after')::bigint, 0))
    );
$$;
REVOKE ALL ON FUNCTION public.password_change_required() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.password_change_required() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_initial_password_change()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- This endpoint reveals only the caller's requirement, and must remain usable
  -- before a password is changed. All other Data API paths retain their RLS.
  IF trim(both '/' from coalesce(current_setting('request.path', true), ''))
      = 'rpc/password_change_required' THEN RETURN; END IF;
  IF public.password_change_required() THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'PASSWORD_CHANGE_REQUIRED',
      HINT = 'يجب تغيير كلمة المرور المؤقتة قبل استخدام المنصة';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_initial_password_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_initial_password_change() TO anon, authenticated, service_role;

-- Never replace another pre-request check silently.
DO $$
DECLARE configured text;
BEGIN
  SELECT split_part(v, '=', 2) INTO configured FROM pg_roles r,
    unnest(r.rolconfig) v WHERE r.rolname='authenticator' AND v LIKE 'pgrst.db_pre_request=%';
  IF configured IS NOT NULL AND configured <> '' AND configured <> 'public.enforce_initial_password_change' THEN
    RAISE EXCEPTION 'Existing Data API pre-request hook must be preserved';
  END IF;
END;
$$;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.enforce_initial_password_change';

-- Restrictive policies also cover Realtime/Storage reads, where the Data API
-- pre-request check does not run. Existing permissive policies stay unchanged.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND c.relrowsecurity
      AND (n.nspname='public' OR (n.nspname='storage' AND c.relname='objects'))
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS initial_password_ready ON %I.%I', t.nspname,t.relname);
    EXECUTE format('CREATE POLICY initial_password_ready ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT NOT public.password_change_required())) WITH CHECK ((SELECT NOT public.password_change_required()))',t.nspname,t.relname);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_new_account_password()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- app_metadata is controlled by the Auth service/admin, never sign-up user data.
  -- Super-admin provisioning is explicitly exempt; all other new accounts rotate.
  NEW.raw_app_meta_data := coalesce(NEW.raw_app_meta_data, '{}'::jsonb) ||
    jsonb_build_object('must_change_password',
      coalesce(NEW.raw_app_meta_data->>'provisioning_role', '') <> 'super_admin');
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mark_new_account_password() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS initial_password_for_new_account ON auth.users;
CREATE TRIGGER initial_password_for_new_account BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.mark_new_account_password();

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
COMMIT;

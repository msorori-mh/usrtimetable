DO $$
BEGIN
  IF to_regprocedure('public.mark_new_account_password()') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.mark_new_account_password() TO supabase_auth_admin';
  END IF;
  IF to_regprocedure('public.handle_new_user()') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin';
  END IF;
  IF to_regprocedure('public.enforce_admin_account_creation()') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.enforce_admin_account_creation() TO supabase_auth_admin';
  END IF;
  IF to_regprocedure('public.capture_auth_security_event()') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.capture_auth_security_event() TO supabase_auth_admin';
  END IF;
END $$;
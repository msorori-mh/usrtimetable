-- The Data API invokes this void pre-request guard before table/RPC privileges
-- and RLS. The anonymous API role must be able to run the guard itself; this
-- does not grant SELECT, data RPCs, or bypass session/password/MFA checks.
-- Preserve the existing function body, PUBLIC revocation and all data policies.
BEGIN;
GRANT EXECUTE ON FUNCTION public.enforce_initial_password_change() TO anon;
NOTIFY pgrst, 'reload schema';
COMMIT;

-- SECURITY-HARDENING-01 (phase 5): fail-closed throttle on role/college membership
-- changes made from an interactive session. Service-role administrative paths
-- (auth.uid() IS NULL) are intentionally not throttled here; they are throttled
-- in the server functions themselves, so no legitimate admin flow is blocked and
-- there is no global lockout.
-- DOWN: DROP TRIGGER trg_user_roles_rate_limit ON public.user_roles;
--       DROP TRIGGER trg_user_colleges_rate_limit ON public.user_colleges;
--       DROP FUNCTION public.enforce_membership_change_rate_limit();
CREATE OR REPLACE FUNCTION public.enforce_membership_change_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT public.consume_security_limit(auth.uid(), 'role_change') THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'RATE_LIMITED_MEMBERSHIP_CHANGE';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_membership_change_rate_limit() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_user_roles_rate_limit ON public.user_roles;
CREATE TRIGGER trg_user_roles_rate_limit
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_membership_change_rate_limit();

DROP TRIGGER IF EXISTS trg_user_colleges_rate_limit ON public.user_colleges;
CREATE TRIGGER trg_user_colleges_rate_limit
AFTER INSERT OR UPDATE OR DELETE ON public.user_colleges
FOR EACH ROW EXECUTE FUNCTION public.enforce_membership_change_rate_limit();

-- Trigger-only helpers must not be callable from the public API surface.
-- DOWN: GRANT EXECUTE ON FUNCTION public.enforce_initial_password_change() TO PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_initial_password_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_initial_password_change() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_admin_account_creation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_admin_account_creation() FROM anon;
REVOKE ALL ON FUNCTION public.capture_security_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.capture_security_membership() FROM PUBLIC;

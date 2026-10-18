-- L-3: never allow the last super_admin role row to be deleted or changed
-- (directly, via a cascade from auth.users, or via an UPDATE of role/user_id),
-- which would lock the platform out of administration.
-- An advisory lock serializes concurrent removals so two transactions cannot
-- each remove "another" super admin and end with zero.
CREATE OR REPLACE FUNCTION public.prevent_last_super_admin_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.role <> 'super_admin'::public.app_role THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.role = 'super_admin'::public.app_role THEN
    RETURN NULL;  -- still a super admin row (e.g. user_id unchanged/moved)
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('public.user_roles:last_super_admin'));
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'LAST_SUPER_ADMIN' USING ERRCODE = 'P0001',
      DETAIL = 'لا يمكن إزالة آخر مدير عام للنظام.';
  END IF;
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION public.prevent_last_super_admin_removal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_prevent_last_super_admin ON public.user_roles;
CREATE TRIGGER trg_prevent_last_super_admin
  AFTER UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_super_admin_removal();

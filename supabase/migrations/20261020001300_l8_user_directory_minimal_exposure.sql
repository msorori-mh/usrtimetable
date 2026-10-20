-- L-8: institutional viewers could SELECT every row of profiles (emails),
-- user_roles and user_colleges. They only need names and roles. Remove the
-- is_institutional_viewer() branch from those SELECT policies (everything else
-- unchanged) and expose a minimal directory RPC instead.

DROP POLICY IF EXISTS prof_select ON public.profiles;
CREATE POLICY prof_select ON public.profiles
  FOR SELECT TO authenticated
  USING ((id = (SELECT auth.uid())) OR public.is_super_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS ur_select ON public.user_roles;
CREATE POLICY ur_select ON public.user_roles
  FOR SELECT TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR public.is_super_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS uc_select ON public.user_colleges;
CREATE POLICY uc_select ON public.user_colleges
  FOR SELECT TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR public.is_super_admin((SELECT auth.uid())));

-- Directory: id, display name and roles only (no email, no colleges).
-- Rows are returned only to super admins and institutional viewers.
CREATE OR REPLACE FUNCTION public.list_user_directory()
RETURNS TABLE(id uuid, full_name text, roles text[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL
     OR NOT (public.is_super_admin(v_uid) OR public.is_institutional_viewer(v_uid)) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT p.id,
           p.full_name,
           coalesce(array_agg(ur.role::text ORDER BY ur.role::text) FILTER (WHERE ur.role IS NOT NULL),
                    ARRAY[]::text[])
      FROM public.profiles p
      LEFT JOIN public.user_roles ur ON ur.user_id = p.id
     GROUP BY p.id, p.full_name
     ORDER BY p.full_name NULLS LAST, p.id;
END
$function$;
REVOKE ALL ON FUNCTION public.list_user_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_user_directory() TO authenticated, service_role;

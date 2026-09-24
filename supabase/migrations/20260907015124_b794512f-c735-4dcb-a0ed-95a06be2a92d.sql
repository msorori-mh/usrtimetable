CREATE OR REPLACE FUNCTION public.is_institutional_read_only_actor(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT _user_id IS NOT NULL
     AND public.has_role(_user_id, 'institutional_viewer'::public.app_role)
     AND NOT public.is_super_admin(_user_id)
     AND NOT public.has_role(_user_id, 'college_admin'::public.app_role);
$function$;

REVOKE ALL ON FUNCTION public.is_institutional_read_only_actor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_institutional_read_only_actor(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS prof_insert ON public.profiles;
CREATE POLICY prof_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    ((id = auth.uid()) OR public.is_super_admin(auth.uid()))
    AND NOT public.is_institutional_read_only_actor(auth.uid())
  );

DROP POLICY IF EXISTS prof_update ON public.profiles;
CREATE POLICY prof_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    ((id = auth.uid()) OR public.is_super_admin(auth.uid()))
    AND NOT public.is_institutional_read_only_actor(auth.uid())
  )
  WITH CHECK (
    ((id = auth.uid()) OR public.is_super_admin(auth.uid()))
    AND NOT public.is_institutional_read_only_actor(auth.uid())
  );

DROP POLICY IF EXISTS al_insert ON public.audit_logs;
CREATE POLICY al_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    (actor_id = auth.uid())
    AND NOT public.is_institutional_read_only_actor(auth.uid())
  );
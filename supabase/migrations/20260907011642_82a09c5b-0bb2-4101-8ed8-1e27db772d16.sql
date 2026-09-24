-- 1. Role predicate for the new institution-wide read-only role
CREATE OR REPLACE FUNCTION public.is_institutional_viewer(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'institutional_viewer'::public.app_role
  );
$function$;

REVOKE ALL ON FUNCTION public.is_institutional_viewer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_institutional_viewer(uuid) TO authenticated, service_role;

-- 2. Read visibility: institution-wide. can_manage_college is intentionally NOT changed.
CREATE OR REPLACE FUNCTION public.can_view_college(_user_id uuid, _college_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.is_super_admin(_user_id)
      OR public.user_in_college(_user_id, _college_id)
      OR public.is_institutional_viewer(_user_id);
$function$;

-- 3. Administrative SELECT policies
DROP POLICY IF EXISTS col_select ON public.colleges;
CREATE POLICY col_select ON public.colleges FOR SELECT TO authenticated
USING (is_super_admin(auth.uid()) OR user_in_college(auth.uid(), id) OR is_institutional_viewer(auth.uid()));

DROP POLICY IF EXISTS prof_select ON public.profiles;
CREATE POLICY prof_select ON public.profiles FOR SELECT TO authenticated
USING ((id = auth.uid()) OR is_super_admin(auth.uid()) OR is_institutional_viewer(auth.uid()));

DROP POLICY IF EXISTS ur_select ON public.user_roles;
CREATE POLICY ur_select ON public.user_roles FOR SELECT TO authenticated
USING ((user_id = auth.uid()) OR is_super_admin(auth.uid()) OR is_institutional_viewer(auth.uid()));

DROP POLICY IF EXISTS uc_select ON public.user_colleges;
CREATE POLICY uc_select ON public.user_colleges FOR SELECT TO authenticated
USING ((user_id = auth.uid()) OR is_super_admin(auth.uid()) OR is_institutional_viewer(auth.uid()));

DROP POLICY IF EXISTS al_select ON public.audit_logs;
CREATE POLICY al_select ON public.audit_logs FOR SELECT TO authenticated
USING (
  is_super_admin(auth.uid())
  OR ((college_id IS NOT NULL) AND user_in_college(auth.uid(), college_id))
  OR is_institutional_viewer(auth.uid())
);

-- 4. Strict zero-write: block the only authenticated-writable policy for this role
DROP POLICY IF EXISTS al_insert ON public.audit_logs;
CREATE POLICY al_insert ON public.audit_logs FOR INSERT TO authenticated
WITH CHECK (actor_id = auth.uid() AND NOT is_institutional_viewer(auth.uid()));
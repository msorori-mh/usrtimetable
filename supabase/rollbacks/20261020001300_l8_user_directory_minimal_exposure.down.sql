-- Rollback for L-8: restore institutional viewer read access and drop the RPC.
DROP POLICY IF EXISTS prof_select ON public.profiles;
CREATE POLICY prof_select ON public.profiles FOR SELECT TO authenticated
  USING ((id = (SELECT auth.uid())) OR public.is_super_admin((SELECT auth.uid()))
         OR public.is_institutional_viewer((SELECT auth.uid())));
DROP POLICY IF EXISTS ur_select ON public.user_roles;
CREATE POLICY ur_select ON public.user_roles FOR SELECT TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR public.is_super_admin((SELECT auth.uid()))
         OR public.is_institutional_viewer((SELECT auth.uid())));
DROP POLICY IF EXISTS uc_select ON public.user_colleges;
CREATE POLICY uc_select ON public.user_colleges FOR SELECT TO authenticated
  USING ((user_id = (SELECT auth.uid())) OR public.is_super_admin((SELECT auth.uid()))
         OR public.is_institutional_viewer((SELECT auth.uid())));
DROP FUNCTION IF EXISTS public.list_user_directory();

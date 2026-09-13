-- PUBLISHED-ONLY-REPORTS-01: a read_only-ONLY account may read published schedules only.
CREATE OR REPLACE FUNCTION public.is_reports_only_viewer(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.user_roles ur
           WHERE ur.user_id = _user_id AND ur.role = 'read_only'::app_role
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.user_roles ur
           WHERE ur.user_id = _user_id
             AND ur.role IN ('super_admin'::app_role, 'college_admin'::app_role, 'institutional_viewer'::app_role)
         )
$$;

CREATE OR REPLACE FUNCTION public.schedule_version_is_published(_version_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.schedule_versions sv
    WHERE sv.id = _version_id AND sv.status = 'published'
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_reports_only_viewer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_version_is_published(uuid) TO authenticated;

DROP POLICY IF EXISTS sv_select ON public.schedule_versions;
CREATE POLICY sv_select ON public.schedule_versions
FOR SELECT TO authenticated
USING (
  can_view_college(auth.uid(), college_id)
  AND (
    status = 'published'
    OR NOT public.is_reports_only_viewer(auth.uid())
  )
);

DROP POLICY IF EXISTS ss_select ON public.schedule_sessions;
CREATE POLICY ss_select ON public.schedule_sessions
FOR SELECT TO authenticated
USING (
  can_view_college(auth.uid(), college_id)
  AND (
    NOT public.is_reports_only_viewer(auth.uid())
    OR public.schedule_version_is_published(schedule_version_id)
  )
);
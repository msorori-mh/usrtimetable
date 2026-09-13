REVOKE EXECUTE ON FUNCTION public.is_reports_only_viewer(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.schedule_version_is_published(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_reports_only_viewer(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.schedule_version_is_published(uuid) TO authenticated, service_role;
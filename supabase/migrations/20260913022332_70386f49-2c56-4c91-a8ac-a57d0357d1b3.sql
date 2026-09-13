-- Internal predicate only: used by triggers and SQL, never called from the app.
REVOKE ALL ON FUNCTION public.is_viewer_only(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_viewer_only(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_viewer_only(uuid) TO service_role;
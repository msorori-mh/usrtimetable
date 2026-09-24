-- 1. Pin search_path on helper functions
ALTER FUNCTION public._import_counters_add(jsonb, jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public._import_counters_new() SET search_path = public, pg_temp;
ALTER FUNCTION public._import_is_elective_placeholder(text) SET search_path = public, pg_temp;
ALTER FUNCTION public._import_mode_action(text, boolean) SET search_path = public, pg_temp;
ALTER FUNCTION public._import_row_number(jsonb, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public._import_row_values(jsonb) SET search_path = public, pg_temp;

-- 2. Revoke anonymous EXECUTE on SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.approve_scheduling_cohort_term_headcount(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_scheduling_cohort_term_headcount(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.archive_scheduling_headcount_override(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_scheduling_headcount_override(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_scheduling_headcount_revisions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_scheduling_headcount_revisions(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.resolve_scheduling_headcount(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_scheduling_headcount(uuid, uuid, uuid, uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.upsert_scheduling_cohort_term_headcount(uuid, uuid, integer, integer, integer, integer, integer, integer, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_scheduling_cohort_term_headcount(uuid, uuid, integer, integer, integer, integer, integer, integer, text, text, boolean) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.upsert_scheduling_headcount_override(uuid, uuid, uuid, integer, integer, integer, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_scheduling_headcount_override(uuid, uuid, uuid, integer, integer, integer, text, text, boolean) TO authenticated, service_role;

-- 3. Trigger functions never need to be callable via the API
REVOKE ALL ON FUNCTION public.invalidate_college_schedule_eligibility() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_schedule_version_eligibility() FROM PUBLIC, anon, authenticated;
-- Q-1 (critical): public._import_apply_academic_structure is SECURITY DEFINER and
-- writes departments/programs for any college it is given. Migration
-- 20260917232142 only revoked EXECUTE FROM PUBLIC, but Supabase default
-- privileges grant EXECUTE directly to anon and authenticated, so anonymous
-- callers could insert academic structure into any college.
-- The function is an internal helper of public._import_dispatch (definer, runs
-- as owner) and is only ever meant to be reached through it or service_role.
REVOKE ALL ON FUNCTION public._import_apply_academic_structure(uuid, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._import_apply_academic_structure(uuid, text, text, jsonb)
  TO service_role;

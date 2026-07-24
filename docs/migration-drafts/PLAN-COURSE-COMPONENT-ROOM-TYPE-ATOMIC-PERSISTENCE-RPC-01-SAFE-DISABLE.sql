-- SAFE DISABLE BY FORWARD. Preserves all data and keeps the legacy plan path closed.
BEGIN;

REVOKE ALL ON FUNCTION public.commit_plan_component_import_job_atomic_v2(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;

-- service_role is also disabled for plan import; no old NULL-writing fallback is granted.
REVOKE EXECUTE ON FUNCTION public.commit_plan_component_import_job_atomic_v2(uuid, timestamptz)
  FROM service_role;

-- The compatibility wrapper created by the forward migration continues to reject
-- study_plan_courses/full_study_plan and remains available for unrelated entities.

COMMIT;

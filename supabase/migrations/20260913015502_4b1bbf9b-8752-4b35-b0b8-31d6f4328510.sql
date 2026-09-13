-- A legacy duplicate of the same automation existed: it assigned every college to
-- ANY holder of institutional_viewer, including a college_admin who also carries the
-- role — silently widening that admin's manageable colleges — and its trigger
-- functions were executable by anon. The multi-role-safe pair replaces it.
DROP TRIGGER IF EXISTS trg_assign_new_college_to_institutional_viewers ON public.colleges;
DROP TRIGGER IF EXISTS trg_assign_all_colleges_to_institutional_viewer ON public.user_roles;
DROP FUNCTION IF EXISTS public.assign_new_college_to_institutional_viewers();
DROP FUNCTION IF EXISTS public.assign_all_colleges_to_institutional_viewer();
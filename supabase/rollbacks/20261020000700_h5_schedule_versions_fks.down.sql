-- Rollback for H-5.
ALTER TABLE public.schedule_versions DROP CONSTRAINT IF EXISTS schedule_versions_term_college_fkey;
ALTER TABLE public.schedule_versions DROP CONSTRAINT IF EXISTS schedule_versions_college_id_fkey;
DROP INDEX IF EXISTS public.schedule_versions_term_college_idx;
DROP INDEX IF EXISTS public.schedule_versions_college_id_idx;
-- academic_terms_id_college_key pre-existed in the current schema and is kept.

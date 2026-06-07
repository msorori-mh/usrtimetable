DROP INDEX IF EXISTS public.co_unique;
CREATE UNIQUE INDEX co_unique ON public.course_offerings
  USING btree (
    college_id, term_id, course_id,
    COALESCE(program_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(level_id,   '00000000-0000-0000-0000-000000000000'::uuid),
    study_system
  );
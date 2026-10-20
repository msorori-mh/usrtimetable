-- H-5: schedule_versions had no foreign keys to colleges / academic_terms, so a
-- term (or college) could be deleted out from under published schedule
-- history, and a version could reference a term of another college.
-- Adds RESTRICT foreign keys (never cascade into published history). They are
-- created NOT VALID and validated only when no orphan rows exist; otherwise a
-- NOTICE is raised and the constraint still guards all new writes.

-- Composite target key (already present in current schema; asserted for safety).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.academic_terms'::regclass AND contype IN ('u', 'p')
       AND conkey::int2[] @> ARRAY[
             (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.academic_terms'::regclass AND attname = 'id'),
             (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.academic_terms'::regclass AND attname = 'college_id')]::int2[]
       AND array_length(conkey, 1) = 2) THEN
    ALTER TABLE public.academic_terms ADD CONSTRAINT academic_terms_id_college_key UNIQUE (id, college_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.schedule_versions'::regclass
                  AND conname = 'schedule_versions_college_id_fkey') THEN
    ALTER TABLE public.schedule_versions
      ADD CONSTRAINT schedule_versions_college_id_fkey
      FOREIGN KEY (college_id) REFERENCES public.colleges(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.schedule_versions'::regclass
                  AND conname = 'schedule_versions_term_college_fkey') THEN
    ALTER TABLE public.schedule_versions
      ADD CONSTRAINT schedule_versions_term_college_fkey
      FOREIGN KEY (academic_term_id, college_id) REFERENCES public.academic_terms(id, college_id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.schedule_versions sv
                  WHERE NOT EXISTS (SELECT 1 FROM public.colleges c WHERE c.id = sv.college_id)) THEN
    ALTER TABLE public.schedule_versions VALIDATE CONSTRAINT schedule_versions_college_id_fkey;
  ELSE
    RAISE NOTICE 'H-5: schedule_versions has rows with unknown college_id; schedule_versions_college_id_fkey left NOT VALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.schedule_versions sv
                  WHERE NOT EXISTS (SELECT 1 FROM public.academic_terms t
                                     WHERE t.id = sv.academic_term_id AND t.college_id = sv.college_id)) THEN
    ALTER TABLE public.schedule_versions VALIDATE CONSTRAINT schedule_versions_term_college_fkey;
  ELSE
    RAISE NOTICE 'H-5: schedule_versions has rows whose term is missing or belongs to another college; schedule_versions_term_college_fkey left NOT VALID';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS schedule_versions_term_college_idx
  ON public.schedule_versions (academic_term_id, college_id);
CREATE INDEX IF NOT EXISTS schedule_versions_college_id_idx
  ON public.schedule_versions (college_id);

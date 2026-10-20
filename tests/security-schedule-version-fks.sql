-- H-5: schedule_versions references colleges and (term, college) with RESTRICT.
BEGIN;
-- isolate the FK from the pre-existing ensure_sv_college trigger
ALTER TABLE public.schedule_versions DISABLE TRIGGER trg_sv_college;
INSERT INTO public.universities (id, name) VALUES ('0000000d-0000-0000-0000-0000000000f0', 'H5 U');
INSERT INTO public.colleges (id, university_id, name) VALUES
  ('0000000d-0000-0000-0000-0000000000c1', '0000000d-0000-0000-0000-0000000000f0', 'H5 A'),
  ('0000000d-0000-0000-0000-0000000000c2', '0000000d-0000-0000-0000-0000000000f0', 'H5 B');
INSERT INTO public.academic_terms (id, college_id, name, code) VALUES
  ('0000000d-0000-0000-0000-0000000000d1', '0000000d-0000-0000-0000-0000000000c1', 'T', 'T'),
  ('0000000d-0000-0000-0000-0000000000d2', '0000000d-0000-0000-0000-0000000000c2', 'T', 'T'),
  ('0000000d-0000-0000-0000-0000000000d3', '0000000d-0000-0000-0000-0000000000c1', 'T3', 'T3');
INSERT INTO public.schedule_versions (id, college_id, academic_term_id, name) VALUES
  ('0000000d-0000-0000-0000-0000000000e1', '0000000d-0000-0000-0000-0000000000c1', '0000000d-0000-0000-0000-0000000000d1', 'v');
DO $$
BEGIN
  BEGIN
    DELETE FROM public.academic_terms WHERE id = '0000000d-0000-0000-0000-0000000000d1';
    RAISE EXCEPTION 'H-5: term with a schedule version was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.colleges WHERE id = '0000000d-0000-0000-0000-0000000000c1';
    RAISE EXCEPTION 'H-5: college with a schedule version was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.schedule_versions (college_id, academic_term_id, name) VALUES
      ('0000000d-0000-0000-0000-0000000000c1', '0000000d-0000-0000-0000-0000000000d2', 'cross');
    RAISE EXCEPTION 'H-5: version with another college''s term accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  -- a term without versions is still deletable
  DELETE FROM public.academic_terms WHERE id = '0000000d-0000-0000-0000-0000000000d3';
  IF FOUND IS NOT TRUE THEN RAISE EXCEPTION 'H-5: unused term not deleted'; END IF;
END $$;
ROLLBACK;

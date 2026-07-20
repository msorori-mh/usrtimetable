-- SOURCE ONLY — NOT APPLIED
-- PHASE A1.1: protect academic programs from accidental parent deletion.
-- This migration performs no data mutation or backfill. Production currently has
-- zero academic_programs; applying it still requires a separate user approval.

ALTER TABLE public.academic_programs
  DROP CONSTRAINT IF EXISTS academic_programs_college_id_fkey;

ALTER TABLE public.academic_programs
  ADD CONSTRAINT academic_programs_college_id_fkey
  FOREIGN KEY (college_id)
  REFERENCES public.colleges(id)
  ON DELETE RESTRICT;

ALTER TABLE public.academic_programs
  DROP CONSTRAINT IF EXISTS academic_programs_department_id_fkey;

ALTER TABLE public.academic_programs
  ADD CONSTRAINT academic_programs_department_id_fkey
  FOREIGN KEY (department_id)
  REFERENCES public.departments(id)
  ON DELETE RESTRICT;

-- Keep the database, rather than the client, authoritative for same-college
-- ownership. department_id remains NOT NULL in the original table definition.
CREATE OR REPLACE FUNCTION public.ensure_prog_college()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_department_college_id uuid;
BEGIN
  SELECT college_id
  INTO v_department_college_id
  FROM public.departments
  WHERE id = NEW.department_id;

  IF v_department_college_id IS NULL OR v_department_college_id <> NEW.college_id THEN
    RAISE EXCEPTION 'department/college mismatch';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prog_check_college ON public.academic_programs;
CREATE TRIGGER prog_check_college
  BEFORE INSERT OR UPDATE OF college_id, department_id
  ON public.academic_programs
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_prog_college();

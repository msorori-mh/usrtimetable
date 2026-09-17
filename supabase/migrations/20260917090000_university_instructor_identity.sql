-- University-wide instructor identity foundation
-- Safe, non-destructive groundwork for cross-college reporting.
-- The canonical link (university_person_id) remains nullable until verified by an administrator.

ALTER TABLE public.instructors
  ADD COLUMN IF NOT EXISTS university_instructor_no text,
  ADD COLUMN IF NOT EXISTS university_person_id uuid;

COMMENT ON COLUMN public.instructors.university_instructor_no IS
  'University-wide instructor number. Generated from college code and local employee number when available.';
COMMENT ON COLUMN public.instructors.university_person_id IS
  'Optional canonical person UUID used to link the same instructor across colleges after verified review.';

CREATE UNIQUE INDEX IF NOT EXISTS instructors_university_no_uq
  ON public.instructors (university_instructor_no)
  WHERE university_instructor_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS instructors_university_person_college_idx
  ON public.instructors (university_person_id, college_id)
  WHERE university_person_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_university_instructor_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  college_code text;
  candidate text;
BEGIN
  IF NEW.university_instructor_no IS NOT NULL
     OR NEW.employee_number IS NULL
     OR NEW.college_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT upper(regexp_replace(trim(c.code), '[[:space:]]+', '', 'g'))
    INTO college_code
  FROM public.colleges AS c
  WHERE c.id = NEW.college_id;

  IF college_code IS NULL OR college_code = '' THEN
    RETURN NEW;
  END IF;

  candidate := college_code || '-' || trim(NEW.employee_number);

  -- Preserve an explicitly assigned number and avoid overwriting another record.
  IF NOT EXISTS (
    SELECT 1
    FROM public.instructors AS i
    WHERE i.university_instructor_no = candidate
      AND i.id <> NEW.id
  ) THEN
    NEW.university_instructor_no := candidate;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS instructors_assign_university_no
  ON public.instructors;

CREATE TRIGGER instructors_assign_university_no
  BEFORE INSERT OR UPDATE OF college_id, employee_number, university_instructor_no
  ON public.instructors
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_university_instructor_no();

-- Deterministic backfill for existing rows. Records without a college code or
-- employee number remain nullable for controlled administrative resolution.
UPDATE public.instructors AS i
SET university_instructor_no =
      upper(regexp_replace(trim(c.code), '[[:space:]]+', '', 'g'))
      || '-' || trim(i.employee_number)
FROM public.colleges AS c
WHERE c.id = i.college_id
  AND i.university_instructor_no IS NULL
  AND i.employee_number IS NOT NULL
  AND c.code IS NOT NULL
  AND trim(c.code) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.instructors AS existing
    WHERE existing.university_instructor_no =
      upper(regexp_replace(trim(c.code), '[[:space:]]+', '', 'g'))
      || '-' || trim(i.employee_number)
      AND existing.id <> i.id
  );

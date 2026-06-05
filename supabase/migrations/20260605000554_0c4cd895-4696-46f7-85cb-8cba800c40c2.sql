
-- ============ instructors: add new fields ============
ALTER TABLE public.instructors
  ADD COLUMN IF NOT EXISTS employee_number text,
  ADD COLUMN IF NOT EXISTS full_name_ar text,
  ADD COLUMN IF NOT EXISTS full_name_en text,
  ADD COLUMN IF NOT EXISTS specialization text,
  ADD COLUMN IF NOT EXISTS administrative_release_hours integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes text;

-- backfill full_name_ar from full_name when empty
UPDATE public.instructors
SET full_name_ar = full_name
WHERE full_name_ar IS NULL OR full_name_ar = '';

-- prevent duplicate employee numbers within the same college
CREATE UNIQUE INDEX IF NOT EXISTS instructors_college_emp_no_uq
  ON public.instructors (college_id, employee_number)
  WHERE employee_number IS NOT NULL;

-- ============ rooms: add notes ============
ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS notes text;

-- ============ teaching_assignments: add expected_students ============
ALTER TABLE public.teaching_assignments
  ADD COLUMN IF NOT EXISTS expected_students integer NOT NULL DEFAULT 0;

-- ============ Seed instructor_types per college ============
INSERT INTO public.instructor_types (college_id, code, name_ar, name_en, is_external, display_order, is_active)
SELECT c.id, t.code, t.name_ar, t.name_en, t.is_external, t.ord, true
FROM public.colleges c
CROSS JOIN (VALUES
  ('permanent',            'محاضر دائم',          'Permanent',            false, 1),
  ('from_other_college',   'من كلية أخرى',        'From Other College',   false, 2),
  ('external_collaborator','متعاون خارجي',        'External Collaborator', true, 3),
  ('visiting',             'محاضر زائر',          'Visiting',              true, 4)
) AS t(code, name_ar, name_en, is_external, ord)
ON CONFLICT DO NOTHING;

-- uniqueness for instructor_types(code) per college (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS instructor_types_college_code_uq
  ON public.instructor_types (college_id, code);

-- ============ Seed room_types per college ============
INSERT INTO public.room_types (college_id, code, name_ar, name_en, default_capacity, display_order, is_active)
SELECT c.id, t.code, t.name_ar, t.name_en, t.cap, t.ord, true
FROM public.colleges c
CROSS JOIN (VALUES
  ('lecture_hall',     'قاعة محاضرات',         'Lecture Hall',       60, 1),
  ('computer_lab',     'مختبر حاسوب',          'Computer Lab',       30, 2),
  ('networking_lab',   'مختبر شبكات',          'Networking Lab',     25, 3),
  ('cybersecurity_lab','مختبر أمن سيبراني',    'Cybersecurity Lab',  25, 4),
  ('electronics_lab',  'مختبر إلكترونيات',     'Electronics Lab',    25, 5),
  ('workshop',         'ورشة',                 'Workshop',           20, 6),
  ('seminar_room',     'قاعة ندوات',           'Seminar Room',       40, 7)
) AS t(code, name_ar, name_en, cap, ord)
ON CONFLICT DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS room_types_college_code_uq
  ON public.room_types (college_id, code);

-- ============ room_availability (positive availability) ============
CREATE TABLE IF NOT EXISTS public.room_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  room_id uuid NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_availability TO authenticated;
GRANT ALL ON public.room_availability TO service_role;

ALTER TABLE public.room_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY ra_select ON public.room_availability FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY ra_insert ON public.room_availability FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ra_update ON public.room_availability FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ra_delete ON public.room_availability FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

-- college consistency trigger (room must belong to same college)
CREATE OR REPLACE FUNCTION public.ensure_ra_college()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE rc uuid;
BEGIN
  SELECT college_id INTO rc FROM public.rooms WHERE id = NEW.room_id;
  IF rc IS NULL OR rc <> NEW.college_id THEN
    RAISE EXCEPTION 'room/college mismatch';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ra_college ON public.room_availability;
CREATE TRIGGER trg_ra_college BEFORE INSERT OR UPDATE ON public.room_availability
  FOR EACH ROW EXECUTE FUNCTION public.ensure_ra_college();

DROP TRIGGER IF EXISTS trg_ra_updated_at ON public.room_availability;
CREATE TRIGGER trg_ra_updated_at BEFORE UPDATE ON public.room_availability
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS ra_room_day_idx
  ON public.room_availability (room_id, day_of_week);

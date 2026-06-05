-- 1) time_slot_templates
CREATE TABLE IF NOT EXISTS public.time_slot_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  study_system text NOT NULL DEFAULT 'regular',
  day_of_week smallint NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  slot_duration_minutes integer NOT NULL DEFAULT 60,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tst_study_system_check CHECK (study_system IN ('regular','parallel','both')),
  CONSTRAINT tst_day_check CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT tst_time_check CHECK (end_time > start_time),
  CONSTRAINT tst_duration_check CHECK (slot_duration_minutes BETWEEN 15 AND 480)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_slot_templates TO authenticated;
GRANT ALL ON public.time_slot_templates TO service_role;

ALTER TABLE public.time_slot_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY tst_select ON public.time_slot_templates FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY tst_insert ON public.time_slot_templates FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY tst_update ON public.time_slot_templates FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY tst_delete ON public.time_slot_templates FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE INDEX IF NOT EXISTS idx_tst_college_system_day
  ON public.time_slot_templates(college_id, study_system, day_of_week);

CREATE TRIGGER trg_tst_updated_at BEFORE UPDATE ON public.time_slot_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) instructor_availability.is_preference
ALTER TABLE public.instructor_availability
  ADD COLUMN IF NOT EXISTS is_preference boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_ia_instructor_preference
  ON public.instructor_availability(instructor_id, is_preference);
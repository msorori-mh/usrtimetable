ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS study_system text NOT NULL DEFAULT 'regular';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'departments_study_system_check'
  ) THEN
    ALTER TABLE public.departments
      ADD CONSTRAINT departments_study_system_check
      CHECK (study_system IN ('regular','parallel','both'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_departments_study_system
  ON public.departments(college_id, study_system);
ALTER TABLE public.course_offerings
  ADD COLUMN study_system text NOT NULL DEFAULT 'regular'
  CHECK (study_system IN ('regular','parallel','both'));

ALTER TABLE public.sections
  ADD COLUMN study_system text NOT NULL DEFAULT 'regular'
  CHECK (study_system IN ('regular','parallel','both'));

CREATE INDEX IF NOT EXISTS idx_course_offerings_study_system ON public.course_offerings(study_system);
CREATE INDEX IF NOT EXISTS idx_sections_study_system ON public.sections(study_system);
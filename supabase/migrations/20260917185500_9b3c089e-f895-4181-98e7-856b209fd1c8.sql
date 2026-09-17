ALTER TABLE public.instructors
  ADD COLUMN IF NOT EXISTS max_attendance_days_per_week smallint;

ALTER TABLE public.instructors
  DROP CONSTRAINT IF EXISTS instructors_max_attendance_days_per_week_range;

ALTER TABLE public.instructors
  ADD CONSTRAINT instructors_max_attendance_days_per_week_range
  CHECK (max_attendance_days_per_week IS NULL OR (max_attendance_days_per_week BETWEEN 1 AND 6));

COMMENT ON COLUMN public.instructors.max_attendance_days_per_week IS
  'Optional hard ceiling override (1..6) for weekly attendance days. Raises the effective cap only; it is never used as a target and does not drive attendance-day compression.';
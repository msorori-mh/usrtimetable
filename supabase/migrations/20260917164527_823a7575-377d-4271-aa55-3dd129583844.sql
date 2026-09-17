ALTER TABLE public.instructors
  ADD COLUMN IF NOT EXISTS target_attendance_days_per_week smallint;

ALTER TABLE public.instructors
  DROP CONSTRAINT IF EXISTS instructors_target_attendance_days_range;

ALTER TABLE public.instructors
  ADD CONSTRAINT instructors_target_attendance_days_range
  CHECK (target_attendance_days_per_week IS NULL
         OR (target_attendance_days_per_week >= 1 AND target_attendance_days_per_week <= 6));

COMMENT ON COLUMN public.instructors.target_attendance_days_per_week IS
  'Explicit weekly attendance-day target (1..6). When set it overrides the generic instructor day-compression preference; instructor_availability hard constraints stay authoritative. Student 4/5-day rules are unaffected.';

-- Phase 10B: Freeze & Operational Controls
ALTER TABLE public.schedule_sessions
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lock_reason text,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS auto_schedule_run_id uuid;

-- Validate allowed values
ALTER TABLE public.schedule_sessions
  DROP CONSTRAINT IF EXISTS schedule_sessions_source_type_chk;
ALTER TABLE public.schedule_sessions
  ADD CONSTRAINT schedule_sessions_source_type_chk
  CHECK (source_type IN ('manual','auto_generated','cloned'));

-- Backfill existing rows (default already 'manual' / false)
UPDATE public.schedule_sessions SET source_type = 'manual' WHERE source_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_ss_run ON public.schedule_sessions(auto_schedule_run_id);
CREATE INDEX IF NOT EXISTS idx_ss_locked ON public.schedule_sessions(schedule_version_id, is_locked);
CREATE INDEX IF NOT EXISTS idx_ss_source ON public.schedule_sessions(schedule_version_id, source_type);

-- Prevent deleting/moving locked sessions via DB-level guard (in addition to app logic).
-- Allow updates only if is_locked stays true OR the user is explicitly toggling lock fields.
CREATE OR REPLACE FUNCTION public.enforce_schedule_session_lock_row()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_locked THEN
      RAISE EXCEPTION 'session % is locked and cannot be deleted', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_locked = true AND NEW.is_locked = true THEN
    -- Only allow editing lock_reason or unlocking; block schedule-affecting changes
    IF (NEW.day_of_week IS DISTINCT FROM OLD.day_of_week
        OR NEW.start_time IS DISTINCT FROM OLD.start_time
        OR NEW.end_time IS DISTINCT FROM OLD.end_time
        OR NEW.room_id IS DISTINCT FROM OLD.room_id
        OR NEW.instructor_id IS DISTINCT FROM OLD.instructor_id) THEN
      RAISE EXCEPTION 'session % is locked; unlock before changing time/room/instructor', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ss_lock_row ON public.schedule_sessions;
CREATE TRIGGER trg_ss_lock_row
  BEFORE UPDATE OR DELETE ON public.schedule_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_schedule_session_lock_row();

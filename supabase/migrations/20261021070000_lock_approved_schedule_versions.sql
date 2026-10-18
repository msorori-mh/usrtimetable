-- H-8 (track C): an approved timetable is locked like a published one.
-- Product decision: changes to an approved (or published) version are made in a NEW DRAFT
-- created from it (clone_schedule_version_current accepts any source status). The
-- approved->review rollback stays available to reviewers; after it the version is editable.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_schedule_session_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
DECLARE st text; vid uuid;
BEGIN
  IF TG_OP = 'DELETE'
     AND coalesce(current_setting('gomufadhala.operational_cleanup', true), '') = 'on'
     AND current_user IN ('postgres', 'service_role') THEN
    RETURN OLD;
  END IF;

  vid := COALESCE(NEW.schedule_version_id, OLD.schedule_version_id);
  SELECT status INTO st FROM public.schedule_versions WHERE id = vid;
  IF st IN ('approved', 'published', 'archived') THEN
    RAISE EXCEPTION 'schedule_sessions are locked: version status is %', st
      USING ERRCODE = 'check_violation', HINT = 'SCHEDULE_VERSION_LOCKED';
  END IF;
  -- A session moved between versions must leave an editable version as well.
  IF TG_OP = 'UPDATE' AND OLD.schedule_version_id IS DISTINCT FROM NEW.schedule_version_id THEN
    SELECT status INTO st FROM public.schedule_versions WHERE id = OLD.schedule_version_id;
    IF st IN ('approved', 'published', 'archived') THEN
      RAISE EXCEPTION 'schedule_sessions are locked: version status is %', st
        USING ERRCODE = 'check_violation', HINT = 'SCHEDULE_VERSION_LOCKED';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $fn$;

COMMIT;

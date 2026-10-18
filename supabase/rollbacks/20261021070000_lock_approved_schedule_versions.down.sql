-- Rollback of 20261021070000_lock_approved_schedule_versions.sql: previous lock (published/archived only).
BEGIN;
CREATE OR REPLACE FUNCTION public.enforce_schedule_session_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE st text; vid uuid;
BEGIN
  IF TG_OP = 'DELETE'
     AND coalesce(current_setting('gomufadhala.operational_cleanup', true), '') = 'on'
     AND current_user IN ('postgres', 'service_role') THEN
    RETURN OLD;
  END IF;

  vid := COALESCE(NEW.schedule_version_id, OLD.schedule_version_id);
  SELECT status INTO st FROM public.schedule_versions WHERE id = vid;
  IF st IN ('published','archived') THEN
    RAISE EXCEPTION 'schedule_sessions are locked: version status is %', st
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$

;
COMMIT;

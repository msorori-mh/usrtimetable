-- Rollback for 20260927_itcs_version_scoped_assignments.sql (only valid before any scoped row is used in a published version).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM assignment_version_private.scope s JOIN public.schedule_versions v ON v.id=s.version_id WHERE v.status<>'draft') THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED_SCOPED_ASSIGNMENTS_PUBLISHED';
  END IF;
  IF EXISTS (SELECT 1 FROM assignment_version_private.scope) THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED_SCOPED_ASSIGNMENTS_EXIST: deactivate them through the official RPC first';
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_guard_session_version_scoped_assignment ON public.schedule_sessions;
DROP TRIGGER IF EXISTS trg_guard_version_scoped_publish ON public.schedule_versions;
DROP FUNCTION IF EXISTS public.guard_session_version_scoped_assignment();
DROP FUNCTION IF EXISTS public.guard_version_scoped_publish();
DROP FUNCTION IF EXISTS public.version_scoped_publish_readiness(uuid);
DROP FUNCTION IF EXISTS public.apply_version_scoped_replacements(uuid,jsonb,integer,integer,text);
DROP FUNCTION IF EXISTS public.create_version_scoped_replacement_assignment(uuid,uuid,uuid,numeric,uuid);
DROP FUNCTION IF EXISTS public.schedule_version_session_snapshot(uuid);
-- Restore the previous global validator body (captured 2026-09-27) BEFORE dropping helpers it references.
-- Paste the pre-change pg_get_functiondef output here during review.
DROP FUNCTION IF EXISTS public.validate_version_assignment_allocation(uuid,uuid,numeric);
DROP FUNCTION IF EXISTS public.version_effective_assignments(uuid);

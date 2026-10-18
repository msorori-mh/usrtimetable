-- Rollback of 20261021050000_schedule_session_integrity_guard.sql (restores client DML; the
-- client in this branch no longer uses it).
BEGIN;
DROP TRIGGER IF EXISTS schedule_sessions_hard_rules_insert ON public.schedule_sessions;
DROP TRIGGER IF EXISTS schedule_sessions_hard_rules_update ON public.schedule_sessions;
DROP FUNCTION IF EXISTS public.enforce_schedule_session_hard_rules();
GRANT INSERT, UPDATE, DELETE ON public.schedule_sessions TO authenticated;
COMMIT;

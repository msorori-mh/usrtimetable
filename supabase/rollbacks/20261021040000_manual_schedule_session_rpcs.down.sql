-- Rollback of 20261021040000_manual_schedule_session_rpcs.sql.
BEGIN;
DROP FUNCTION IF EXISTS public.delete_schedule_session(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.save_manual_schedule_session(uuid, timestamptz, jsonb);
DROP FUNCTION IF EXISTS public.preview_manual_schedule_session(uuid, jsonb);
DROP FUNCTION IF EXISTS public._sv_manual_session_evaluate(uuid, jsonb);
COMMIT;

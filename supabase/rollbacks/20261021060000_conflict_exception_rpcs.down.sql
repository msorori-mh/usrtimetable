-- Rollback of 20261021060000_conflict_exception_rpcs.sql.
BEGIN;
DROP TRIGGER IF EXISTS trg_svce_integrity ON public.schedule_version_conflict_exceptions;
DROP FUNCTION IF EXISTS public.enforce_conflict_exception_integrity();
DROP FUNCTION IF EXISTS public.revoke_conflict_exception(uuid, text);
DROP FUNCTION IF EXISTS public.approve_conflict_exception(uuid, text, uuid, uuid, text, text, text, jsonb);
GRANT INSERT, UPDATE ON public.schedule_version_conflict_exceptions TO authenticated;
COMMIT;

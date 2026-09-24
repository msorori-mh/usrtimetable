-- Full-draft relayout validates every session before committing atomically.
-- The authenticated role's 8s default can cancel this check and roll back all moves.
-- Scope the budget to this RPC; keep role timeouts, authorization and guards unchanged.
ALTER FUNCTION public.apply_schedule_relayout(uuid, uuid, uuid, bigint, timestamptz, jsonb, integer)
  SET statement_timeout = '60s';
NOTIFY pgrst, 'reload schema';

-- Rollback: ALTER FUNCTION public.apply_schedule_relayout(uuid, uuid, uuid, bigint, timestamptz, jsonb, integer) RESET statement_timeout;

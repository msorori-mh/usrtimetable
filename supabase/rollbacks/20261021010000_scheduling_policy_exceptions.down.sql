-- Rollback of 20261021010000_scheduling_policy_exceptions.sql (apply after the later track C rollbacks).
BEGIN;
DROP FUNCTION IF EXISTS public.schedule_version_published_at(uuid);
DROP FUNCTION IF EXISTS public.physical_room_group_sizes();
DROP TABLE IF EXISTS public.scheduling_policy_exceptions;
DROP FUNCTION IF EXISTS public.enforce_scheduling_policy_exception_approver();
ALTER TABLE public.rooms DROP COLUMN IF EXISTS physical_group_key;
ALTER TABLE public.schedule_versions DROP COLUMN IF EXISTS protected;
ALTER TABLE public.schedule_versions DROP COLUMN IF EXISTS published_at;
COMMIT;

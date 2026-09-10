-- LAUNCH-CLOSURE-03 ROLLBACK for
-- supabase/migrations/20260910002500_availability_temporal_integrity_and_bulk_rpc.sql
--
-- Reverts every object the migration creates. Destroys NO data: no DELETE, no TRUNCATE,
-- no DROP TABLE, no DROP COLUMN. Policies and grants on tables are untouched because the
-- migration never changed them.
--
-- Order matters: the exclusion constraints depend on the _avail_* helper functions, so the
-- constraints must go first.

BEGIN;

ALTER TABLE public.room_unavailability
  DROP CONSTRAINT IF EXISTS room_unavailability_no_overlap;
ALTER TABLE public.instructor_availability
  DROP CONSTRAINT IF EXISTS instructor_availability_no_overlap;

DROP TRIGGER IF EXISTS trg_ru_validate_window ON public.room_unavailability;
DROP FUNCTION IF EXISTS public.validate_room_unavailability_window();

DROP FUNCTION IF EXISTS public.upsert_room_unavailability_for_active_days(uuid, time, time, text, date, date, int);
DROP FUNCTION IF EXISTS public.upsert_instructor_unavailability_for_active_days(uuid, time, time, text, int);
DROP FUNCTION IF EXISTS public._availability_active_working_days(uuid);

DROP FUNCTION IF EXISTS public._avail_time_span(time, time);
DROP FUNCTION IF EXISTS public._avail_day_span(smallint);
DROP FUNCTION IF EXISTS public._avail_date_span(date, date);

COMMIT;

-- btree_gist is intentionally LEFT INSTALLED: dropping an extension can cascade to
-- unrelated objects and is not required to restore prior behaviour.
--
-- After rollback the client falls back to its in-app validation path
-- (src/lib/availability/bulk-api.ts), which restores pre-migration behaviour but does
-- NOT prevent concurrent overlapping writes.

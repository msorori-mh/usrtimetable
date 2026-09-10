-- LAUNCH-CLOSURE-02 — PROPOSAL ONLY. NOT APPLIED. DO NOT RUN IN PRODUCTION.
--
-- Purpose: make availability correctness durable on the server instead of relying
-- on the client fallback. Two independent parts; part B is the only way to make
-- concurrent overlap insertion impossible.
--
-- Evidence this is currently missing (read-only checks run 2026-09-10):
--   1. pg_proc has NO upsert_instructor_unavailability_for_active_days and NO
--      upsert_room_unavailability_for_active_days  → every RPC call 404s.
--   2. pg_constraint on public.instructor_availability and public.room_unavailability
--      shows only: PK(id), CHECK(end_time > start_time) [instructor only],
--      CHECK(day_of_week 0..6), FK room_id → rooms(id).
--      There is NO unique or exclusion constraint on (resource, weekday, time range)
--      → overlapping/duplicate rows are NOT prevented at rest, by any code path.
--   3. Cross-college consistency IS already enforced by triggers
--      trg_ia_college → ensure_ia_college() and trg_ru_college → ensure_ru_college(),
--      which raise 'instructor/college mismatch' / 'room/college mismatch'.
--
-- ---------------------------------------------------------------------------
-- PREFLIGHT (run read-only, must all pass before applying)
-- ---------------------------------------------------------------------------
-- P1 no pre-existing overlaps would violate the new exclusion constraints:
--   SELECT a.id, b.id FROM public.instructor_availability a
--   JOIN public.instructor_availability b
--     ON a.id < b.id AND a.instructor_id = b.instructor_id
--    AND a.college_id = b.college_id AND a.day_of_week = b.day_of_week
--    AND a.is_preference = b.is_preference
--    AND a.start_time < b.end_time AND b.start_time < a.end_time;
--   -- expected: 0 rows (otherwise remediate data first; do NOT weaken the constraint)
--   SELECT a.id, b.id FROM public.room_unavailability a
--   JOIN public.room_unavailability b
--     ON a.id < b.id AND a.room_id = b.room_id AND a.college_id = b.college_id
--    AND a.day_of_week = b.day_of_week
--    AND a.start_time IS NOT NULL AND b.start_time IS NOT NULL
--    AND a.start_date IS NOT DISTINCT FROM b.start_date
--    AND a.end_date IS NOT DISTINCT FROM b.end_date
--    AND a.start_time < b.end_time AND b.start_time < a.end_time;
--   -- expected: 0 rows
-- P2 btree_gist availability:  SELECT * FROM pg_available_extensions WHERE name='btree_gist';
-- P3 no name collision:  SELECT proname FROM pg_proc WHERE proname LIKE 'upsert_%unavailability_for_active_days';
--   -- expected: 0 rows. If >0 rows with different signatures, DROP the stale ones
--   -- first: a second overload makes every call fail with PGRST203 (ambiguous).
--
-- ---------------------------------------------------------------------------
-- PART A — deploy the authoritative functions (verbatim source of truth)
-- ---------------------------------------------------------------------------
-- Apply the reviewed body of
--   supabase/migrations/20260720120000_source_only_availability_all_active_days.sql
-- unchanged, so exactly one overload exists per function.
-- Post-apply check:
--   SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc
--   WHERE proname LIKE 'upsert_%unavailability_for_active_days';
--   -- expected: exactly 2 rows, one signature each.
--
-- ---------------------------------------------------------------------------
-- PART B — enforce overlap uniqueness at rest (the only real concurrency fix)
-- ---------------------------------------------------------------------------
BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Instructor hard unavailability: one resource cannot hold two overlapping
-- windows on the same weekday within the same preference class.
ALTER TABLE public.instructor_availability
  ADD CONSTRAINT instructor_availability_no_overlap
  EXCLUDE USING gist (
    instructor_id WITH =,
    college_id WITH =,
    day_of_week WITH =,
    is_preference WITH =,
    timerange(start_time, end_time, '[)') WITH &&
  );

-- Room unavailability: same weekday, same validity window, overlapping times.
-- Rows with a NULL time are whole-day closures and are excluded from the range
-- comparison; they are covered by the partial unique index below.
ALTER TABLE public.room_unavailability
  ADD CONSTRAINT room_unavailability_no_overlap
  EXCLUDE USING gist (
    room_id WITH =,
    college_id WITH =,
    day_of_week WITH =,
    coalesce(start_date, '-infinity'::date) WITH =,
    coalesce(end_date, 'infinity'::date) WITH =,
    timerange(start_time, end_time, '[)') WITH &&
  ) WHERE (start_time IS NOT NULL AND end_time IS NOT NULL AND day_of_week IS NOT NULL);

CREATE UNIQUE INDEX room_unavailability_all_day_unique
  ON public.room_unavailability (
    room_id, college_id,
    coalesce(day_of_week, -1),
    coalesce(start_date, '-infinity'::date),
    coalesce(end_date, 'infinity'::date)
  )
  WHERE (start_time IS NULL OR end_time IS NULL);

-- room_unavailability lacks the end_time > start_time guard its sibling table has.
ALTER TABLE public.room_unavailability
  ADD CONSTRAINT room_unavailability_time_order
  CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time);

COMMIT;

-- ---------------------------------------------------------------------------
-- POST-APPLY TESTS (expected results stated; run in a transaction and ROLLBACK)
-- ---------------------------------------------------------------------------
-- T1 duplicate window rejected:      second identical INSERT → 23P01 exclusion_violation
-- T2 overlapping window rejected:    10:00-12:00 then 11:00-13:00 → 23P01
-- T3 adjacent window accepted:       10:00-12:00 then 12:00-13:00 → OK ('[)' bounds)
-- T4 disjoint date windows accepted: same weekday/time, Jan vs May → OK (not duplicates)
-- T5 duplicate all-day closure rejected → 23505 unique_violation
-- T6 concurrency: two sessions, both INSERT 10:00-12:00 for the same room/day,
--    commit order A then B → B fails with 23P01. This is the case the client
--    fallback cannot prevent.
-- T7 cross-college write still rejected by the existing triggers
--    (ensure_ia_college / ensure_ru_college) → 'instructor/college mismatch'.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- BEGIN;
--   ALTER TABLE public.room_unavailability DROP CONSTRAINT room_unavailability_time_order;
--   DROP INDEX IF EXISTS public.room_unavailability_all_day_unique;
--   ALTER TABLE public.room_unavailability DROP CONSTRAINT room_unavailability_no_overlap;
--   ALTER TABLE public.instructor_availability DROP CONSTRAINT instructor_availability_no_overlap;
--   DROP FUNCTION IF EXISTS public.upsert_room_unavailability_for_active_days(uuid, time, time, text, date, date, int);
--   DROP FUNCTION IF EXISTS public.upsert_instructor_unavailability_for_active_days(uuid, time, time, text, int);
--   DROP FUNCTION IF EXISTS public._availability_active_working_days(uuid);
--   DROP FUNCTION IF EXISTS public._availability_times_overlap(time, time, time, time);
-- COMMIT;
-- btree_gist is left installed; dropping it is unnecessary and affects other objects.
--
-- Note: PART B changes behaviour for existing data. It must not be applied until
-- P1 returns zero rows on production, and the client error mapping must surface
-- 23P01 / 23505 as the Arabic overlap message before it lands.

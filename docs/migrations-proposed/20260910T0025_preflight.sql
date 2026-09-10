-- LAUNCH-CLOSURE-03 PREFLIGHT — READ ONLY. Run before applying
-- supabase/migrations/20260910002500_availability_temporal_integrity_and_bulk_rpc.sql
--
-- EVERY check below must report ok = true (or zero rows). If any fails, DO NOT APPLY:
-- remediate the data or the naming collision first. Do not weaken the constraints.

-- P0 — btree_gist is installable/installed.
SELECT 'P0 btree_gist available' AS check,
       EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist') AS ok;

-- P1 — no NAME COLLISION on the objects this migration creates.
--      Existing overloads of the upsert functions with a DIFFERENT signature must be
--      dropped first: a second overload makes every PostgREST call fail with PGRST203.
SELECT 'P1 function signatures' AS check, p.proname,
       pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef AS security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'upsert_instructor_unavailability_for_active_days',
    'upsert_room_unavailability_for_active_days',
    '_availability_active_working_days',
    '_avail_time_span', '_avail_day_span', '_avail_date_span',
    'validate_room_unavailability_window'
  )
ORDER BY p.proname;
-- Expected: at most the four legacy names, each with exactly ONE signature. Two rows
-- for the same proname => drop the stale overload before applying.

SELECT 'P1b constraint name collision' AS check, conname, conrelid::regclass AS tbl
FROM pg_constraint
WHERE conname IN ('instructor_availability_no_overlap', 'room_unavailability_no_overlap');
-- Expected: 0 rows (the migration is idempotent, but a same-named DIFFERENT constraint
-- would be silently kept).

-- P2 — no existing row would violate the room validation trigger.
SELECT 'P2 room half-specified time window' AS check, id, room_id, start_time, end_time
FROM public.room_unavailability
WHERE (start_time IS NULL) <> (end_time IS NULL);
-- Expected: 0 rows

SELECT 'P2b room inverted time' AS check, id, room_id, start_time, end_time
FROM public.room_unavailability
WHERE start_time IS NOT NULL AND end_time IS NOT NULL AND end_time <= start_time;
-- Expected: 0 rows

SELECT 'P2c room inverted date window' AS check, id, room_id, start_date, end_date
FROM public.room_unavailability
WHERE start_date IS NOT NULL AND end_date IS NOT NULL AND end_date < start_date;
-- Expected: 0 rows

-- P3 — no existing PAIR would violate the instructor exclusion constraint.
--      Uses the identical range predicate the constraint will use.
SELECT 'P3 instructor overlaps' AS check,
       a.id AS id_a, b.id AS id_b, a.instructor_id, a.day_of_week,
       a.start_time AS a_start, a.end_time AS a_end,
       b.start_time AS b_start, b.end_time AS b_end
FROM public.instructor_availability a
JOIN public.instructor_availability b
  ON a.id < b.id
 AND a.instructor_id = b.instructor_id
 AND a.college_id    = b.college_id
 AND a.day_of_week   = b.day_of_week
WHERE a.availability_type = 'unavailable' AND a.is_preference = false
  AND b.availability_type = 'unavailable' AND b.is_preference = false
  AND tsrange('2000-01-01'::date + a.start_time, '2000-01-01'::date + a.end_time, '[)')
   && tsrange('2000-01-01'::date + b.start_time, '2000-01-01'::date + b.end_time, '[)');
-- Expected: 0 rows

-- P4 — no existing PAIR would violate the room exclusion constraint.
SELECT 'P4 room overlaps' AS check,
       a.id AS id_a, b.id AS id_b, a.room_id,
       a.day_of_week AS a_dow, b.day_of_week AS b_dow,
       a.start_date AS a_from, a.end_date AS a_to,
       b.start_date AS b_from, b.end_date AS b_to,
       a.start_time AS a_start, a.end_time AS a_end,
       b.start_time AS b_start, b.end_time AS b_end
FROM public.room_unavailability a
JOIN public.room_unavailability b
  ON a.id < b.id
 AND a.room_id    = b.room_id
 AND a.college_id = b.college_id
WHERE int4range(coalesce(a.day_of_week::int, 0), coalesce(a.day_of_week::int, 6), '[]')
   && int4range(coalesce(b.day_of_week::int, 0), coalesce(b.day_of_week::int, 6), '[]')
  AND daterange(a.start_date, a.end_date, '[]') && daterange(b.start_date, b.end_date, '[]')
  AND tsrange('2000-01-01'::date + coalesce(a.start_time, '00:00'::time),
              '2000-01-01'::date + coalesce(a.end_time,   '24:00'::time), '[)')
   && tsrange('2000-01-01'::date + coalesce(b.start_time, '00:00'::time),
              '2000-01-01'::date + coalesce(b.end_time,   '24:00'::time), '[)');
-- Expected: 0 rows

-- P5 — RLS/isolation surface unchanged expectations (informational; the migration
--      creates no policy and no grant on any table).
SELECT 'P5 policies' AS check, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('instructor_availability', 'room_unavailability')
ORDER BY tablename, policyname;
-- Expected: the existing ia_* / ru_* policies only, TO authenticated,
-- can_manage_college for write and can_view_college for read.

-- P6 — baseline row counts, to compare after apply (apply must not change them).
SELECT 'P6 counts' AS check,
       (SELECT count(*) FROM public.instructor_availability) AS instructor_rows,
       (SELECT count(*) FROM public.room_unavailability)     AS room_rows;

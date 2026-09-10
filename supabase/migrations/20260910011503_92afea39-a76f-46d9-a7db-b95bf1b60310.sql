-- LAUNCH-CLOSURE-03
-- Availability temporal integrity + authoritative bulk unavailability RPCs.
--
-- STATUS: EXECUTABLE, PROVEN ON AN ISOLATED DISPOSABLE POSTGRES, **NOT APPLIED TO PRODUCTION**.
--   Preflight : docs/migrations-proposed/20260910T0025_preflight.sql   (must return zero rows / all ok)
--   Rollback  : docs/migrations-proposed/20260910T0025_rollback.sql
--   Proof     : scripts/local-db/availability-temporal-integrity-proof.sh
--
-- The `supabase migrations` CLI is not installed in this environment and
-- supabase/migrations/ is managed by the platform migration tool, so this file is the
-- authoritative executable artifact. Apply it VERBATIM through the migration tool once
-- the preflight passes on production.
--
-- Supersedes docs/migrations-proposed/20260910T0000_availability_bulk_rpc_and_overlap_integrity.sql,
-- which was rejected in review for four substantive defects. All four are corrected here:
--
--   D1. `timerange` is NOT a built-in Postgres range type and was never defined.
--       FIX: time-of-day spans are expressed as `tsrange` anchored on a fixed calendar
--            date (2000-01-01), a built-in type with native GiST `&&` support.
--            `time '24:00:00'` is legal in Postgres, so an open-ended day maps to the
--            anchor's next midnight. The mapping is IMMUTABLE, so it is index-safe.
--   D2. Room equality on start_date/end_date (`WITH =`) let two OVERLAPPING but UNEQUAL
--       validity windows coexist (e.g. Jan01–Mar31 vs Feb01–Apr30, same weekday/time).
--       FIX: the validity window is compared as a `daterange` with `&&`. NULL bounds are
--            unbounded, so an open-ended closure overlaps every window.
--   D3. A partial unique index on whole-day closures could not prevent a whole-day
--       closure from conflicting with a TIMED row, nor an ALL-WEEK row (day_of_week NULL)
--       from conflicting with a specific weekday.
--       FIX: both dimensions are normalised into ranges inside ONE exclusion constraint:
--            NULL times   -> 00:00–24:00 (the whole day)
--            NULL weekday -> int4range(0,6,'[]') (every weekday)
--            so whole-day/all-week rows overlap timed/single-day rows by construction.
--            No partial unique index is needed and none is created.
--   D4. The instructor constraint spanned every availability class, so it would have
--       rejected legitimate soft PREFERENCES and 'available' declarations.
--       FIX: the instructor exclusion constraint is PARTIAL, scoped to hard
--            unavailability only: availability_type = 'unavailable' AND is_preference = false.
--            Preference/available rows are deliberately left unconstrained.
--
-- Additional review requirements honoured:
--   * The RPCs below are NOT a verbatim replay of the stale July source-only migration
--     20260720120000_source_only_availability_all_active_days.sql. That source contains the
--     same blind spots the client fallback was faulted for: its room overlap probe ignores
--     the date window entirely and skips rows with NULL times, so a whole-day closure was
--     invisible and disjoint windows were treated as conflicts. The probes here use the
--     SAME range predicates as the exclusion constraints, so function and constraint agree.
--   * No SECURITY DEFINER anywhere. Every function is SECURITY INVOKER, so all reads and
--     writes remain subject to the existing RLS policies and college isolation
--     (can_manage_college / can_view_college) instead of bypassing them. This is a
--     deliberate tightening: the July source made all three functions SECURITY DEFINER.
--   * Least privilege: EXECUTE revoked from PUBLIC and anon, granted to authenticated and
--     service_role only. No table grant is widened. No policy is created, altered or dropped.
--   * The exclusion constraints are the ONLY race-proof layer: they hold across every write
--     path (RPC, direct PostgREST insert, SQL, import) and across concurrent transactions,
--     which no client-side or per-statement check can do.

BEGIN;

-- btree_gist supplies the `=` GiST operator classes for uuid and smallint columns.
-- Range types (`tsrange`, `daterange`, `int4range`) already have native GiST `&&` support.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Temporal normalisation helpers (IMMUTABLE => usable in index expressions)
-- ---------------------------------------------------------------------------

-- Time-of-day span. NULL start => 00:00, NULL end => 24:00 (whole day).
-- Half-open '[)' so 10:00–12:00 and 12:00–13:00 are ADJACENT, not overlapping.
CREATE OR REPLACE FUNCTION public._avail_time_span(p_start time, p_end time)
RETURNS tsrange
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  SELECT tsrange(
    '2000-01-01'::date + coalesce(p_start, '00:00:00'::time),
    '2000-01-01'::date + coalesce(p_end,   '24:00:00'::time),
    '[)'
  );
$fn$;

-- Weekday span. NULL weekday means "every weekday" and therefore overlaps any single day.
CREATE OR REPLACE FUNCTION public._avail_day_span(p_day_of_week smallint)
RETURNS int4range
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  SELECT CASE
    WHEN p_day_of_week IS NULL THEN int4range(0, 6, '[]')
    ELSE int4range(p_day_of_week::int, p_day_of_week::int, '[]')
  END;
$fn$;

-- Validity window. NULL bounds are unbounded (open-ended closure overlaps everything).
CREATE OR REPLACE FUNCTION public._avail_date_span(p_start_date date, p_end_date date)
RETURNS daterange
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  SELECT daterange(p_start_date, p_end_date, '[]');
$fn$;

REVOKE ALL ON FUNCTION public._avail_time_span(time, time) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._avail_day_span(smallint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._avail_date_span(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._avail_time_span(time, time) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._avail_day_span(smallint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._avail_date_span(date, date) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Durable field validation on EVERY write path
-- room_unavailability has no time-ordering guard at all today, and nothing stops a
-- half-specified window (one time set, the other NULL) or an inverted date range.
-- A trigger is used rather than CHECK constraints so the rules stay maintainable and
-- report a single actionable message per row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_room_unavailability_window()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF (NEW.start_time IS NULL) <> (NEW.end_time IS NULL) THEN
    RAISE EXCEPTION
      'invalid_time_range: start_time and end_time must both be set, or both be NULL for a whole-day closure'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.start_time IS NOT NULL AND NEW.end_time <= NEW.start_time THEN
    RAISE EXCEPTION 'invalid_time_range: end_time must be after start_time'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.start_date IS NOT NULL AND NEW.end_date IS NOT NULL AND NEW.end_date < NEW.start_date THEN
    RAISE EXCEPTION 'invalid_date_range: end_date must not be before start_date'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_ru_validate_window ON public.room_unavailability;
CREATE TRIGGER trg_ru_validate_window
  BEFORE INSERT OR UPDATE ON public.room_unavailability
  FOR EACH ROW EXECUTE FUNCTION public.validate_room_unavailability_window();

-- ---------------------------------------------------------------------------
-- Race-proof overlap integrity
-- ---------------------------------------------------------------------------

-- Instructor: HARD unavailability only (D4). Preferences and 'available' rows untouched.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'instructor_availability_no_overlap'
      AND conrelid = 'public.instructor_availability'::regclass
  ) THEN
    ALTER TABLE public.instructor_availability
      ADD CONSTRAINT instructor_availability_no_overlap
      EXCLUDE USING gist (
        instructor_id WITH =,
        college_id WITH =,
        day_of_week WITH =,
        public._avail_time_span(start_time, end_time) WITH &&
      )
      WHERE (availability_type = 'unavailable' AND is_preference = false);
  END IF;
END
$do$;

-- Room: one constraint covering weekday span, validity window and time span (D2 + D3).
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'room_unavailability_no_overlap'
      AND conrelid = 'public.room_unavailability'::regclass
  ) THEN
    ALTER TABLE public.room_unavailability
      ADD CONSTRAINT room_unavailability_no_overlap
      EXCLUDE USING gist (
        room_id WITH =,
        college_id WITH =,
        public._avail_day_span(day_of_week) WITH &&,
        public._avail_date_span(start_date, end_date) WITH &&,
        public._avail_time_span(start_time, end_time) WITH &&
      );
  END IF;
END
$do$;

COMMENT ON CONSTRAINT instructor_availability_no_overlap ON public.instructor_availability IS
  'LAUNCH-CLOSURE-03: no two HARD unavailability windows may overlap for the same instructor/college/weekday. Adjacent windows are allowed. Preferences and available rows are excluded.';
COMMENT ON CONSTRAINT room_unavailability_no_overlap ON public.room_unavailability IS
  'LAUNCH-CLOSURE-03: no two closures may overlap for the same room/college once weekday (NULL = all week), validity window (NULL = unbounded) and time-of-day (NULL = whole day) are normalised to ranges.';

-- ---------------------------------------------------------------------------
-- Operational calendar helper (SECURITY INVOKER: reads through the caller's RLS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._availability_active_working_days(p_college_id uuid)
RETURNS int[]
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_days int[];
BEGIN
  SELECT ARRAY(
    SELECT DISTINCT d::int
    FROM unnest(coalesce(s.working_days, ARRAY[6, 0, 1, 2, 3, 4]::int[])) AS d
    WHERE d BETWEEN 0 AND 6
    ORDER BY 1
  )
  INTO v_days
  FROM public.scheduling_settings s
  WHERE s.college_id = p_college_id;

  IF v_days IS NULL OR cardinality(v_days) = 0 THEN
    v_days := ARRAY[6, 0, 1, 2, 3, 4]::int[]; -- السبت..الخميس (الجمعة غير مفعلة افتراضياً)
  END IF;
  RETURN v_days;
END;
$fn$;

REVOKE ALL ON FUNCTION public._availability_active_working_days(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._availability_active_working_days(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Instructor HARD unavailability bulk upsert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_instructor_unavailability_for_active_days(
  p_instructor_id uuid,
  p_start_time time,
  p_end_time time,
  p_notes text DEFAULT NULL,
  p_day_of_week int DEFAULT NULL -- NULL = all active working days; 0..6 = single day
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_college uuid;
  v_active boolean;
  v_days int[];
  v_day int;
  v_created int := 0;
  v_unchanged int := 0;
  v_exists boolean;
  v_conflict_start time;
  v_conflict_end time;
  v_type constant text := 'unavailable';
  v_pref constant boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_instructor_id IS NULL OR p_start_time IS NULL OR p_end_time IS NULL THEN
    RAISE EXCEPTION 'instructor_id, start_time and end_time are required' USING ERRCODE = '22023';
  END IF;
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'invalid_time_range: end_time must be after start_time' USING ERRCODE = '22023';
  END IF;

  SELECT i.college_id, i.is_active INTO v_college, v_active
  FROM public.instructors i WHERE i.id = p_instructor_id;

  IF v_college IS NULL THEN
    RAISE EXCEPTION 'instructor not found' USING ERRCODE = '22023';
  END IF;
  IF v_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'instructor is not active' USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_manage_college(v_actor, v_college) THEN
    RAISE EXCEPTION 'college access denied' USING ERRCODE = '42501';
  END IF;

  IF p_day_of_week IS NULL THEN
    v_days := public._availability_active_working_days(v_college);
  ELSIF p_day_of_week < 0 OR p_day_of_week > 6 THEN
    RAISE EXCEPTION 'invalid day_of_week: %', p_day_of_week USING ERRCODE = '22023';
  ELSE
    v_days := ARRAY[p_day_of_week]::int[];
  END IF;

  IF cardinality(v_days) = 0 THEN
    RAISE EXCEPTION 'no active working days configured' USING ERRCODE = '22023';
  END IF;

  -- Pre-validate EVERY target day before any DML (all-or-nothing for the request).
  FOREACH v_day IN ARRAY v_days LOOP
    SELECT ia.start_time, ia.end_time INTO v_conflict_start, v_conflict_end
    FROM public.instructor_availability ia
    WHERE ia.instructor_id = p_instructor_id
      AND ia.college_id = v_college
      AND ia.day_of_week = v_day::smallint
      AND ia.availability_type = v_type
      AND ia.is_preference = v_pref
      AND public._avail_time_span(ia.start_time, ia.end_time)
          && public._avail_time_span(p_start_time, p_end_time)
      AND NOT (ia.start_time = p_start_time AND ia.end_time = p_end_time)
    LIMIT 1;

    IF v_conflict_start IS NOT NULL THEN
      RAISE EXCEPTION 'availability_overlap: day=% existing=%–% proposed=%–%',
        v_day,
        to_char(v_conflict_start, 'HH24:MI'), to_char(v_conflict_end, 'HH24:MI'),
        to_char(p_start_time, 'HH24:MI'), to_char(p_end_time, 'HH24:MI')
        USING ERRCODE = '23P01';
    END IF;
  END LOOP;

  FOREACH v_day IN ARRAY v_days LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.instructor_availability ia
      WHERE ia.instructor_id = p_instructor_id
        AND ia.college_id = v_college
        AND ia.day_of_week = v_day::smallint
        AND ia.start_time = p_start_time
        AND ia.end_time = p_end_time
        AND ia.availability_type = v_type
        AND ia.is_preference = v_pref
    ) INTO v_exists;

    IF v_exists THEN
      v_unchanged := v_unchanged + 1;
    ELSE
      INSERT INTO public.instructor_availability (
        college_id, instructor_id, day_of_week, start_time, end_time,
        availability_type, is_preference, notes
      ) VALUES (
        v_college, p_instructor_id, v_day::smallint, p_start_time, p_end_time,
        v_type, v_pref, nullif(trim(p_notes), '')
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (college_id, actor_id, action, entity, entity_id, details)
  VALUES (
    v_college, v_actor, 'create', 'instructor_unavailability', p_instructor_id,
    jsonb_build_object(
      'mode', CASE WHEN p_day_of_week IS NULL THEN 'all_active_days' ELSE 'single_day' END,
      'days', to_jsonb(v_days),
      'days_created', v_created,
      'days_unchanged', v_unchanged,
      'start_time', p_start_time,
      'end_time', p_end_time,
      'constraint_kind', 'hard_unavailability'
    )
  );

  RETURN jsonb_build_object(
    'status', 'ok',
    'resource', 'instructor_unavailability',
    'college_id', v_college,
    'days_targeted', v_days,
    'days_created', v_created,
    'days_unchanged', v_unchanged
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.upsert_instructor_unavailability_for_active_days(uuid, time, time, text, int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_instructor_unavailability_for_active_days(uuid, time, time, text, int)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Room HARD unavailability bulk upsert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_room_unavailability_for_active_days(
  p_room_id uuid,
  p_start_time time,
  p_end_time time,
  p_reason text DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL,
  p_day_of_week int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_college uuid;
  v_active boolean;
  v_days int[];
  v_day int;
  v_created int := 0;
  v_unchanged int := 0;
  v_exists boolean;
  v_conflict_id uuid;
  v_conflict_day smallint;
  v_conflict_start time;
  v_conflict_end time;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_room_id IS NULL OR p_start_time IS NULL OR p_end_time IS NULL THEN
    RAISE EXCEPTION 'room_id, start_time and end_time are required' USING ERRCODE = '22023';
  END IF;
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'invalid_time_range: end_time must be after start_time' USING ERRCODE = '22023';
  END IF;
  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL AND p_end_date < p_start_date THEN
    RAISE EXCEPTION 'invalid_date_range: end_date must not be before start_date' USING ERRCODE = '22023';
  END IF;

  SELECT r.college_id, r.is_active INTO v_college, v_active
  FROM public.rooms r WHERE r.id = p_room_id;

  IF v_college IS NULL THEN
    RAISE EXCEPTION 'room not found' USING ERRCODE = '22023';
  END IF;
  IF v_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'room is not active' USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_manage_college(v_actor, v_college) THEN
    RAISE EXCEPTION 'college access denied' USING ERRCODE = '42501';
  END IF;

  IF p_day_of_week IS NULL THEN
    v_days := public._availability_active_working_days(v_college);
  ELSIF p_day_of_week < 0 OR p_day_of_week > 6 THEN
    RAISE EXCEPTION 'invalid day_of_week: %', p_day_of_week USING ERRCODE = '22023';
  ELSE
    v_days := ARRAY[p_day_of_week]::int[];
  END IF;

  IF cardinality(v_days) = 0 THEN
    RAISE EXCEPTION 'no active working days configured' USING ERRCODE = '22023';
  END IF;

  -- Pre-validate EVERY target day using the SAME predicates as the exclusion
  -- constraint: weekday span (NULL = all week), validity window OVERLAP (not equality),
  -- and time span (NULL = whole day). The exact-duplicate row is excluded so that a
  -- repeat request is reported as "unchanged" instead of a conflict (idempotency).
  FOREACH v_day IN ARRAY v_days LOOP
    SELECT ru.id, ru.day_of_week, ru.start_time, ru.end_time
    INTO v_conflict_id, v_conflict_day, v_conflict_start, v_conflict_end
    FROM public.room_unavailability ru
    WHERE ru.room_id = p_room_id
      AND ru.college_id = v_college
      AND public._avail_day_span(ru.day_of_week) && public._avail_day_span(v_day::smallint)
      AND public._avail_date_span(ru.start_date, ru.end_date)
          && public._avail_date_span(p_start_date, p_end_date)
      AND public._avail_time_span(ru.start_time, ru.end_time)
          && public._avail_time_span(p_start_time, p_end_time)
      AND NOT (
        ru.day_of_week = v_day::smallint
        AND ru.start_time = p_start_time
        AND ru.end_time = p_end_time
        AND ru.start_date IS NOT DISTINCT FROM p_start_date
        AND ru.end_date IS NOT DISTINCT FROM p_end_date
      )
    LIMIT 1;

    IF v_conflict_id IS NOT NULL THEN
      RAISE EXCEPTION
        'unavailability_overlap: day=% existing=% (%–%) proposed=%–%',
        v_day,
        coalesce(v_conflict_day::text, 'all_week'),
        coalesce(to_char(v_conflict_start, 'HH24:MI'), '00:00'),
        coalesce(to_char(v_conflict_end, 'HH24:MI'), '24:00'),
        to_char(p_start_time, 'HH24:MI'), to_char(p_end_time, 'HH24:MI')
        USING ERRCODE = '23P01';
    END IF;
  END LOOP;

  FOREACH v_day IN ARRAY v_days LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.room_unavailability ru
      WHERE ru.room_id = p_room_id
        AND ru.college_id = v_college
        AND ru.day_of_week = v_day::smallint
        AND ru.start_time = p_start_time
        AND ru.end_time = p_end_time
        AND ru.start_date IS NOT DISTINCT FROM p_start_date
        AND ru.end_date IS NOT DISTINCT FROM p_end_date
    ) INTO v_exists;

    IF v_exists THEN
      v_unchanged := v_unchanged + 1;
    ELSE
      INSERT INTO public.room_unavailability (
        college_id, room_id, day_of_week, start_time, end_time,
        start_date, end_date, reason
      ) VALUES (
        v_college, p_room_id, v_day::smallint, p_start_time, p_end_time,
        p_start_date, p_end_date, nullif(trim(p_reason), '')
      );
      v_created := v_created + 1;
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (college_id, actor_id, action, entity, entity_id, details)
  VALUES (
    v_college, v_actor, 'create', 'room_unavailability', p_room_id,
    jsonb_build_object(
      'mode', CASE WHEN p_day_of_week IS NULL THEN 'all_active_days' ELSE 'single_day' END,
      'days', to_jsonb(v_days),
      'days_created', v_created,
      'days_unchanged', v_unchanged,
      'start_time', p_start_time,
      'end_time', p_end_time,
      'start_date', p_start_date,
      'end_date', p_end_date,
      'constraint_kind', 'hard_unavailability'
    )
  );

  RETURN jsonb_build_object(
    'status', 'ok',
    'resource', 'room_unavailability',
    'college_id', v_college,
    'days_targeted', v_days,
    'days_created', v_created,
    'days_unchanged', v_unchanged
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.upsert_room_unavailability_for_active_days(uuid, time, time, text, date, date, int)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_room_unavailability_for_active_days(uuid, time, time, text, date, date, int)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.upsert_instructor_unavailability_for_active_days(uuid, time, time, text, int) IS
  'LAUNCH-CLOSURE-03: atomic HARD instructor unavailability for one weekday or all scheduling_settings.working_days. SECURITY INVOKER: college isolation enforced by RLS plus an explicit can_manage_college check.';
COMMENT ON FUNCTION public.upsert_room_unavailability_for_active_days(uuid, time, time, text, date, date, int) IS
  'LAUNCH-CLOSURE-03: atomic HARD room unavailability, date-window aware and whole-day/all-week aware. SECURITY INVOKER: college isolation enforced by RLS plus an explicit can_manage_college check.';

COMMIT;
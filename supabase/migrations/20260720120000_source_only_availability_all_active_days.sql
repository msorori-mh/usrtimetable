-- SOURCE-ONLY / NOT APPLIED
-- AVAILABILITY-ALL-ACTIVE-DAYS-BULK-ENTRY-01 (+ domain addendum)
--
-- Domain:
--   operational calendar (scheduling_settings.working_days) ≠ unavailability
--   ≠ soft preferences ≠ structural constraint settings
--
-- This migration exposes atomic HARD unavailability upserts only.
-- Active instructors/rooms are available by default during working days;
-- this path records blocks (unavailable), never "available"/"preferred"/Soft.
-- Never stores day sentinel "all"; expands to one row per active working day.

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: resolve active working days from operational calendar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._availability_active_working_days(p_college_id uuid)
RETURNS int[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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

REVOKE ALL ON FUNCTION public._availability_active_working_days(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._availability_active_working_days(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public._availability_times_overlap(
  p_start1 time, p_end1 time, p_start2 time, p_end2 time
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT p_start1 < p_end2 AND p_start2 < p_end1;
$fn$;

REVOKE ALL ON FUNCTION public._availability_times_overlap(time, time, time, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._availability_times_overlap(time, time, time, time) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Instructor HARD unavailability (availability_type=unavailable, is_preference=false)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_instructor_unavailability_for_active_days(
  p_instructor_id uuid,
  p_start_time time,
  p_end_time time,
  p_notes text DEFAULT NULL,
  p_day_of_week int DEFAULT NULL -- NULL = all active working days; 0..6 = single day
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
  v_conflict_day int;
  v_conflict_start time;
  v_conflict_end time;
  v_type text := 'unavailable';
  v_pref boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  IF p_instructor_id IS NULL OR p_start_time IS NULL OR p_end_time IS NULL THEN
    RAISE EXCEPTION 'instructor_id, start_time, and end_time are required' USING ERRCODE = '22023';
  END IF;

  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'invalid_time_range: end_time must be after start_time' USING ERRCODE = '22023';
  END IF;

  SELECT i.college_id, i.is_active INTO v_college, v_active
  FROM public.instructors i
  WHERE i.id = p_instructor_id;

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
  ELSE
    IF p_day_of_week < 0 OR p_day_of_week > 6 THEN
      RAISE EXCEPTION 'invalid day_of_week: %', p_day_of_week USING ERRCODE = '22023';
    END IF;
    v_days := ARRAY[p_day_of_week]::int[];
  END IF;

  IF cardinality(v_days) = 0 THEN
    RAISE EXCEPTION 'no active working days configured' USING ERRCODE = '22023';
  END IF;

  -- Pre-validate ALL days before any DML
  FOREACH v_day IN ARRAY v_days LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.instructor_availability ia
      WHERE ia.instructor_id = p_instructor_id
        AND ia.college_id = v_college
        AND ia.day_of_week = v_day
        AND ia.start_time = p_start_time
        AND ia.end_time = p_end_time
        AND ia.availability_type = v_type
        AND ia.is_preference IS NOT DISTINCT FROM v_pref
    ) INTO v_exists;

    IF v_exists THEN
      CONTINUE;
    END IF;

    SELECT ia.day_of_week, ia.start_time, ia.end_time
    INTO v_conflict_day, v_conflict_start, v_conflict_end
    FROM public.instructor_availability ia
    WHERE ia.instructor_id = p_instructor_id
      AND ia.college_id = v_college
      AND ia.day_of_week = v_day
      AND ia.is_preference IS NOT DISTINCT FROM v_pref
      AND public._availability_times_overlap(ia.start_time, ia.end_time, p_start_time, p_end_time)
      AND NOT (
        ia.start_time = p_start_time
        AND ia.end_time = p_end_time
        AND ia.availability_type = v_type
      )
    LIMIT 1;

    IF v_conflict_day IS NOT NULL THEN
      RAISE EXCEPTION
        'availability_overlap: day=% existing=%–% proposed=%–%',
        v_conflict_day,
        to_char(v_conflict_start, 'HH24:MI'),
        to_char(v_conflict_end, 'HH24:MI'),
        to_char(p_start_time, 'HH24:MI'),
        to_char(p_end_time, 'HH24:MI')
        USING ERRCODE = '23505';
    END IF;
  END LOOP;

  -- Apply inserts (transactional with this function)
  FOREACH v_day IN ARRAY v_days LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.instructor_availability ia
      WHERE ia.instructor_id = p_instructor_id
        AND ia.college_id = v_college
        AND ia.day_of_week = v_day
        AND ia.start_time = p_start_time
        AND ia.end_time = p_end_time
        AND ia.availability_type = v_type
        AND ia.is_preference IS NOT DISTINCT FROM v_pref
    ) INTO v_exists;

    IF v_exists THEN
      v_unchanged := v_unchanged + 1;
    ELSE
      INSERT INTO public.instructor_availability (
        college_id, instructor_id, day_of_week, start_time, end_time,
        availability_type, is_preference, notes
      ) VALUES (
        v_college, p_instructor_id, v_day, p_start_time, p_end_time,
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
      'availability_type', v_type,
      'is_preference', v_pref,
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
-- Room HARD unavailability across active working days
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
SECURITY DEFINER
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
  v_conflict_day int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF p_room_id IS NULL OR p_start_time IS NULL OR p_end_time IS NULL THEN
    RAISE EXCEPTION 'room_id, start_time, and end_time are required for active-days bulk' USING ERRCODE = '22023';
  END IF;
  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'invalid_time_range: end_time must be after start_time' USING ERRCODE = '22023';
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
  ELSE
    IF p_day_of_week < 0 OR p_day_of_week > 6 THEN
      RAISE EXCEPTION 'invalid day_of_week: %', p_day_of_week USING ERRCODE = '22023';
    END IF;
    v_days := ARRAY[p_day_of_week]::int[];
  END IF;

  -- Pre-validate ALL days before any DML
  FOREACH v_day IN ARRAY v_days LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.room_unavailability ru
      WHERE ru.room_id = p_room_id
        AND ru.college_id = v_college
        AND ru.day_of_week = v_day
        AND ru.start_time = p_start_time
        AND ru.end_time = p_end_time
        AND ru.start_date IS NOT DISTINCT FROM p_start_date
        AND ru.end_date IS NOT DISTINCT FROM p_end_date
    ) INTO v_exists;
    IF v_exists THEN CONTINUE; END IF;

    SELECT ru.day_of_week INTO v_conflict_day
    FROM public.room_unavailability ru
    WHERE ru.room_id = p_room_id
      AND ru.college_id = v_college
      AND ru.day_of_week = v_day
      AND ru.start_time IS NOT NULL AND ru.end_time IS NOT NULL
      AND public._availability_times_overlap(ru.start_time, ru.end_time, p_start_time, p_end_time)
    LIMIT 1;

    IF v_conflict_day IS NOT NULL THEN
      RAISE EXCEPTION 'unavailability_overlap: day=%', v_conflict_day USING ERRCODE = '23505';
    END IF;
  END LOOP;

  FOREACH v_day IN ARRAY v_days LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.room_unavailability ru
      WHERE ru.room_id = p_room_id
        AND ru.college_id = v_college
        AND ru.day_of_week = v_day
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
        v_college, p_room_id, v_day, p_start_time, p_end_time,
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

COMMENT ON FUNCTION public.upsert_instructor_unavailability_for_active_days IS
  'SOURCE-ONLY: atomic HARD instructor unavailability for one day or all scheduling_settings.working_days; never stores all sentinel; never Soft/available.';
COMMENT ON FUNCTION public.upsert_room_unavailability_for_active_days IS
  'SOURCE-ONLY: atomic HARD room unavailability for one day or all active working days; rooms default available when no block.';

COMMIT;

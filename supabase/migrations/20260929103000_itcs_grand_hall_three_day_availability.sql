-- ITCS grand hall is available only on Saturday, Sunday and Thursday,
-- 08:00-14:00: 3 days x 6 hours = 18 weekly hours.
--
-- Keep the normalized room_availability rows and the rooms.available_* fallback
-- aligned so the scheduler, executive dashboards and printable reports all use
-- the same denominator. Existing timetable sessions are deliberately preserved;
-- report readers expose any use outside these windows as an operational issue.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $migration$
DECLARE
  v_college constant uuid := '7168345f-cf9d-4789-b2ad-547abb687dc8';
  v_room uuid;
  v_matches integer;
  v_rows integer;
  v_hours numeric;
  v_days smallint[];
BEGIN
  SELECT count(*), min(r.id::text)::uuid
    INTO v_matches, v_room
  FROM public.rooms r
  LEFT JOIN public.room_types rt ON rt.id = r.room_type_id
  WHERE r.college_id = v_college
    AND r.is_active IS TRUE
    AND btrim(r.name) = 'القاعة الكبرى'
    AND coalesce(nullif(lower(btrim(rt.code)), ''), lower(btrim(r.room_type)))
        IN ('lecture_hall', 'lecture_room', 'lecture', 'classroom', 'lec');

  IF v_matches <> 1 OR v_room IS NULL THEN
    RAISE EXCEPTION 'ITCS_GRAND_HALL_IDENTITY_MISMATCH: expected 1 active lecture hall, found %',
      v_matches USING ERRCODE = '23514';
  END IF;

  -- Serialize the correction against concurrent room edits.
  PERFORM 1 FROM public.rooms WHERE id = v_room FOR UPDATE;

  UPDATE public.rooms
  SET available_days = ARRAY[6, 0, 4]::smallint[],
      available_start_time = '08:00'::time,
      available_end_time = '14:00'::time,
      notes = 'اعتماد المستخدم 29 سبتمبر 2026: القاعة متاحة فقط أيام السبت والأحد والخميس من 08:00 إلى 14:00، بإجمالي 18 ساعة أسبوعيًا. هذا القيد هو مرجع الجدولة والتقارير.',
      updated_at = now()
  WHERE id = v_room
    AND (
      available_days IS DISTINCT FROM ARRAY[6, 0, 4]::smallint[]
      OR available_start_time IS DISTINCT FROM '08:00'::time
      OR available_end_time IS DISTINCT FROM '14:00'::time
      OR notes IS DISTINCT FROM 'اعتماد المستخدم 29 سبتمبر 2026: القاعة متاحة فقط أيام السبت والأحد والخميس من 08:00 إلى 14:00، بإجمالي 18 ساعة أسبوعيًا. هذا القيد هو مرجع الجدولة والتقارير.'
    );

  -- Remove only stale/extra windows belonging to this exact room. A single
  -- canonical row per approved day prevents duplicate windows from inflating
  -- printable-report capacity.
  DELETE FROM public.room_availability ra
  WHERE ra.room_id = v_room
    AND (
      ra.college_id IS DISTINCT FROM v_college
      OR ra.day_of_week NOT IN (6, 0, 4)
      OR ra.start_time IS DISTINCT FROM '08:00'::time
      OR ra.end_time IS DISTINCT FROM '14:00'::time
    );

  DELETE FROM public.room_availability duplicate
  USING public.room_availability keeper
  WHERE duplicate.room_id = v_room
    AND keeper.room_id = v_room
    AND duplicate.day_of_week = keeper.day_of_week
    AND duplicate.start_time = keeper.start_time
    AND duplicate.end_time = keeper.end_time
    AND duplicate.id::text > keeper.id::text;

  INSERT INTO public.room_availability (
    college_id, room_id, day_of_week, start_time, end_time, notes
  )
  SELECT
    v_college,
    v_room,
    approved.day_of_week,
    '08:00'::time,
    '14:00'::time,
    'إتاحة القاعة الكبرى المعتمدة: 6 ساعات في اليوم، 18 ساعة أسبوعيًا.'
  FROM unnest(ARRAY[6, 0, 4]::smallint[]) AS approved(day_of_week)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.room_availability ra
    WHERE ra.room_id = v_room
      AND ra.college_id = v_college
      AND ra.day_of_week = approved.day_of_week
      AND ra.start_time = '08:00'::time
      AND ra.end_time = '14:00'::time
  );

  SELECT
    count(*),
    coalesce(sum(extract(epoch FROM (ra.end_time - ra.start_time)) / 3600), 0),
    array_agg(ra.day_of_week ORDER BY ra.day_of_week)
  INTO v_rows, v_hours, v_days
  FROM public.room_availability ra
  WHERE ra.room_id = v_room;

  IF v_rows <> 3
     OR v_hours <> 18
     OR v_days IS DISTINCT FROM ARRAY[0, 4, 6]::smallint[] THEN
    RAISE EXCEPTION
      'ITCS_GRAND_HALL_AVAILABILITY_POSTCONDITION_FAILED: rows=%, hours=%, days=%',
      v_rows, v_hours, v_days USING ERRCODE = '23514';
  END IF;
END
$migration$;

COMMIT;

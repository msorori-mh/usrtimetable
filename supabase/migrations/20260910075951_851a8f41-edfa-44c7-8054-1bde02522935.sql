BEGIN;

ALTER FUNCTION public._avail_time_span(time, time) SET search_path = pg_catalog;
ALTER FUNCTION public._avail_day_span(smallint) SET search_path = pg_catalog;
ALTER FUNCTION public._avail_date_span(date, date) SET search_path = pg_catalog;
ALTER FUNCTION public.validate_room_unavailability_window() SET search_path = pg_catalog;

DO $do$
DECLARE
  v_missing int;
BEGIN
  SELECT count(*) INTO v_missing
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      '_avail_time_span', '_avail_day_span', '_avail_date_span',
      'validate_room_unavailability_window'
    )
    AND (p.proconfig IS NULL OR NOT (p.proconfig @> ARRAY['search_path=pg_catalog']));

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'search_path hardening incomplete: % helper(s) still unpinned', v_missing;
  END IF;
END
$do$;

DO $do$
DECLARE
  v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('_avail_time_span', '_avail_day_span', '_avail_date_span')
    AND p.provolatile <> 'i';

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'span helper lost IMMUTABLE volatility';
  END IF;
END
$do$;

DO $do$
DECLARE
  v_excl int;
BEGIN
  SELECT count(*) INTO v_excl
  FROM pg_constraint
  WHERE conname IN ('instructor_availability_no_overlap', 'room_unavailability_no_overlap');

  IF v_excl <> 2 THEN
    RAISE EXCEPTION 'expected 2 availability exclusion constraints, found %', v_excl;
  END IF;
END
$do$;

COMMIT;
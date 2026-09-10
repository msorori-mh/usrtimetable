-- LAUNCH-CLOSURE-03 — behaviour cases, run on the disposable database only.
-- Every case prints a line starting with CASE ... => PASS or FAIL.
-- Run with psql -v ON_ERROR_STOP=1: an unexpected error aborts the run.

\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

\echo '### CASE GROUP 1 — object shape and privileges'

-- The rejected proposal could not even parse: `timerange` does not exist.
SELECT format('CASE 1.1 timerange type absent (rejected proposal unparseable) => %s',
  CASE WHEN NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'timerange')
       THEN 'PASS' ELSE 'FAIL' END) AS result;

SELECT format('CASE 1.2 both exclusion constraints exist => %s',
  CASE WHEN (SELECT count(*) FROM pg_constraint
             WHERE conname IN ('instructor_availability_no_overlap','room_unavailability_no_overlap')
               AND contype = 'x') = 2
       THEN 'PASS' ELSE 'FAIL' END) AS result;

SELECT format('CASE 1.3 instructor constraint is PARTIAL to hard unavailability => %s',
  CASE WHEN (SELECT pg_get_constraintdef(oid) FROM pg_constraint
             WHERE conname = 'instructor_availability_no_overlap')
            LIKE '%availability_type = ''unavailable''%is_preference = false%'
       THEN 'PASS' ELSE 'FAIL' END) AS result;

SELECT format('CASE 1.4 no SECURITY DEFINER among the new functions => %s',
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname IN ('upsert_instructor_unavailability_for_active_days',
                        'upsert_room_unavailability_for_active_days',
                        '_availability_active_working_days',
                        '_avail_time_span','_avail_day_span','_avail_date_span'))
       THEN 'PASS' ELSE 'FAIL' END) AS result;

SELECT format('CASE 1.5 anon has no EXECUTE on either upsert RPC => %s',
  CASE WHEN NOT has_function_privilege('anon',
         'public.upsert_room_unavailability_for_active_days(uuid,time,time,text,date,date,int)', 'EXECUTE')
        AND NOT has_function_privilege('anon',
         'public.upsert_instructor_unavailability_for_active_days(uuid,time,time,text,int)', 'EXECUTE')
       THEN 'PASS' ELSE 'FAIL' END) AS result;

SELECT format('CASE 1.6 exactly one signature per RPC (no PGRST203 ambiguity) => %s',
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname='public'
               AND p.proname IN ('upsert_instructor_unavailability_for_active_days',
                                 'upsert_room_unavailability_for_active_days')) = 2
       THEN 'PASS' ELSE 'FAIL' END) AS result;

\echo '### CASE GROUP 2 — temporal semantics of the normalisation helpers'

SELECT format('CASE 2.1 NULL times normalise to the whole day => %s',
  CASE WHEN public._avail_time_span(NULL, NULL) = tsrange('2000-01-01 00:00','2000-01-02 00:00','[)')
       THEN 'PASS' ELSE 'FAIL' END) AS result;

SELECT format('CASE 2.2 whole day overlaps a timed window => %s',
  CASE WHEN public._avail_time_span(NULL,NULL) && public._avail_time_span('10:00','12:00')
       THEN 'PASS' ELSE 'FAIL' END) AS result;

SELECT format('CASE 2.3 adjacency is NOT overlap => %s',
  CASE WHEN NOT (public._avail_time_span('10:00','12:00') && public._avail_time_span('12:00','13:00'))
       THEN 'PASS' ELSE 'FAIL' END) AS result;

SELECT format('CASE 2.4 NULL weekday spans every weekday => %s',
  CASE WHEN public._avail_day_span(NULL) = int4range(0,6,'[]')
        AND public._avail_day_span(NULL) && public._avail_day_span(3::smallint)
       THEN 'PASS' ELSE 'FAIL' END) AS result;

SELECT format('CASE 2.5 distinct weekdays do not overlap => %s',
  CASE WHEN NOT (public._avail_day_span(1::smallint) && public._avail_day_span(2::smallint))
       THEN 'PASS' ELSE 'FAIL' END) AS result;

SELECT format('CASE 2.6 D2 regression: unequal OVERLAPPING date windows overlap => %s',
  CASE WHEN public._avail_date_span('2026-01-01','2026-03-31')
         && public._avail_date_span('2026-02-01','2026-04-30')
       THEN 'PASS' ELSE 'FAIL' END) AS result;

SELECT format('CASE 2.7 disjoint date windows do NOT overlap => %s',
  CASE WHEN NOT (public._avail_date_span('2026-01-01','2026-01-31')
              && public._avail_date_span('2026-05-01','2026-05-31'))
       THEN 'PASS' ELSE 'FAIL' END) AS result;

SELECT format('CASE 2.8 NULL date bounds are unbounded and overlap anything => %s',
  CASE WHEN public._avail_date_span(NULL,NULL) && public._avail_date_span('2026-05-01','2026-05-31')
       THEN 'PASS' ELSE 'FAIL' END) AS result;

\echo '### CASE GROUP 3 — instructor writes as an authenticated college admin'

SET ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', false);

-- 3.1 bulk save over all active working days succeeds and actually persists
SELECT format('CASE 3.1 bulk instructor save creates 6 days => %s',
  CASE WHEN (public.upsert_instructor_unavailability_for_active_days(
               'dddddddd-dddd-dddd-dddd-dddddddddddd','10:00','12:00','TEST ONLY', NULL
             ) ->> 'days_created') = '6'
       THEN 'PASS' ELSE 'FAIL' END) AS result;

SELECT format('CASE 3.2 rows are readable back (persistence proven) => %s',
  CASE WHEN (SELECT count(*) FROM public.instructor_availability
             WHERE instructor_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
               AND availability_type = 'unavailable') = 6
       THEN 'PASS' ELSE 'FAIL' END) AS result;

-- 3.3 idempotency: identical request changes nothing, reports unchanged
SELECT format('CASE 3.3 repeat request is idempotent (0 created / 6 unchanged) => %s',
  CASE WHEN (SELECT (r ->> 'days_created') = '0' AND (r ->> 'days_unchanged') = '6'
             FROM public.upsert_instructor_unavailability_for_active_days(
               'dddddddd-dddd-dddd-dddd-dddddddddddd','10:00','12:00','TEST ONLY', NULL) AS r)
       THEN 'PASS' ELSE 'FAIL' END) AS result;

-- 3.4 adjacent window accepted for a single day
SELECT format('CASE 3.4 adjacent window 12:00-13:00 accepted => %s',
  CASE WHEN (public.upsert_instructor_unavailability_for_active_days(
               'dddddddd-dddd-dddd-dddd-dddddddddddd','12:00','13:00', NULL, 1
             ) ->> 'days_created') = '1'
       THEN 'PASS' ELSE 'FAIL' END) AS result;

-- 3.5 overlapping window rejected by the function, nothing written
DO $$
DECLARE v_before int; v_after int; v_code text;
BEGIN
  SELECT count(*) INTO v_before FROM public.instructor_availability;
  BEGIN
    PERFORM public.upsert_instructor_unavailability_for_active_days(
      'dddddddd-dddd-dddd-dddd-dddddddddddd','11:00','13:00', NULL, 1);
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN
    v_code := SQLSTATE;
  END;
  SELECT count(*) INTO v_after FROM public.instructor_availability;
  RAISE NOTICE 'CASE 3.5 overlap rejected 23P01 and no partial write => %',
    CASE WHEN v_code = '23P01' AND v_before = v_after THEN 'PASS' ELSE 'FAIL (' || v_code || ')' END;
END
$$;

-- 3.6 invalid time range rejected
DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    PERFORM public.upsert_instructor_unavailability_for_active_days(
      'dddddddd-dddd-dddd-dddd-dddddddddddd','13:00','11:00', NULL, 2);
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  RAISE NOTICE 'CASE 3.6 inverted time rejected 22023 => %',
    CASE WHEN v_code = '22023' THEN 'PASS' ELSE 'FAIL (' || v_code || ')' END;
END
$$;

-- 3.7 D4 regression: a soft PREFERENCE overlapping a hard block is still allowed
DO $$
DECLARE v_ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.instructor_availability
      (college_id, instructor_id, day_of_week, start_time, end_time, availability_type, is_preference)
    VALUES ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd',
            1,'10:30','11:30','preferred', true);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_ok := false;
  END;
  RAISE NOTICE 'CASE 3.7 soft preference overlapping a hard block still allowed => %',
    CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END;
END
$$;

-- 3.8 direct (non-RPC) duplicate insert is stopped by the constraint, not by app code
DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    INSERT INTO public.instructor_availability
      (college_id, instructor_id, day_of_week, start_time, end_time, availability_type, is_preference)
    VALUES ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd',
            1,'10:00','12:00','unavailable', false);
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  RAISE NOTICE 'CASE 3.8 direct duplicate insert blocked at rest (23P01) => %',
    CASE WHEN v_code = '23P01' THEN 'PASS' ELSE 'FAIL (' || v_code || ')' END;
END
$$;

-- 3.9 cross-college write rejected (admin of COL-A targeting COL-B's lecturer)
DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    PERFORM public.upsert_instructor_unavailability_for_active_days(
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','10:00','12:00', NULL, 1);
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  -- Under SECURITY INVOKER the caller cannot even SELECT the other college's
  -- instructor (RLS on public.instructors), so the function fails closed on
  -- 'instructor not found' (22023) BEFORE reaching the can_manage_college check
  -- (42501). Either code proves the cross-college write was refused; 22023 also
  -- avoids disclosing that the resource exists. 'no error' would be the failure.
  RAISE NOTICE 'CASE 3.9 cross-college RPC denied (22023 not-found or 42501 denied) => %',
    CASE WHEN v_code IN ('22023','42501') THEN 'PASS (' || v_code || ')'
         ELSE 'FAIL (' || v_code || ')' END;
END
$$;

-- 3.10 mismatched college_id on a direct insert rejected by the integrity trigger
DO $$
DECLARE v_msg text;
BEGIN
  BEGIN
    INSERT INTO public.instructor_availability
      (college_id, instructor_id, day_of_week, start_time, end_time, availability_type, is_preference)
    VALUES ('22222222-2222-2222-2222-222222222222','dddddddd-dddd-dddd-dddd-dddddddddddd',
            5,'08:00','09:00','unavailable', false);
    v_msg := 'no error';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  RAISE NOTICE 'CASE 3.10 instructor/college mismatch rejected => %',
    CASE WHEN v_msg LIKE '%mismatch%' OR v_msg LIKE '%policy%' THEN 'PASS' ELSE 'FAIL (' || v_msg || ')' END;
END
$$;

\echo '### CASE GROUP 4 — room writes: date windows, whole-day and all-week closures'

-- 4.1 timed closure on one weekday, bounded to January
SELECT format('CASE 4.1 room closure Jan Sunday 10-12 created => %s',
  CASE WHEN (public.upsert_room_unavailability_for_active_days(
               'ffffffff-ffff-ffff-ffff-ffffffffffff','10:00','12:00','TEST ONLY',
               '2026-01-01','2026-01-31', 0) ->> 'days_created') = '1'
       THEN 'PASS' ELSE 'FAIL' END) AS result;

-- 4.2 same weekday/time in a DISJOINT window is a distinct closure, not a duplicate
SELECT format('CASE 4.2 disjoint date window (May) accepted => %s',
  CASE WHEN (public.upsert_room_unavailability_for_active_days(
               'ffffffff-ffff-ffff-ffff-ffffffffffff','10:00','12:00','TEST ONLY',
               '2026-05-01','2026-05-31', 0) ->> 'days_created') = '1'
       THEN 'PASS' ELSE 'FAIL' END) AS result;

-- 4.3 D2 regression: OVERLAPPING but unequal window must be rejected, not silently accepted
DO $$
DECLARE v_code text; v_before int; v_after int;
BEGIN
  SELECT count(*) INTO v_before FROM public.room_unavailability;
  BEGIN
    PERFORM public.upsert_room_unavailability_for_active_days(
      'ffffffff-ffff-ffff-ffff-ffffffffffff','10:00','12:00', NULL,
      '2026-01-15','2026-02-15', 0);
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  SELECT count(*) INTO v_after FROM public.room_unavailability;
  RAISE NOTICE 'CASE 4.3 overlapping unequal date window rejected 23P01 => %',
    CASE WHEN v_code = '23P01' AND v_before = v_after THEN 'PASS' ELSE 'FAIL (' || v_code || ')' END;
END
$$;

-- 4.4 exact repeat inside the same window is idempotent, NOT a false conflict
SELECT format('CASE 4.4 exact repeat is unchanged, not a conflict => %s',
  CASE WHEN (SELECT (r ->> 'days_created') = '0' AND (r ->> 'days_unchanged') = '1'
             FROM public.upsert_room_unavailability_for_active_days(
               'ffffffff-ffff-ffff-ffff-ffffffffffff','10:00','12:00','TEST ONLY',
               '2026-01-01','2026-01-31', 0) AS r)
       THEN 'PASS' ELSE 'FAIL' END) AS result;

-- 4.5 D3 regression: a whole-day closure (NULL times) conflicts with the timed row
DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    INSERT INTO public.room_unavailability
      (college_id, room_id, day_of_week, start_time, end_time, start_date, end_date, reason)
    VALUES ('11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff',
            0, NULL, NULL, '2026-01-01','2026-01-31','TEST whole day');
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  RAISE NOTICE 'CASE 4.5 whole-day closure conflicting with a timed row rejected 23P01 => %',
    CASE WHEN v_code = '23P01' THEN 'PASS' ELSE 'FAIL (' || v_code || ')' END;
END
$$;

-- 4.6 whole-day closure on a FREE weekday is accepted
DO $$
DECLARE v_ok boolean;
BEGIN
  BEGIN
    INSERT INTO public.room_unavailability
      (college_id, room_id, day_of_week, start_time, end_time, reason)
    VALUES ('11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff',
            3, NULL, NULL, 'TEST whole day free');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_ok := false;
  END;
  RAISE NOTICE 'CASE 4.6 whole-day closure on a free weekday accepted => %',
    CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END;
END
$$;

-- 4.7 D3 regression: an ALL-WEEK row (NULL weekday) conflicts with that whole-day row
DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    INSERT INTO public.room_unavailability
      (college_id, room_id, day_of_week, start_time, end_time, reason)
    VALUES ('11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff',
            NULL, '14:00','15:00','TEST all week');
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  RAISE NOTICE 'CASE 4.7 all-week row conflicting with a whole-day closure rejected 23P01 => %',
    CASE WHEN v_code = '23P01' THEN 'PASS' ELSE 'FAIL (' || v_code || ')' END;
END
$$;

-- 4.8 the RPC now SEES a whole-day closure instead of silently reporting success
DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    PERFORM public.upsert_room_unavailability_for_active_days(
      'ffffffff-ffff-ffff-ffff-ffffffffffff','09:00','10:00', NULL, NULL, NULL, 3);
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  RAISE NOTICE 'CASE 4.8 RPC detects an existing whole-day closure => %',
    CASE WHEN v_code = '23P01' THEN 'PASS' ELSE 'FAIL (' || v_code || ')' END;
END
$$;

-- 4.9 half-specified window rejected by the validation trigger (all write paths)
DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    INSERT INTO public.room_unavailability
      (college_id, room_id, day_of_week, start_time, end_time)
    VALUES ('11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff',
            2, '09:00', NULL);
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  RAISE NOTICE 'CASE 4.9 half-specified time window rejected 22023 => %',
    CASE WHEN v_code = '22023' THEN 'PASS' ELSE 'FAIL (' || v_code || ')' END;
END
$$;

-- 4.10 inverted room time rejected by the trigger (the table has no such CHECK)
DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    INSERT INTO public.room_unavailability
      (college_id, room_id, day_of_week, start_time, end_time)
    VALUES ('11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff',
            2, '11:00', '09:00');
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  RAISE NOTICE 'CASE 4.10 inverted room time rejected 22023 => %',
    CASE WHEN v_code = '22023' THEN 'PASS' ELSE 'FAIL (' || v_code || ')' END;
END
$$;

-- 4.11 inverted date window rejected by the trigger
DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    INSERT INTO public.room_unavailability
      (college_id, room_id, day_of_week, start_time, end_time, start_date, end_date)
    VALUES ('11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff',
            2, '09:00','10:00','2026-03-31','2026-03-01');
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  RAISE NOTICE 'CASE 4.11 inverted date window rejected 22023 => %',
    CASE WHEN v_code = '22023' THEN 'PASS' ELSE 'FAIL (' || v_code || ')' END;
END
$$;

\echo '### CASE GROUP 5 — read-only viewer and anon are denied'

RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}', false);

DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    PERFORM public.upsert_instructor_unavailability_for_active_days(
      'dddddddd-dddd-dddd-dddd-dddddddddddd','15:00','16:00', NULL, 2);
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  RAISE NOTICE 'CASE 5.1 read-only viewer write denied 42501 => %',
    CASE WHEN v_code = '42501' THEN 'PASS' ELSE 'FAIL (' || v_code || ')' END;
END
$$;

DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    INSERT INTO public.instructor_availability
      (college_id, instructor_id, day_of_week, start_time, end_time, availability_type, is_preference)
    VALUES ('11111111-1111-1111-1111-111111111111','dddddddd-dddd-dddd-dddd-dddddddddddd',
            2,'15:00','16:00','unavailable', false);
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  RAISE NOTICE 'CASE 5.2 read-only viewer direct insert denied by RLS (42501) => %',
    CASE WHEN v_code = '42501' THEN 'PASS' ELSE 'FAIL (' || v_code || ')' END;
END
$$;

SELECT format('CASE 5.3 viewer can still READ availability => %s',
  CASE WHEN (SELECT count(*) FROM public.instructor_availability) > 0
       THEN 'PASS' ELSE 'FAIL' END) AS result;

RESET ROLE;
SET ROLE anon;
SELECT set_config('request.jwt.claims', NULL, false);

DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    PERFORM public.upsert_instructor_unavailability_for_active_days(
      'dddddddd-dddd-dddd-dddd-dddddddddddd','15:00','16:00', NULL, 2);
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  RAISE NOTICE 'CASE 5.4 anon has no EXECUTE on the RPC (42501) => %',
    CASE WHEN v_code = '42501' THEN 'PASS' ELSE 'FAIL (' || v_code || ')' END;
END
$$;

DO $$
DECLARE v_code text;
BEGIN
  BEGIN
    INSERT INTO public.room_unavailability (college_id, room_id, day_of_week, start_time, end_time)
    VALUES ('11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff',
            5,'08:00','09:00');
    v_code := 'no error';
  EXCEPTION WHEN OTHERS THEN v_code := SQLSTATE;
  END;
  -- anon is refused, but the FIRST guard it trips is the cross-college integrity
  -- trigger (P0001): the trigger runs as anon and RLS hides public.rooms from it,
  -- so the room/college check cannot be satisfied. The RLS policy (42501) would
  -- refuse it as well. Any error proves the write was blocked; 'no error' fails.
  RAISE NOTICE 'CASE 5.5 anon direct insert denied (integrity trigger or RLS) => %',
    CASE WHEN v_code <> 'no error' THEN 'PASS (' || v_code || ')'
         ELSE 'FAIL (insert succeeded)' END;
END
$$;

SELECT format('CASE 5.6 anon reads nothing => %s',
  CASE WHEN (SELECT count(*) FROM public.instructor_availability) = 0
       THEN 'PASS' ELSE 'FAIL' END) AS result;

RESET ROLE;
\echo '### CASES COMPLETE'

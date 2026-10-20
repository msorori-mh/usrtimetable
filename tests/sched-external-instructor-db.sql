-- Q-2 (track C): cross-college instructor clashes are part of the server validation, and the
-- indexed check matches schedule_coordination_private.busy(). Disposable DB; rolled back.
\set ON_ERROR_STOP on
\set n_sessions 600
\set fast_fixture 1
BEGIN;
\ir fixtures/sched-integrity.sql
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- College B publishes a timetable whose instructors are the same faculty members (linked
-- identities) as college A's instructors 0-39, on the same weekly slots.
INSERT INTO public.departments(id, college_id, name, code) VALUES (tsched.id('dep-b'), tsched.id('B'), 'قسم ب', 'DB');
INSERT INTO public.courses(id, college_id, department_id, code, name)
  VALUES (tsched.id('course-b'), tsched.id('B'), tsched.id('dep-b'), 'CB', 'مقرر ب');
INSERT INTO public.course_offerings(id, college_id, term_id, course_id, expected_students)
  VALUES (tsched.id('off-b'), tsched.id('B'), tsched.id('term-b'), tsched.id('course-b'), 20);
INSERT INTO public.instructors(id, college_id, full_name, availability_status)
SELECT tsched.id('ins-b-'||n), tsched.id('B'), 'محاضر ب '||n, 'available' FROM generate_series(0, 39) n;
INSERT INTO public.rooms(id, college_id, code, name, capacity, room_type)
SELECT tsched.id('room-b-'||n), tsched.id('B'), 'RB'||n, 'قاعة ب '||n, 100, 'lecture_hall' FROM generate_series(0, 39) n;
DO $link$
DECLARE n integer;
BEGIN
  FOR n IN 0..39 LOOP
    UPDATE public.faculty_identity_links SET identity_id =
      (SELECT identity_id FROM public.faculty_identity_links WHERE instructor_id = tsched.id('ins-'||n))
    WHERE instructor_id = tsched.id('ins-b-'||n);
  END LOOP;
END $link$;
INSERT INTO public.schedule_versions(id, college_id, academic_term_id, name, status)
VALUES (tsched.id('ver-b'), tsched.id('B'), tsched.id('term-b'), 'منشورة ب', 'draft');
SET LOCAL session_replication_role = replica;
INSERT INTO public.schedule_sessions(id, college_id, schedule_version_id, course_offering_id,
  instructor_id, room_id, day_of_week, start_time, end_time, session_type, expected_students)
SELECT tsched.id('sb-'||i), tsched.id('B'), tsched.id('ver-b'), tsched.id('off-b'),
  tsched.id('ins-b-'||(i % 40)), tsched.id('room-b-'||(i % 40)),
  (i / 120) % 5, time '08:00' + ((i / 40) % 3) * interval '2 hours',
  time '10:00' + ((i / 40) % 3) * interval '2 hours', 'lecture', 20
FROM generate_series(0, 599) i;
-- Only s-0's twin (B session 0) stays on A's slot; every other B session moves 6 hours later.
UPDATE public.schedule_sessions SET start_time = start_time + interval '6 hours',
  end_time = end_time + interval '6 hours'
WHERE schedule_version_id = tsched.id('ver-b') AND id <> tsched.id('sb-0');
UPDATE public.schedule_versions SET status = 'published' WHERE id = tsched.id('ver-b');
-- Active assignments of A's instructors (the external check applies to them); HR workflow
-- guards are outside this test.
INSERT INTO public.teaching_assignments(college_id, course_offering_id, instructor_id, is_active)
SELECT tsched.id('A'), tsched.id('off-'||(n % 30)), tsched.id('ins-'||n), true FROM generate_series(0, 39) n;
SET LOCAL session_replication_role = origin;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

SELECT tsched.as_user('admin-a');
SET ROLE authenticated;
DO $t$
DECLARE t0 timestamptz := clock_timestamp(); r jsonb; ms numeric; ext jsonb;
BEGIN
  r := public.validate_schedule_version(tsched.id('ver-a'));
  ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
  RAISE NOTICE 'validate_schedule_version with 600 external sessions: % ms, hard=%', round(ms), r->>'hard_count';
  SELECT jsonb_agg(c) INTO ext FROM jsonb_array_elements(r->'conflicts') c
  WHERE c->>'code' = 'instructor_conflict' AND c->'metadata'->>'scope' = 'external';
  PERFORM tsched.assert(jsonb_array_length(ext) = 1
    AND ext->0->>'schedule_session_id' = tsched.id('s-0')::text, 'external clash of s-0 only: ' || COALESCE(ext::text, 'none'));
  PERFORM tsched.assert(ms < 5000, 'validation too slow: ' || ms || ' ms');
END $t$;
RESET ROLE;
-- Equivalence with the coordination reference set used by check_version.
SELECT tsched.as_user('admin-a');
DO $t$
DECLARE s record; via_busy boolean; via_peer boolean; n integer := 0;
BEGIN
  FOR s IN SELECT * FROM public.schedule_sessions WHERE schedule_version_id = tsched.id('ver-a')
           AND NOT replaced_by_split ORDER BY (id = tsched.id('s-0')) DESC, id LIMIT 120 LOOP
    via_busy := EXISTS (SELECT 1 FROM schedule_coordination_private.busy(s.schedule_version_id) b
      WHERE b.instructor_id = s.instructor_id AND b.day_of_week = s.day_of_week
        AND b.start_time < s.end_time AND s.start_time < b.end_time);
    via_peer := EXISTS (SELECT 1 FROM jsonb_array_elements(public._ss_peer_i(s.id, s.college_id,
        s.schedule_version_id, s.instructor_id, s.day_of_week, s.start_time, s.end_time)) c
      WHERE c->'metadata'->>'scope' = 'external');
    PERFORM tsched.assert(via_busy = via_peer, 'external check differs from busy() for ' || s.id);
    n := n + CASE WHEN via_busy THEN 1 ELSE 0 END;
  END LOOP;
  PERFORM tsched.assert(n = 1, 'expected exactly one external clash in the sample, got ' || n);
END $t$;
ROLLBACK;
SELECT 'PASS: sched-external-instructor-db (Q-2)' AS result;

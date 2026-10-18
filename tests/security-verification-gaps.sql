-- Verification gaps (2026-10-18): H-7 external-clash waiver, H-1 link_intake_shared_group,
-- policy parity on scheduling_policy_exceptions, L-3 dean single college. Rolled back.
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

SELECT tsched.as_user('admin-a');
SET ROLE authenticated;
DO $t$
DECLARE r jsonb; n_before int; n_after int; v_ex uuid;
BEGIN
  r := public.validate_schedule_version(tsched.id('ver-a'));
  n_before := (r->>'hard_count')::int;
  PERFORM tsched.assert(EXISTS (SELECT 1 FROM jsonb_array_elements(r->'hard_conflicts') c
    WHERE c->'metadata'->>'scope' = 'external'), 'fixture must contain an external clash');
  -- A college admin may record an ordinary exception, but it must not waive the external clash.
  v_ex := public.approve_conflict_exception(tsched.id('ver-a'), 'instructor_conflict',
    tsched.id('s-0'), NULL, 'manual_review', 'محاولة تجاوز');
  r := public.validate_schedule_version(tsched.id('ver-a'));
  n_after := (r->>'hard_count')::int;
  PERFORM tsched.assert(n_after = n_before,
    format('H-7: ordinary exception waived an external clash (%s -> %s)', n_before, n_after));
  PERFORM tsched.assert(EXISTS (SELECT 1 FROM jsonb_array_elements(r->'hard_conflicts') c
    WHERE c->'metadata'->>'scope' = 'external'), 'H-7: external clash disappeared');
  PERFORM public.revoke_conflict_exception(v_ex, 'اختبار');
END $t$;
RESET ROLE;

-- A super admin's cross_college_instructor exception does waive it.
SELECT tsched.as_user('super');
SET ROLE authenticated;
DO $t$
DECLARE r jsonb;
BEGIN
  PERFORM public.approve_conflict_exception(tsched.id('ver-a'), 'instructor_conflict',
    tsched.id('s-0'), NULL, 'cross_college_instructor', 'اعتماد مشترك بين الكليتين');
  r := public.validate_schedule_version(tsched.id('ver-a'));
  PERFORM tsched.assert(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'hard_conflicts') c
    WHERE c->'metadata'->>'scope' = 'external'), 'H-7: super-admin cross-college exception not applied');
END $t$;
RESET ROLE;

-- H-1: no API role may execute link_intake_shared_group.
DO $t$
BEGIN
  PERFORM tsched.assert(NOT has_function_privilege('authenticated', 'public.link_intake_shared_group(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.link_intake_shared_group(uuid,uuid,uuid)', 'EXECUTE'),
    'H-1: link_intake_shared_group still executable by API roles');
  PERFORM tsched.assert(EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'initial_password_ready'
      AND polrelid = 'public.scheduling_policy_exceptions'::regclass AND NOT polpermissive),
    'policy parity: restrictive initial_password_ready missing on scheduling_policy_exceptions');
END $t$;

-- L-3: a dean cannot hold a second college, by any path.
-- (The membership rate limiter needs the production-only security_rate_buckets table.)
ALTER TABLE public.user_roles DISABLE TRIGGER trg_user_roles_rate_limit;
ALTER TABLE public.user_colleges DISABLE TRIGGER trg_user_colleges_rate_limit;
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users(id, email) VALUES (tsched.id('dean'), 'dean@test.invalid');
ALTER TABLE auth.users ENABLE TRIGGER USER;
INSERT INTO public.user_roles(user_id, role) VALUES (tsched.id('dean'), 'college_dean');
INSERT INTO public.user_colleges(user_id, college_id) VALUES (tsched.id('dean'), tsched.id('A'));
DO $t$
BEGIN
  BEGIN
    INSERT INTO public.user_colleges(user_id, college_id) VALUES (tsched.id('dean'), tsched.id('B'));
    RAISE EXCEPTION 'L-3: dean got a second college';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'DEAN_SINGLE_COLLEGE' THEN RAISE; END IF;
  END;
  -- Moving the dean to another college in one statement is allowed.
  UPDATE public.user_colleges SET college_id = tsched.id('B')
   WHERE user_id = tsched.id('dean') AND college_id = tsched.id('A');
END $t$;
ROLLBACK;

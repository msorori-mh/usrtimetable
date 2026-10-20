-- Q-2 / M-9 (track C). Disposable replayed database only; everything is rolled back.
-- Run: psql -v ON_ERROR_STOP=1 -f tests/sched-publish-gate-db.sql
\set ON_ERROR_STOP on
BEGIN;
\ir fixtures/sched-integrity.sql

-- A previously published timetable of the same college and term (history).
INSERT INTO public.schedule_versions(id, college_id, academic_term_id, name, status)
VALUES (tsched.id('ver-old'), tsched.id('A'), tsched.id('term-a'), 'المنشورة السابقة', 'published');

-- A real room double booking, written by the server role (outside the RPCs).
INSERT INTO public.schedule_sessions(id, college_id, schedule_version_id, course_offering_id,
  instructor_id, room_id, day_of_week, start_time, end_time, session_type, expected_students)
VALUES (tsched.id('s-clash'), tsched.id('A'), tsched.id('ver-a'), tsched.id('off-1'),
  tsched.id('ins-41'), tsched.id('room-0'), 0, '08:00', '10:00', 'lecture', 30);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

SELECT tsched.as_user('admin-a');
SET ROLE authenticated;

DO $t$
DECLARE r jsonb; run uuid; q record;
BEGIN
  -- validate_schedule_version reports the clash from the server.
  r := public.validate_schedule_version(tsched.id('ver-a'));
  PERFORM tsched.assert((r->>'hard_count')::int = 1, 'server hard_count must be 1: ' || (r - 'conflicts')::text);
  PERFORM tsched.assert((r->'hard_conflicts'->0->>'code') = 'room_conflict', 'room_conflict expected');

  -- The browser forges p_hard_conflicts_count = 0: the stored count is the server's.
  run := tsched.quality(tsched.id('ver-a'), 0);
  SELECT * INTO q FROM public.schedule_quality_runs WHERE id = run;
  PERFORM tsched.assert(q.hard_conflicts_count = 1, 'stored hard count must ignore the forged 0');
  PERFORM tsched.assert((q.metrics_breakdown->>'client_reported_hard_conflicts_count')::int = 0,
    'client number kept only for comparison');

  BEGIN
    PERFORM public.transition_schedule_version(tsched.id('A'), tsched.id('ver-a'), 'draft', 'review');
    RAISE EXCEPTION 'TEST_FAIL: review accepted with a room double booking';
  EXCEPTION WHEN check_violation THEN
    PERFORM tsched.assert(SQLERRM = 'PUBLISH_BLOCKER:UNAPPROVED_HARD_CONFLICTS', SQLERRM);
  END;

  -- A viewer of another college cannot read the server validation.
  PERFORM tsched.as_user('admin-b');
  BEGIN
    PERFORM public.validate_schedule_version(tsched.id('ver-a'));
    RAISE EXCEPTION 'TEST_FAIL: foreign college read validation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM tsched.as_user('admin-a');
END $t$;

-- The same version without the clash publishes, archiving the previous publication (M-9).
RESET ROLE;
DELETE FROM public.schedule_sessions WHERE id = tsched.id('s-clash');
-- One transaction: every run shares now(); keep only the fresh run for the gate to pick.
DELETE FROM public.schedule_quality_runs WHERE schedule_version_id = tsched.id('ver-a');
SELECT tsched.as_user('admin-a');
SET ROLE authenticated;
DO $t$
DECLARE r jsonb; run uuid;
BEGIN
  run := tsched.quality(tsched.id('ver-a'), 99);
  PERFORM tsched.assert((SELECT hard_conflicts_count FROM public.schedule_quality_runs WHERE id = run) = 0,
    'a forged non-zero count is not stored either');
  PERFORM public.transition_schedule_version(tsched.id('A'), tsched.id('ver-a'), 'draft', 'review');
  PERFORM public.transition_schedule_version(tsched.id('A'), tsched.id('ver-a'), 'review', 'approved');
  r := public.transition_schedule_version(tsched.id('A'), tsched.id('ver-a'), 'approved', 'published');
  PERFORM tsched.assert(r->'archived_superseded' ? tsched.id('ver-old')::text, 'old publication archived: ' || r::text);
  PERFORM tsched.assert((SELECT status FROM public.schedule_versions WHERE id = tsched.id('ver-old')) = 'archived', 'old status');
  PERFORM tsched.assert(EXISTS (SELECT 1 FROM public.schedule_version_events WHERE schedule_version_id = tsched.id('ver-old')
    AND event_type = 'archived' AND metadata->>'superseded_by' = tsched.id('ver-a')::text), 'archive event');
  PERFORM tsched.assert((SELECT published_at IS NOT NULL FROM public.schedule_versions WHERE id = tsched.id('ver-a')), 'published_at');
  PERFORM tsched.assert(public.current_published_version(tsched.id('A'), tsched.id('term-a')) = tsched.id('ver-a'),
    'current_published_version');
END $t$;

RESET ROLE;
DO $t$
BEGIN
  PERFORM tsched.assert(to_regclass('public.uq_schedule_versions_one_published') IS NOT NULL, 'unique index created');
  BEGIN
    INSERT INTO public.schedule_versions(college_id, academic_term_id, name, status)
    VALUES (tsched.id('A'), tsched.id('term-a'), 'منشورة ثانية', 'published');
    RAISE EXCEPTION 'TEST_FAIL: second published version accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $t$;

ROLLBACK;
SELECT 'PASS: sched-publish-gate-db (Q-2, M-9)' AS result;

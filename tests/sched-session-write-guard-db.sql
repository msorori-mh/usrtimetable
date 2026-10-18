-- H-6 / H-8 (track C): sessions are written through RPCs; the database re-checks other
-- writers at commit; approved versions are locked. Disposable replayed database; rolled back.
\set ON_ERROR_STOP on
BEGIN;
\ir fixtures/sched-integrity.sql
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT tsched.as_user('admin-a');
SET ROLE authenticated;

DO $t$
DECLARE
  r jsonb; row public.schedule_sessions; row2 public.schedule_sessions; det text;
  clash jsonb := jsonb_build_object('schedule_version_id', tsched.id('ver-a'),
    'course_offering_id', tsched.id('off-1'), 'instructor_id', tsched.id('ins-41'),
    'room_id', tsched.id('room-0'), 'day_of_week', 0, 'start_time', '08:00', 'end_time', '10:00',
    'expected_students', 30);
BEGIN
  -- 1. No direct DML for clients.
  BEGIN
    INSERT INTO public.schedule_sessions(college_id, schedule_version_id, course_offering_id, instructor_id,
      day_of_week, start_time, end_time) VALUES (tsched.id('A'), tsched.id('ver-a'), tsched.id('off-1'),
      tsched.id('ins-41'), 0, '08:00', '10:00');
    RAISE EXCEPTION 'TEST_FAIL: direct insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.schedule_sessions SET room_id = tsched.id('room-1') WHERE id = tsched.id('s-0');
    RAISE EXCEPTION 'TEST_FAIL: direct update accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- 2. Preview and save refuse a room double booking with a structured error.
  r := public.preview_manual_schedule_session(NULL, clash);
  PERFORM tsched.assert(NOT (r->>'valid')::boolean AND r->'blocking_conflicts'->0->>'code' = 'room_conflict', r::text);
  BEGIN
    PERFORM public.save_manual_schedule_session(NULL, NULL, clash);
    RAISE EXCEPTION 'TEST_FAIL: clash saved';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS det = PG_EXCEPTION_DETAIL;
    PERFORM tsched.assert(SQLERRM = 'SCHEDULE_HARD_CONFLICTS' AND det::jsonb->0->>'code' = 'room_conflict', SQLERRM || det);
  END;

  -- 3. Whitelist: identity/ownership columns cannot be supplied.
  BEGIN
    PERFORM public.save_manual_schedule_session(NULL, NULL, clash || jsonb_build_object('college_id', tsched.id('B')));
    RAISE EXCEPTION 'TEST_FAIL: college_id accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    PERFORM tsched.assert(SQLERRM = 'SESSION_FIELD_NOT_ALLOWED:college_id', SQLERRM);
  END;

  -- 4. Conflict-free create, optimistic concurrency on edit.
  row := public.save_manual_schedule_session(NULL, NULL, clash || jsonb_build_object('room_id', tsched.id('room-41')));
  PERFORM tsched.assert(row.room_id = tsched.id('room-41') AND row.source_type = 'manual', 'created');
  BEGIN
    PERFORM public.save_manual_schedule_session(row.id, row.updated_at - interval '1 second',
      jsonb_build_object('start_time', '12:00', 'end_time', '14:00'));
    RAISE EXCEPTION 'TEST_FAIL: stale edit accepted';
  EXCEPTION WHEN serialization_failure THEN
    PERFORM tsched.assert(SQLERRM = 'STALE_SESSION', SQLERRM);
  END;
  row2 := public.save_manual_schedule_session(row.id, row.updated_at,
    jsonb_build_object('start_time', '14:00', 'end_time', '16:00'));
  PERFORM tsched.assert(row2.start_time = '14:00', 'edited');
  -- Edit into a clash is refused.
  BEGIN
    PERFORM public.save_manual_schedule_session(row2.id, row2.updated_at,
      jsonb_build_object('room_id', tsched.id('room-2'), 'start_time', '08:00', 'end_time', '10:00'));
    RAISE EXCEPTION 'TEST_FAIL: clashing edit accepted';
  EXCEPTION WHEN raise_exception THEN
    PERFORM tsched.assert(SQLERRM = 'SCHEDULE_HARD_CONFLICTS', SQLERRM);
  END;

  -- 5. Delete with concurrency check and audit.
  BEGIN
    PERFORM public.delete_schedule_session(row2.id, row2.updated_at - interval '1 second');
    RAISE EXCEPTION 'TEST_FAIL: stale delete accepted';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  PERFORM public.delete_schedule_session(row2.id, row2.updated_at);
  PERFORM tsched.assert(NOT EXISTS (SELECT 1 FROM public.schedule_sessions WHERE id = row2.id), 'deleted');

  -- Another college's manager cannot write here.
  PERFORM tsched.as_user('admin-b');
  BEGIN
    PERFORM public.save_manual_schedule_session(NULL, NULL, clash || jsonb_build_object('room_id', tsched.id('room-42')));
    RAISE EXCEPTION 'TEST_FAIL: foreign college saved';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM tsched.as_user('admin-a');
END $t$;
RESET ROLE;
SELECT tsched.assert(EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'delete' AND entity = 'schedule_sessions'
  AND details->>'rpc' = 'delete_schedule_session'), 'delete audited');

-- 6. Writers outside the server functions are re-checked at commit (deferred trigger).
SET ROLE service_role;
DO $t$
BEGIN
  BEGIN
    INSERT INTO public.schedule_sessions(id, college_id, schedule_version_id, course_offering_id, instructor_id,
      room_id, day_of_week, start_time, end_time, expected_students)
    VALUES (tsched.id('svc-clash'), tsched.id('A'), tsched.id('ver-a'), tsched.id('off-1'), tsched.id('ins-42'),
      tsched.id('room-0'), 0, '08:00', '10:00', 30);
    SET CONSTRAINTS schedule_sessions_hard_rules_insert IMMEDIATE;
    RAISE EXCEPTION 'TEST_FAIL: service-role double booking committed';
  EXCEPTION WHEN check_violation THEN
    PERFORM tsched.assert(SQLERRM = 'SCHEDULE_HARD_CONFLICTS', SQLERRM);
  END;
END $t$;
SET CONSTRAINTS ALL DEFERRED;
-- A conflict-free service-role move passes.
UPDATE public.schedule_sessions SET room_id = tsched.id('room-43') WHERE id = tsched.id('s-0');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
RESET ROLE;

-- 7. H-8: an approved version is locked (changes go to a new draft cloned from it).
SELECT tsched.as_user('admin-a');
SET ROLE authenticated;
DO $t$
BEGIN
  PERFORM tsched.quality(tsched.id('ver-a'));
  PERFORM public.transition_schedule_version(tsched.id('A'), tsched.id('ver-a'), 'draft', 'review');
  PERFORM public.transition_schedule_version(tsched.id('A'), tsched.id('ver-a'), 'review', 'approved');
  BEGIN
    PERFORM public.save_manual_schedule_session(tsched.id('s-1'),
      (SELECT updated_at FROM public.schedule_sessions WHERE id = tsched.id('s-1')),
      jsonb_build_object('room_id', tsched.id('room-44')));
    RAISE EXCEPTION 'TEST_FAIL: approved version edited through RPC';
  EXCEPTION WHEN check_violation THEN
    PERFORM tsched.assert(SQLERRM = 'VERSION_LOCKED:approved', SQLERRM);
  END;
END $t$;
RESET ROLE;
DO $t$
BEGIN
  BEGIN
    UPDATE public.schedule_sessions SET room_id = tsched.id('room-44') WHERE id = tsched.id('s-1');
    RAISE EXCEPTION 'TEST_FAIL: approved session updated';
  EXCEPTION WHEN check_violation THEN
    PERFORM tsched.assert(SQLERRM = 'schedule_sessions are locked: version status is approved', SQLERRM);
  END;
END $t$;
-- Reviewers may still roll back; the version is then editable again.
SELECT tsched.as_user('admin-a');
SET ROLE authenticated;
SELECT public.transition_schedule_version(tsched.id('A'), tsched.id('ver-a'), 'approved', 'review');
RESET ROLE;
UPDATE public.schedule_sessions SET room_id = tsched.id('room-44') WHERE id = tsched.id('s-1');
ROLLBACK;
SELECT 'PASS: sched-session-write-guard-db (H-6, H-8)' AS result;

-- H-7 (track C): conflict exceptions only through audited RPCs. Disposable DB; rolled back.
\set ON_ERROR_STOP on
BEGIN;
\ir fixtures/sched-integrity.sql
INSERT INTO public.schedule_sessions(id, college_id, schedule_version_id, course_offering_id,
  instructor_id, room_id, day_of_week, start_time, end_time, session_type, expected_students)
VALUES (tsched.id('s-clash'), tsched.id('A'), tsched.id('ver-a'), tsched.id('off-1'),
  tsched.id('ins-41'), tsched.id('room-0'), 0, '08:00', '10:00', 'lecture', 30);
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
SELECT tsched.as_user('admin-a');
SET ROLE authenticated;

DO $t$
DECLARE ex uuid; r jsonb; e record;
BEGIN
  -- Direct writes are gone; approved_by can no longer be forged.
  BEGIN
    INSERT INTO public.schedule_version_conflict_exceptions(college_id, schedule_version_id, conflict_code,
      session_id, related_session_id, approval_type, reason, status, approved_by, approved_at)
    VALUES (tsched.id('A'), tsched.id('ver-a'), 'room_conflict', tsched.id('s-0'), tsched.id('s-clash'),
      'college_decision', 'x', 'approved', NULL, now());
    RAISE EXCEPTION 'TEST_FAIL: direct exception insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Decision 2026-10-18: no new conflict exceptions for anyone, any code.
  BEGIN
    PERFORM public.approve_conflict_exception(tsched.id('ver-a'), 'room_conflict', tsched.id('s-clash'),
      tsched.id('s-0'), 'college_decision', 'قاعة مشتركة');
    RAISE EXCEPTION 'TEST_FAIL: manager approved a new exception';
  EXCEPTION WHEN raise_exception THEN
    PERFORM tsched.assert(SQLERRM = 'CONFLICT_EXCEPTIONS_CLOSED', SQLERRM);
  END;
  PERFORM tsched.as_user('super');
  BEGIN
    PERFORM public.approve_conflict_exception(tsched.id('ver-a'), 'instructor_conflict', tsched.id('s-0'),
      NULL, 'cross_college_instructor', 'تنسيق');
    RAISE EXCEPTION 'TEST_FAIL: super admin approved a new exception';
  EXCEPTION WHEN raise_exception THEN
    PERFORM tsched.assert(SQLERRM = 'CONFLICT_EXCEPTIONS_CLOSED', SQLERRM);
  END;
END $t$;
RESET ROLE;

-- An exception approved before the freeze (current term) stays valid and can be revoked.
SET LOCAL session_replication_role = replica;
INSERT INTO public.schedule_version_conflict_exceptions(id, college_id, schedule_version_id, conflict_code,
  session_id, related_session_id, approval_type, reason, status, approved_by, approved_at)
VALUES (tsched.id('legacy-ex'), tsched.id('A'), tsched.id('ver-a'), 'room_conflict', tsched.id('s-clash'),
  tsched.id('s-0'), 'college_decision', 'قرار سابق في الفصل الحالي', 'approved', tsched.id('admin-a'), now());
SET LOCAL session_replication_role = origin;

-- Even a server function cannot insert a fresh exception.
DO $t$
BEGIN
  INSERT INTO public.schedule_version_conflict_exceptions(college_id, schedule_version_id, conflict_code,
    session_id, related_session_id, approval_type, reason, status, approved_by, approved_at)
  VALUES (tsched.id('A'), tsched.id('ver-a'), 'section_conflict', tsched.id('s-0'), tsched.id('s-1'),
    'college_decision', 'x', 'approved', tsched.id('admin-a'), now());
  RAISE EXCEPTION 'TEST_FAIL: server-side new exception';
EXCEPTION WHEN raise_exception THEN
  PERFORM tsched.assert(SQLERRM = 'CONFLICT_EXCEPTIONS_CLOSED', SQLERRM);
END $t$;

-- A clone carry-over inside the same term is kept.
INSERT INTO public.schedule_version_conflict_exceptions(college_id, schedule_version_id, conflict_code,
  session_id, related_session_id, approval_type, reason, status, approved_by, approved_at, metadata)
VALUES (tsched.id('A'), tsched.id('ver-a'), 'room_conflict', tsched.id('s-1'), NULL,
  'college_decision', 'منسوخ', 'approved', tsched.id('admin-a'), now(),
  jsonb_build_object('cloned_from_exception_id', tsched.id('legacy-ex')));
SELECT tsched.assert((SELECT count(*) FROM public.schedule_version_conflict_exceptions
  WHERE metadata->>'cloned_from_exception_id' = tsched.id('legacy-ex')::text) = 1, 'same-term carry-over kept');

SELECT tsched.as_user('admin-a');
SET ROLE authenticated;
DO $t$
DECLARE r jsonb;
BEGIN
  r := public.validate_schedule_version(tsched.id('ver-a'));
  PERFORM tsched.assert((r->>'hard_count')::int = 0 AND (r->>'approved_count')::int = 1, (r - 'conflicts')::text);
  PERFORM public.revoke_conflict_exception(tsched.id('legacy-ex'), 'انتهى القرار');
  r := public.validate_schedule_version(tsched.id('ver-a'));
  PERFORM tsched.assert((r->>'hard_count')::int = 1, 'revoked exception still honoured');
END $t$;
RESET ROLE;

-- A revoked exception cannot be turned back into an approval.
DO $t$
BEGIN
  UPDATE public.schedule_version_conflict_exceptions SET status = 'approved' WHERE id = tsched.id('legacy-ex');
  RAISE EXCEPTION 'TEST_FAIL: re-approval accepted';
EXCEPTION WHEN OTHERS THEN
  PERFORM tsched.assert(SQLERRM IN ('CONFLICT_EXCEPTIONS_CLOSED', 'CONFLICT_EXCEPTION_REVOKED_IS_FINAL'), SQLERRM);
END $t$;
ROLLBACK;
SELECT 'PASS: sched-conflict-exceptions-db (H-7, exception freeze)' AS result;

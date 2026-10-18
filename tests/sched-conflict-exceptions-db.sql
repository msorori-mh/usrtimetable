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

  -- Non-exceptionable rules are refused.
  BEGIN
    PERFORM public.approve_conflict_exception(tsched.id('ver-a'), 'itcs_theory_after_14', tsched.id('s-0'),
      NULL, 'college_decision', 'سبب');
    RAISE EXCEPTION 'TEST_FAIL: ITCS 14:00 waived';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- A college manager may not waive a clash with another college's timetable.
  BEGIN
    PERFORM public.approve_conflict_exception(tsched.id('ver-a'), 'instructor_conflict', tsched.id('s-0'),
      NULL, 'cross_college_instructor', 'سبب');
    RAISE EXCEPTION 'TEST_FAIL: manager approved cross-college exception';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Ordinary approval: approver is the caller, audited, and the gate honours it.
  ex := public.approve_conflict_exception(tsched.id('ver-a'), 'room_conflict', tsched.id('s-clash'),
    tsched.id('s-0'), 'college_decision', 'قاعة مشتركة بقرار العميد');
  SELECT * INTO e FROM public.schedule_version_conflict_exceptions WHERE id = ex;
  PERFORM tsched.assert(e.approved_by = tsched.id('admin-a') AND e.approved_at IS NOT NULL, 'approver forced');
  r := public.validate_schedule_version(tsched.id('ver-a'));
  PERFORM tsched.assert((r->>'hard_count')::int = 0 AND (r->>'approved_count')::int = 1, (r - 'conflicts')::text);

  -- Revocation brings the blocker back.
  PERFORM public.revoke_conflict_exception(ex, 'انتهى القرار');
  r := public.validate_schedule_version(tsched.id('ver-a'));
  PERFORM tsched.assert((r->>'hard_count')::int = 1, 'revoked exception still honoured');

  -- Super admin may approve the cross-college type.
  PERFORM tsched.as_user('super');
  ex := public.approve_conflict_exception(tsched.id('ver-a'), 'instructor_conflict', tsched.id('s-0'),
    NULL, 'cross_college_instructor', 'تنسيق معتمد');
  PERFORM tsched.assert((SELECT approved_by FROM public.schedule_version_conflict_exceptions WHERE id = ex) = tsched.id('super'), 'super approver');
END $t$;
RESET ROLE;
SELECT tsched.assert((SELECT count(*) FROM public.audit_logs WHERE entity = 'schedule_version_conflict_exceptions'
  AND action IN ('approve_conflict_exception', 'revoke_conflict_exception')) = 3, 'audited');
-- Server functions (e.g. a one-off migration) must still name an approver.
DO $t$
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', '', true);
    INSERT INTO public.schedule_version_conflict_exceptions(college_id, schedule_version_id, conflict_code,
      session_id, related_session_id, approval_type, reason, status, approved_at)
    VALUES (tsched.id('A'), tsched.id('ver-a'), 'section_conflict', tsched.id('s-0'), tsched.id('s-1'),
      'college_decision', 'x', 'approved', now());
    RAISE EXCEPTION 'TEST_FAIL: approver-less exception';
  EXCEPTION WHEN check_violation THEN
    PERFORM tsched.assert(SQLERRM = 'CONFLICT_EXCEPTION_APPROVER_REQUIRED', SQLERRM);
  END;
END $t$;
ROLLBACK;
SELECT 'PASS: sched-conflict-exceptions-db (H-7)' AS result;

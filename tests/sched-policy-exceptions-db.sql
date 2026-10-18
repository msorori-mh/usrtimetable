-- M-11 (track C): data-driven policy waivers and protected versions. Disposable DB; rolled back.
\set ON_ERROR_STOP on
BEGIN;
\ir fixtures/sched-integrity.sql
-- A student clash: lab1 moved onto the merged lecture slot.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_schedule_session_current_delivery_group;
UPDATE public.schedule_sessions SET start_time = '08:00', end_time = '10:00' WHERE id = tsched.id('s-lab1');
ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_schedule_session_current_delivery_group;
SET CONSTRAINTS ALL DEFERRED;

SELECT tsched.as_user('admin-a');
SET ROLE authenticated;
DO $t$
DECLARE r jsonb;
BEGIN
  r := public.validate_schedule_version(tsched.id('ver-a'));
  PERFORM tsched.assert((r->>'hard_count')::int = 1, 'clash is hard before the waiver');
  -- Only a super admin can create a policy exception.
  BEGIN
    INSERT INTO public.scheduling_policy_exceptions(college_id, schedule_version_id, rule_code, reason)
    VALUES (tsched.id('A'), tsched.id('ver-a'), 'delivery_group_conflict', 'x');
    RAISE EXCEPTION 'TEST_FAIL: manager created a waiver';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $t$;
SELECT tsched.as_user('super');
DO $t$
DECLARE r jsonb; w record;
BEGIN
  BEGIN
    INSERT INTO public.scheduling_policy_exceptions(college_id, schedule_version_id, rule_code, reason)
    VALUES (tsched.id('A'), tsched.id('ver-a'), 'itcs_theory_after_14', 'x');
    RAISE EXCEPTION 'TEST_FAIL: ITCS rule waived';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.scheduling_policy_exceptions(college_id, schedule_version_id, rule_code, reason, approved_by)
  VALUES (tsched.id('A'), tsched.id('ver-a'), 'delivery_group_conflict', 'بيانات مجموعات قديمة', tsched.id('admin-a'))
  RETURNING * INTO w;
  PERFORM tsched.assert(w.approved_by = tsched.id('super'), 'approver forced to caller');
  r := public.validate_schedule_version(tsched.id('ver-a'));
  PERFORM tsched.assert((r->>'hard_count')::int = 0 AND (r->>'waived_count')::int = 1, (r - 'conflicts')::text);
  PERFORM tsched.assert(r->'warnings'->0->>'code' = 'delivery_group_conflict' AND (r->'warnings'->0->>'waived')::boolean,
    'waived conflict is shown as a warning');
  -- An expired waiver no longer applies.
  UPDATE public.scheduling_policy_exceptions SET expires_at = now() - interval '1 day' WHERE id = w.id;
  r := public.validate_schedule_version(tsched.id('ver-a'));
  PERFORM tsched.assert((r->>'hard_count')::int = 1, 'expired waiver applied');
END $t$;
RESET ROLE;

-- Protected versions cannot be purged (formerly a UUID literal in the function).
UPDATE public.schedule_versions SET disposable_test = true, protected = true WHERE id = tsched.id('ver-a');
SELECT tsched.as_user('super');
SET ROLE authenticated;
DO $t$
BEGIN
  BEGIN
    PERFORM public.purge_disposable_draft_schedule_version(tsched.id('ver-a'));
    RAISE EXCEPTION 'TEST_FAIL: protected version purged';
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM tsched.assert(SQLERRM = 'PURGE_PROTECTED_VERSION', SQLERRM);
  END;
END $t$;
RESET ROLE;
SELECT tsched.assert(position('835e50fe' IN pg_get_functiondef('public.purge_disposable_draft_schedule_version(uuid)'::regprocedure)) = 0,
  'no literal version id in the purge function');
ROLLBACK;
SELECT 'PASS: sched-policy-exceptions-db (M-11)' AS result;

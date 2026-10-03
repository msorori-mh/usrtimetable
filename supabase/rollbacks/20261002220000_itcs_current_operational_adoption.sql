-- Schema rollback is allowed only before the registered data action commits.
-- After adoption, recover through a reviewed authenticated timetable action;
-- never discard the withdrawal ledger or reinterpret published history.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $rollback$
DECLARE d record;
BEGIN
 LOCK TABLE assignment_version_private.operational_scope_withdrawals IN ACCESS EXCLUSIVE MODE;
 LOCK TABLE itcs_cutover_private.operational_adoption_profiles IN ACCESS EXCLUSIVE MODE;
 IF EXISTS (SELECT 1 FROM assignment_version_private.operational_scope_withdrawals)
  OR EXISTS (SELECT 1 FROM itcs_cutover_private.runs r
    JOIN itcs_cutover_private.operational_adoption_profiles p ON p.manifest_sha=r.manifest_sha
    WHERE r.stage IN ('applied','published')) THEN
  RAISE EXCEPTION 'OPERATIONAL_ADOPTION_ROLLBACK_AFTER_DATA_APPLY_FORBIDDEN' USING ERRCODE='23514'; END IF;
 FOR d IN SELECT * FROM itcs_cutover_private.operational_adoption_original_defs ORDER BY signature LOOP
  IF d.installed_hash IS NULL OR md5(pg_get_functiondef(d.signature::regprocedure)) IS DISTINCT FROM d.installed_hash THEN
   RAISE EXCEPTION 'OPERATIONAL_ADOPTION_ROLLBACK_FUNCTION_DRIFT: %',d.signature USING ERRCODE='23514'; END IF;
  EXECUTE d.definition;
 END LOOP;
END $rollback$;
DROP FUNCTION public.itcs_operational_adoption_preview(text);
DROP FUNCTION itcs_cutover_private.operational_adoption_execute(text,uuid,uuid,jsonb,text,text);
DROP FUNCTION itcs_cutover_private.assert_operational_adoption_target(text);
DROP FUNCTION itcs_cutover_private.assert_operational_adoption_reference(text);
DROP FUNCTION itcs_cutover_private.assert_operational_adoption_history(text);
DROP FUNCTION itcs_cutover_private.operational_adoption_assignment_snapshot(text);
DROP FUNCTION itcs_cutover_private.operational_adoption_scope_snapshot(text);
DROP FUNCTION itcs_cutover_private.operational_adoption_immutable_snapshot(uuid);
DROP TABLE assignment_version_private.operational_scope_withdrawals;
DROP TABLE itcs_cutover_private.operational_adoption_profiles;
DROP TABLE itcs_cutover_private.operational_adoption_original_defs;
NOTIFY pgrst,'reload schema';
COMMIT;

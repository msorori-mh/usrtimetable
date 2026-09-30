-- A circular reassignment can transiently increase one lecturer's load. The
-- native importer checks the whole projected load after all official decisions
-- in the same transaction. Ordinary replacement calls keep immediate checking.
BEGIN;
ALTER TABLE itcs_cutover_private.native_review_profiles ADD COLUMN applying_txid bigint;
DO $patch$
DECLARE d text; old_text text; new_text text;
BEGIN
 d:=pg_get_functiondef('itcs_cutover_private.native_review_execute(text,uuid,uuid,jsonb,text,text)'::regprocedure);
 old_text:='UPDATE itcs_cutover_private.native_review_profiles SET draft_version_id=v WHERE profile=p.profile;';
 new_text:='UPDATE itcs_cutover_private.native_review_profiles SET draft_version_id=v,applying_txid=txid_current() WHERE profile=p.profile;';
 IF position(old_text IN d)=0 THEN RAISE EXCEPTION 'NATIVE_ASSIGNMENT_START_DRIFT'; END IF;
 d:=replace(d,old_text,new_text);
 old_text:='UPDATE itcs_cutover_private.native_review_profiles SET receipt=result WHERE profile=p.profile;';
 new_text:='UPDATE itcs_cutover_private.native_review_profiles SET receipt=result,applying_txid=NULL WHERE profile=p.profile;';
 IF position(old_text IN d)=0 OR position('PERFORM assignment_version_private.assert_projected_load(v);' IN d)=0 THEN
  RAISE EXCEPTION 'NATIVE_FINAL_LOAD_GUARD_REQUIRED'; END IF;
 EXECUTE replace(d,old_text,new_text);
 d:=pg_get_functiondef('assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid)'::regprocedure);
 old_text:='  PERFORM assignment_version_private.assert_projected_load(p_version);';
 new_text:='  IF NOT EXISTS(SELECT 1 FROM itcs_cutover_private.native_review_profiles p
    WHERE p.draft_version_id=p_version AND p.receipt IS NULL
      AND p.applying_txid=txid_current()) THEN
    PERFORM assignment_version_private.assert_projected_load(p_version);
  END IF;';
 IF (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 THEN
  RAISE EXCEPTION 'REPLACEMENT_LOAD_GUARD_DRIFT'; END IF;
 EXECUTE replace(d,old_text,new_text);
END $patch$;
COMMIT;

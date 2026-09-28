-- A sealed draft may need a room correction after its full quality check.
-- Reconstruct the previously approved manifest from the live rooms and demand
-- its exact receipt hash. Every other manifest value must remain identical.
BEGIN;
CREATE FUNCTION itcs_cutover_private.amend_rooms(
 p_version uuid,p_published uuid,p_manifest jsonb,p_manifest_sha text,p_expected_published_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_base jsonb; v_base_sha text; v_before text; v_after text; v_prior jsonb;
 v_moves jsonb; v_result jsonb; v_rules jsonb; v_college uuid; v_count integer;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
  RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_manifest IS NULL OR md5(p_manifest::text) IS DISTINCT FROM p_manifest_sha
    OR jsonb_typeof(p_manifest->'sessions') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'MANIFEST_HASH_MISMATCH' USING ERRCODE='23514'; END IF;
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM itcs_cutover_private.assert_history(p_manifest);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_version::text,9174));
 SELECT college_id INTO v_college FROM public.schedule_versions WHERE id=p_version AND status='draft' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'VERSION_NOT_DRAFT' USING ERRCODE='23514'; END IF;
 -- A replay must still match the exact saved result.
 SELECT result INTO v_result FROM itcs_cutover_private.runs
 WHERE version_id=p_version AND manifest_sha=p_manifest_sha AND stage='applied';
 v_before:=public.schedule_version_session_snapshot(p_version);
 IF v_result IS NOT NULL THEN
  IF v_before IS DISTINCT FROM v_result->>'after_snapshot' THEN
   RAISE EXCEPTION 'APPLIED_RECEIPT_DRIFT' USING ERRCODE='23514'; END IF;
  RETURN v_result||jsonb_build_object('replayed',true);
 END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_manifest->'sessions') x
   LEFT JOIN public.schedule_sessions s ON s.id=(x->>'session_id')::uuid AND s.schedule_version_id=p_version
   WHERE s.id IS NULL OR s.room_id IS NULL OR nullif(x->'new'->>'room','') IS NULL) THEN
  RAISE EXCEPTION 'ROOM_AMENDMENT_SESSION_MISMATCH' USING ERRCODE='23514'; END IF;
 SELECT jsonb_set(p_manifest,'{sessions}',jsonb_agg(
   jsonb_set(x.value,'{new,room}',to_jsonb(s.room_id::text)) ORDER BY x.ordinality)) INTO v_base
 FROM jsonb_array_elements(p_manifest->'sessions') WITH ORDINALITY x(value,ordinality)
 JOIN public.schedule_sessions s ON s.id=(x.value->>'session_id')::uuid AND s.schedule_version_id=p_version;
 v_base_sha:=md5(v_base::text);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_manifest->'sessions') x
   WHERE (x->>'changed')::boolean IS NOT DISTINCT FROM (
     x->'old'->>'day'=x->'new'->>'day' AND (x->'old'->>'start')::time=(x->'new'->>'start')::time
     AND (x->'old'->>'end')::time=(x->'new'->>'end')::time AND x->'old'->>'room'=x->'new'->>'room')) THEN
  RAISE EXCEPTION 'ROOM_AMENDMENT_CHANGED_FLAG_INVALID' USING ERRCODE='23514'; END IF;
 SELECT result INTO v_prior FROM itcs_cutover_private.runs
 WHERE version_id=p_version AND manifest_sha=v_base_sha AND stage='applied' FOR UPDATE;
 IF v_prior IS NULL OR v_before IS DISTINCT FROM v_prior->>'after_snapshot'
    OR NOT EXISTS(SELECT 1 FROM assignment_version_private.publish_expectation
      WHERE version_id=p_version AND expected_snapshot=v_before) THEN
  RAISE EXCEPTION 'ROOM_AMENDMENT_NOT_BOUND_TO_APPLIED_MANIFEST' USING ERRCODE='23514'; END IF;
 -- Includes identity/count checks, lecturer CAS, authorization, published
 -- history hashes and both version locks, against the reconstructed receipt.
 PERFORM itcs_cutover_private.preflight(p_version,p_published,v_base,v_base_sha,p_expected_published_snapshot);
 IF EXISTS(SELECT 1 FROM itcs_cutover_private.replacement_status(p_version,p_manifest) r
   WHERE r.state<>'applied' OR NOT r.relinked) THEN
  RAISE EXCEPTION 'REPLACEMENTS_NOT_ALL_APPLIED' USING ERRCODE='23514'; END IF;
 SELECT jsonb_agg(jsonb_build_object('session_id',s.id,'day_of_week',s.day_of_week,
   'start_time',s.start_time,'end_time',s.end_time,'room_id',x->'new'->>'room')),
   count(*) INTO v_moves,v_count
 FROM jsonb_array_elements(p_manifest->'sessions') x
 JOIN public.schedule_sessions s ON s.id=(x->>'session_id')::uuid AND s.schedule_version_id=p_version
 WHERE s.room_id IS DISTINCT FROM (x->'new'->>'room')::uuid;
 IF v_count=0 THEN RAISE EXCEPTION 'ROOM_AMENDMENT_EMPTY' USING ERRCODE='23514'; END IF;
 v_after:=public.preview_version_session_moves(p_version,v_moves);
 v_result:=public.apply_version_session_moves(p_version,v_moves,v_count,v_before,v_after);
 IF EXISTS(SELECT 1 FROM public.schedule_sessions s LEFT JOIN public.rooms r ON r.id=s.room_id
   WHERE s.schedule_version_id=p_version AND (r.id IS NULL OR NOT r.is_active OR r.college_id<>v_college
     OR public.is_assignment_room_compatible(v_college,s.teaching_assignment_id,s.room_id) IS DISTINCT FROM true)) THEN
  RAISE EXCEPTION 'ROOM_AMENDMENT_INCOMPATIBLE' USING ERRCODE='23514'; END IF;
 v_rules:=public.itcs_cutover_path_rules(p_version);
 IF NOT (v_rules->>'ok')::boolean THEN
  RAISE EXCEPTION 'PATH_RULES_FAILED: %',v_rules USING ERRCODE='23514'; END IF;
 PERFORM itcs_cutover_private.assert_history(p_manifest);
 PERFORM public.seal_version_publish_expectation(p_version,jsonb_array_length(p_manifest->'sessions'),v_after);
 v_result:=jsonb_build_object('ok',true,'stage','applied','room_only_amendment',true,
   'previous_manifest_sha',v_base_sha,'moves',v_result,'rules',v_rules,'after_snapshot',v_after);
 INSERT INTO itcs_cutover_private.runs(version_id,manifest_sha,stage,result,actor)
 VALUES(p_version,p_manifest_sha,'applied',v_result,auth.uid());
 INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
 VALUES(auth.uid(),'itcs_cutover_room_amendment','schedule_versions',p_version,v_college,
   jsonb_build_object('manifest_sha',p_manifest_sha,'previous_manifest_sha',v_base_sha,
     'before_snapshot',v_before,'after_snapshot',v_after,'moves',v_moves));
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION itcs_cutover_private.amend_rooms(uuid,uuid,jsonb,text,text) FROM PUBLIC;

DO $patch$
DECLARE d text:=pg_get_functiondef('public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text)'::regprocedure);
 needle text:='  IF p_stage NOT IN (';
BEGIN
 IF (length(d)-length(replace(d,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'ROOM_AMENDMENT_ENTRYPOINT_DRIFT'; END IF;
 EXECUTE replace(d,needle,
 '  IF p_stage=''rooms'' THEN
    RETURN itcs_cutover_private.amend_rooms(p_version,p_published,p_manifest,p_manifest_sha,p_expected_published_snapshot);
  END IF;
'||needle);
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;

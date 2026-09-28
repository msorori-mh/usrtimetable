-- A reviewed relayout of the current publication, through the same SuperAdmin
-- cutover entrypoint. Clone + current-assignment reconciliation + moves are
-- atomic. The allowlist binds exact source, manifest, target and history hashes.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE itcs_cutover_private.relayout_profiles(
 profile text PRIMARY KEY, source_version_id uuid NOT NULL,
 college_id uuid NOT NULL, term_id uuid NOT NULL,
 manifest_sha text NOT NULL UNIQUE, source_snapshot text NOT NULL,
 source_full_snapshot text NOT NULL, source_facts_snapshot text NOT NULL,
 target_fingerprint text NOT NULL, history jsonb NOT NULL,
 draft_version_id uuid UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE itcs_cutover_private.relayout_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON itcs_cutover_private.relayout_profiles FROM PUBLIC,anon,authenticated;

CREATE FUNCTION itcs_cutover_private.delivery_facts_snapshot(p_version uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t text; j jsonb; all_facts jsonb:='{}';
BEGIN
 FOREACH t IN ARRAY ARRAY['scope','cohort_facts','group_facts','partner_group_facts',
 'partition_facts','group_partition_facts','shared_link_facts','partner_partition_facts',
 'component_room_type_facts','instructor_hour_waivers'] LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(f)-''version_id'' ORDER BY (to_jsonb(f)-''version_id'')::text),''[]'') FROM schedule_version_delivery_private.%I f WHERE version_id=$1',t) INTO j USING p_version;
  all_facts:=all_facts||jsonb_build_object(t,j);
 END LOOP;
 RETURN md5(all_facts::text);
END $$;
CREATE FUNCTION itcs_cutover_private.relayout_fingerprint(p_version uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT md5(jsonb_agg(to_jsonb(s)-ARRAY['id','schedule_version_id','created_at','updated_at','auto_schedule_run_id'] ORDER BY s.delivery_group_id)::text)
 FROM public.schedule_sessions s WHERE s.schedule_version_id=p_version
$$;
CREATE FUNCTION itcs_cutover_private.assert_relayout_history(p_profile text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h record; n integer; snap text;
BEGIN
 FOR h IN SELECT x.* FROM itcs_cutover_private.relayout_profiles p,
 jsonb_to_recordset(p.history) x(version_id uuid,sessions integer,snapshot text,full_snapshot text)
 WHERE p.profile=p_profile ORDER BY version_id LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(h.version_id::text,9174));
  PERFORM 1 FROM public.schedule_versions WHERE id=h.version_id FOR UPDATE;
  SELECT count(*),md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) INTO n,snap
  FROM public.schedule_sessions s WHERE schedule_version_id=h.version_id;
  IF n<>h.sessions OR snap IS DISTINCT FROM h.full_snapshot
    OR public.schedule_version_session_snapshot(h.version_id) IS DISTINCT FROM h.snapshot THEN
   RAISE EXCEPTION 'RELAYOUT_HISTORY_DRIFT %',h.version_id USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION itcs_cutover_private.delivery_facts_snapshot(uuid),
 itcs_cutover_private.relayout_fingerprint(uuid),itcs_cutover_private.assert_relayout_history(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION itcs_cutover_private.relayout_execute(p_stage text,p_version uuid,p_published uuid,
 p_manifest jsonb,p_manifest_sha text,p_expected_published_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p itcs_cutover_private.relayout_profiles%ROWTYPE;
 v public.schedule_versions%ROWTYPE; result jsonb; prior jsonb; cloned jsonb;
 moves jsonb; n integer; before_snap text; after_snap text; rules jsonb; gate jsonb; q record;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
  RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_stage NOT IN ('apply','publish') THEN RAISE EXCEPTION 'RELAYOUT_STAGE_INVALID'; END IF;
 SELECT * INTO p FROM itcs_cutover_private.relayout_profiles WHERE profile=p_manifest->>'profile' FOR UPDATE;
 IF NOT FOUND OR md5(p_manifest::text) IS DISTINCT FROM p.manifest_sha
    OR p_manifest_sha IS DISTINCT FROM p.manifest_sha
    OR p_published IS DISTINCT FROM p.source_version_id
    OR p_expected_published_snapshot IS DISTINCT FROM p.source_snapshot
    OR p_version NOT IN (p.source_version_id,coalesce(p.draft_version_id,p.source_version_id)) THEN
  RAISE EXCEPTION 'UNREGISTERED_RELAYOUT_MANIFEST' USING ERRCODE='23514'; END IF;
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM itcs_cutover_private.assert_relayout_history(p.profile);
 IF itcs_cutover_private.delivery_facts_snapshot(p.source_version_id) IS DISTINCT FROM p.source_facts_snapshot THEN
  RAISE EXCEPTION 'RELAYOUT_SOURCE_MEMBERSHIP_DRIFT' USING ERRCODE='23514'; END IF;
 IF p.draft_version_id IS NOT NULL THEN
  SELECT * INTO v FROM public.schedule_versions WHERE id=p.draft_version_id FOR UPDATE;
  IF v.college_id IS DISTINCT FROM p.college_id OR v.academic_term_id IS DISTINCT FROM p.term_id
   OR NOT EXISTS(SELECT 1 FROM schedule_version_delivery_private.clone_provenance
    WHERE version_id=v.id AND source_version_id=p.source_version_id)
   OR itcs_cutover_private.relayout_fingerprint(v.id) IS DISTINCT FROM p.target_fingerprint
   OR itcs_cutover_private.delivery_facts_snapshot(v.id) IS DISTINCT FROM p.source_facts_snapshot THEN
   RAISE EXCEPTION 'RELAYOUT_DRAFT_DRIFT' USING ERRCODE='23514'; END IF;
  SELECT r.result INTO prior FROM itcs_cutover_private.runs r
   WHERE version_id=v.id AND manifest_sha=p.manifest_sha AND stage='applied';
  IF prior IS NULL OR public.schedule_version_session_snapshot(v.id) IS DISTINCT FROM prior->>'after_snapshot' THEN
   RAISE EXCEPTION 'RELAYOUT_RECEIPT_DRIFT' USING ERRCODE='23514'; END IF;
  IF p_stage='apply' THEN
   IF v.status<>'draft' THEN RAISE EXCEPTION 'VERSION_NOT_DRAFT'; END IF;
   RETURN prior||jsonb_build_object('replayed',true);
  END IF;
  SELECT r.result INTO result FROM itcs_cutover_private.runs r
   WHERE version_id=v.id AND manifest_sha=p.manifest_sha AND stage='published';
  IF result IS NOT NULL THEN
   IF v.status<>'published' THEN RAISE EXCEPTION 'CUTOVER_RECEIPT_STATE_MISMATCH'; END IF;
   RETURN result||jsonb_build_object('replayed',true);
  END IF;
 END IF;
 IF (SELECT status FROM public.schedule_versions WHERE id=p.source_version_id)<>'published' THEN
  RAISE EXCEPTION 'PUBLISHED_BASELINE_NOT_PUBLISHED'; END IF;

 IF p_stage='apply' THEN
  -- Existing active teaching assignments are authoritative. Never reactivate
  -- the two deactivated assignments or modify historical published sessions.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_manifest->'assignment_updates') x
    LEFT JOIN public.teaching_assignments a ON a.id=(x->>'new_assignment')::uuid
    WHERE a.id IS NULL OR NOT a.is_active OR a.college_id<>p.college_id
      OR a.delivery_group_id IS DISTINCT FROM (x->>'group_id')::uuid
      OR a.instructor_id IS DISTINCT FROM (x->>'new_instructor')::uuid) THEN
   RAISE EXCEPTION 'RELAYOUT_ACTIVE_ASSIGNMENT_DRIFT'; END IF;
  cloned:=public.clone_schedule_version_current(p.college_id,p.source_version_id,p.term_id,
   'ITCS — التوزيع المدقق ووثيق الأربعاء 8 — 28-09-2026',
   'تطبيق البيان المدقق؛ حفظ جميع المحاضرات والساعات ومسارات الطلاب؛ مطابقة الإسنادات الحالية.',false,false);
  IF (cloned->>'sessions_copied')::int<>280 OR (cloned->>'sessions_skipped')::int<>2
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(cloned->'skipped_sessions') s
    WHERE s->>'reason'<>'inactive_assignment' OR NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(p_manifest->'assignment_updates') x
     WHERE x->>'source_session_id'=s->>'session_id' AND x->>'old_assignment'=s->>'teaching_assignment_id')) THEN
   RAISE EXCEPTION 'RELAYOUT_CLONE_RECONCILIATION_DRIFT'; END IF;
  SELECT * INTO v FROM public.schedule_versions WHERE id=(cloned->>'version_id')::uuid FOR UPDATE;
  -- Carried exceptions belong to previous placements. This relayout must pass
  -- the real guards without any exception masking a new conflict.
  UPDATE public.schedule_version_conflict_exceptions SET status='revoked'
   WHERE schedule_version_id=v.id AND status='approved';
  SELECT jsonb_agg(jsonb_build_object('session_id',s.id,'day_of_week',(x->'new'->>'day')::int,
    'start_time',x->'new'->>'start','end_time',x->'new'->>'end','room_id',x->'new'->>'room')),count(*)
   INTO moves,n FROM jsonb_array_elements(p_manifest->'sessions') x
   JOIN public.schedule_sessions s ON s.schedule_version_id=v.id AND s.delivery_group_id=(x->>'delivery_group_id')::uuid
   WHERE (s.day_of_week,s.start_time,s.end_time,s.room_id) IS DISTINCT FROM
    ((x->'new'->>'day')::smallint,(x->'new'->>'start')::time,(x->'new'->>'end')::time,(x->'new'->>'room')::uuid);
  before_snap:=public.schedule_version_session_snapshot(v.id);
  after_snap:=public.preview_version_session_moves(v.id,moves);
  PERFORM public.apply_version_session_moves(v.id,moves,n,before_snap,after_snap);
  INSERT INTO public.schedule_sessions(college_id,schedule_version_id,course_offering_id,
    teaching_assignment_id,instructor_id,room_id,section_id,section_group_id,section_subgroup_id,
    cohort_id,delivery_group_id,plan_course_component_id,study_system,day_of_week,start_time,end_time,
    session_type,expected_students,source_type,is_locked,lock_reason)
  SELECT s.college_id,v.id,s.course_offering_id,(u->>'new_assignment')::uuid,(u->>'new_instructor')::uuid,
    (x->'new'->>'room')::uuid,s.section_id,s.section_group_id,s.section_subgroup_id,s.cohort_id,
    s.delivery_group_id,s.plan_course_component_id,s.study_system,(x->'new'->>'day')::smallint,
    (x->'new'->>'start')::time,(x->'new'->>'end')::time,s.session_type,s.expected_students,s.source_type,s.is_locked,s.lock_reason
   FROM jsonb_array_elements(p_manifest->'assignment_updates') u
   JOIN public.schedule_sessions s ON s.id=(u->>'source_session_id')::uuid AND s.schedule_version_id=p.source_version_id
   JOIN jsonb_array_elements(p_manifest->'sessions') x ON x->>'session_id'=s.id::text;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>2 OR (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id=v.id)<>282
   OR itcs_cutover_private.relayout_fingerprint(v.id) IS DISTINCT FROM p.target_fingerprint
   OR itcs_cutover_private.delivery_facts_snapshot(v.id) IS DISTINCT FROM p.source_facts_snapshot THEN
   RAISE EXCEPTION 'RELAYOUT_TARGET_MISMATCH'; END IF;
  PERFORM assignment_version_private.assert_version_instructors(v.id);
  rules:=public.itcs_cutover_path_rules(v.id);
  IF (rules->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'PATH_RULES_FAILED: %',rules; END IF;
  after_snap:=public.schedule_version_session_snapshot(v.id);
  PERFORM public.seal_version_publish_expectation(v.id,282,after_snap);
  gate:=public.version_scoped_publish_gate(v.id);
  IF (gate->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'RELAYOUT_COVERAGE_FAILED: %',gate; END IF;
  PERFORM itcs_cutover_private.assert_relayout_history(p.profile);
  UPDATE itcs_cutover_private.relayout_profiles SET draft_version_id=v.id WHERE profile=p.profile;
  result:=jsonb_build_object('ok',true,'stage','applied','version_id',v.id,'sessions',282,'hours',644,
   'reconciled_assignments',2,'after_snapshot',after_snap,'rules',rules,'gate',gate);
  INSERT INTO itcs_cutover_private.runs(version_id,manifest_sha,stage,result,actor)
   VALUES(v.id,p.manifest_sha,'applied',result,auth.uid());
 ELSE
  IF p.draft_version_id IS NULL OR v.status<>'draft' THEN RAISE EXCEPTION 'APPLY_STAGE_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM assignment_version_private.publish_expectation
    WHERE version_id=v.id AND expected_sessions=282 AND expected_snapshot=prior->>'after_snapshot') THEN
   RAISE EXCEPTION 'SEAL_BROKEN'; END IF;
  SELECT * INTO q FROM public.schedule_quality_runs WHERE schedule_version_id=v.id AND college_id=p.college_id
   ORDER BY created_at DESC,id DESC LIMIT 1;
  IF q.id IS NULL OR q.eligibility_revision IS DISTINCT FROM v.eligibility_revision OR q.hard_conflicts_count<>0
   OR q.created_at<(SELECT created_at FROM itcs_cutover_private.runs WHERE version_id=v.id AND manifest_sha=p.manifest_sha AND stage='applied') THEN
   RAISE EXCEPTION 'QUALITY_RUN_REQUIRED_AT_CURRENT_REVISION'; END IF;
  rules:=public.itcs_cutover_path_rules(v.id);gate:=public.version_scoped_publish_gate(v.id);
  IF (rules->>'ok')::boolean IS DISTINCT FROM true OR (gate->>'ok')::boolean IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'RELAYOUT_PUBLISH_GATE_FAILED'; END IF;
  PERFORM public.transition_schedule_version(p.college_id,v.id,'draft','review','Reviewed relayout '||p.manifest_sha);
  PERFORM public.transition_schedule_version(p.college_id,v.id,'review','approved','Reviewed relayout '||p.manifest_sha);
  PERFORM public.transition_schedule_version(p.college_id,v.id,'approved','published','Reviewed relayout '||p.manifest_sha);
  PERFORM public.transition_schedule_version(p.college_id,p.source_version_id,'published','archived','Superseded by reviewed relayout '||v.id);
  PERFORM itcs_cutover_private.assert_relayout_history(p.profile);
  IF (SELECT count(*) FROM public.schedule_versions WHERE college_id=p.college_id AND academic_term_id=p.term_id AND status='published')<>1 THEN
   RAISE EXCEPTION 'PUBLISHED_VERSION_COUNT_MISMATCH'; END IF;
  result:=jsonb_build_object('ok',true,'stage','published','version_id',v.id,'quality_run_id',q.id,
    'quality_revision',q.eligibility_revision,'sessions',282,'hours',644,'rules',rules,'gate',gate,'previous_sessions_preserved',838);
  INSERT INTO itcs_cutover_private.runs(version_id,manifest_sha,stage,result,actor)
   VALUES(v.id,p.manifest_sha,'published',result,auth.uid());
 END IF;
 INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
 VALUES(auth.uid(),'itcs_relayout_'||p_stage,'schedule_versions',v.id,p.college_id,result||jsonb_build_object('manifest_sha',p.manifest_sha));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION itcs_cutover_private.relayout_execute(text,uuid,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.itcs_relayout_preview(p_version uuid,p_manifest jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p itcs_cutover_private.relayout_profiles%ROWTYPE; j jsonb; v public.schedule_versions%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM itcs_cutover_private.relayout_profiles WHERE profile=p_manifest->>'profile';
 IF NOT FOUND OR p_version IS DISTINCT FROM p.source_version_id OR md5(p_manifest::text) IS DISTINCT FROM p.manifest_sha THEN
  RAISE EXCEPTION 'UNREGISTERED_RELAYOUT_MANIFEST'; END IF;
 j:=public.itcs_cutover_preview(p_version,p_manifest);
 IF p.draft_version_id IS NOT NULL THEN
  SELECT * INTO v FROM public.schedule_versions WHERE id=p.draft_version_id;
  IF itcs_cutover_private.relayout_fingerprint(v.id) IS DISTINCT FROM p.target_fingerprint THEN RAISE EXCEPTION 'RELAYOUT_DRAFT_DRIFT'; END IF;
  j:=j||jsonb_build_object('runs',(SELECT coalesce(jsonb_agg(jsonb_build_object('stage',stage,'at',created_at)),'[]') FROM itcs_cutover_private.runs WHERE version_id=v.id AND manifest_sha=p.manifest_sha));
 END IF;
 RETURN j||jsonb_build_object('version_status',coalesce(v.status,'draft'),'relayout_version_id',p.draft_version_id);
END $$;
REVOKE ALL ON FUNCTION public.itcs_relayout_preview(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.itcs_relayout_preview(uuid,jsonb) TO authenticated;
DO $patch$
DECLARE d text:=pg_get_functiondef('public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text)'::regprocedure);
 needle text:='  IF p_stage=''rooms'' THEN';
BEGIN
 IF (length(d)-length(replace(d,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'RELAYOUT_ENTRYPOINT_DRIFT'; END IF;
 EXECUTE replace(d,needle,
 '  IF p_manifest->>''profile''=''compliance_20260928_wathiq08'' THEN
    RETURN itcs_cutover_private.relayout_execute(p_stage,p_version,p_published,p_manifest,p_manifest_sha,p_expected_published_snapshot);
  END IF;
'||needle);
END $patch$;
-- REGISTRATION follows; only hashes and exact identifiers, no timetable payload.
INSERT INTO itcs_cutover_private.relayout_profiles(profile,source_version_id,college_id,term_id,manifest_sha,source_snapshot,source_full_snapshot,source_facts_snapshot,target_fingerprint,history) VALUES(
 'compliance_20260928_wathiq08','258f6f60-539e-43e1-a4bb-f0b07c20c9ab','7168345f-cf9d-4789-b2ad-547abb687dc8','18dd364a-76d7-40b8-a217-fa929c082a7f',
 'd922474423ef21f518915945454e0bbf','c4e786798474ae704751849b45b73c7b','d49ae5ffc2c3c59389cee4f04d6f70af',itcs_cutover_private.delivery_facts_snapshot('258f6f60-539e-43e1-a4bb-f0b07c20c9ab'),'9127ede6fc999d56ce37d6386e010995','[{"full_snapshot":"d49ae5ffc2c3c59389cee4f04d6f70af","sessions":282,"snapshot":"c4e786798474ae704751849b45b73c7b","version_id":"258f6f60-539e-43e1-a4bb-f0b07c20c9ab"},{"full_snapshot":"b15a27448cc2fbadc019bdf69899226b","sessions":274,"snapshot":"0bb96727cffc817bd1976e85d446cf26","version_id":"30f8a76d-1cb9-4944-a5d7-483dcaea7692"},{"full_snapshot":"6f8a5d5989ef914686c5c987fa3c34e5","sessions":282,"snapshot":"571086e4effc51e0cdd08330bcc8531f","version_id":"d68d8d22-9a6d-4f21-935f-cebf18bb969b"}]'::jsonb);
NOTIFY pgrst,'reload schema';
COMMIT;

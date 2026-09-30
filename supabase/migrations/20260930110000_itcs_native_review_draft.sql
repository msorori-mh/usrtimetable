-- Registered, draft-only imports. The authenticated cutover RPC remains the
-- sole writer; neither registration nor preview can publish a timetable.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE itcs_cutover_private.native_review_profiles(
 profile text PRIMARY KEY, manifest jsonb NOT NULL, manifest_sha text NOT NULL,
 source_version_id uuid NOT NULL REFERENCES public.schedule_versions(id),
 source_snapshot text NOT NULL, source_full_snapshot text NOT NULL,
 source_facts_snapshot text NOT NULL, source_assignments jsonb NOT NULL,
 draft_version_id uuid UNIQUE REFERENCES public.schedule_versions(id),
 receipt jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE itcs_cutover_private.native_review_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON itcs_cutover_private.native_review_profiles FROM PUBLIC,anon,authenticated;

-- The same teaching allocation can belong to separate versions. Keep global
-- uniqueness AND uniqueness within a version; clients cannot choose the scope.
ALTER TABLE public.teaching_assignments ADD COLUMN scope_version_id uuid
 REFERENCES public.schedule_versions(id);
CREATE FUNCTION assignment_version_private.derive_assignment_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actual uuid;
BEGIN
 SELECT version_id INTO actual FROM assignment_version_private.scope WHERE assignment_id=NEW.id;
 IF NEW.scope_version_id IS NOT NULL AND NEW.scope_version_id IS DISTINCT FROM actual THEN
  RAISE EXCEPTION 'ASSIGNMENT_SCOPE_MISMATCH' USING ERRCODE='23514'; END IF;
 NEW.scope_version_id:=actual;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION assignment_version_private.derive_assignment_scope() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER a_derive_assignment_scope BEFORE INSERT OR UPDATE ON public.teaching_assignments
 FOR EACH ROW EXECUTE FUNCTION assignment_version_private.derive_assignment_scope();
UPDATE public.teaching_assignments a SET scope_version_id=s.version_id
 FROM assignment_version_private.scope s WHERE s.assignment_id=a.id;
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;
CREATE UNIQUE INDEX ta_global_unique ON public.teaching_assignments
 (college_id,course_offering_id,instructor_id,session_type,coalesce(section_number,''))
 WHERE scope_version_id IS NULL;
CREATE UNIQUE INDEX ta_scope_unique ON public.teaching_assignments
 (scope_version_id,college_id,course_offering_id,instructor_id,session_type,coalesce(section_number,''))
 WHERE scope_version_id IS NOT NULL;
CREATE UNIQUE INDEX ta_global_group_instructor_unique ON public.teaching_assignments
 (college_id,delivery_group_id,instructor_id)
 WHERE delivery_group_id IS NOT NULL AND is_active AND scope_version_id IS NULL;
CREATE UNIQUE INDEX ta_scope_group_instructor_unique ON public.teaching_assignments
 (scope_version_id,college_id,delivery_group_id,instructor_id)
 WHERE delivery_group_id IS NOT NULL AND is_active AND scope_version_id IS NOT NULL;
DROP INDEX public.ta_unique;
DROP INDEX public.ta_v2_delivery_group_instructor_uniq;

-- A registered review draft gets a fresh assignment identity. Reusing an old
-- inactive row could change the meaning of a historical publication.
DO $patch$
DECLARE d text:=pg_get_functiondef('assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid)'::regprocedure);
 start_needle text:='  SELECT * INTO v_reuse FROM public.teaching_assignments t';
 end_needle text:='  INSERT INTO assignment_version_private.scope';
BEGIN
 IF (length(d)-length(replace(d,start_needle,'')))/length(start_needle)<>1
 OR (length(d)-length(replace(d,end_needle,'')))/length(end_needle)<>1 THEN
  RAISE EXCEPTION 'REVIEW_ASSIGNMENT_WRITER_DRIFT'; END IF;
 d:=replace(d,start_needle,'  IF NOT EXISTS(SELECT 1 FROM itcs_cutover_private.native_review_profiles WHERE draft_version_id=p_version) THEN'||E'\n'||start_needle);
 d:=replace(d,end_needle,'  END IF;'||E'\n'||end_needle);
 EXECUTE d;
END $patch$;

CREATE FUNCTION itcs_cutover_private.assert_native_review_source(p_profile text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p itcs_cutover_private.native_review_profiles%ROWTYPE; snap text;
BEGIN
 SELECT * INTO STRICT p FROM itcs_cutover_private.native_review_profiles WHERE profile=p_profile;
 PERFORM pg_advisory_xact_lock(hashtextextended(p.source_version_id::text,9174));
 PERFORM 1 FROM public.schedule_versions WHERE id=p.source_version_id AND status='published' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_SOURCE_NOT_PUBLISHED'; END IF;
 SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) INTO snap
 FROM public.schedule_sessions s WHERE schedule_version_id=p.source_version_id;
 IF snap IS DISTINCT FROM p.source_full_snapshot
 OR public.schedule_version_session_snapshot(p.source_version_id) IS DISTINCT FROM p.source_snapshot
 OR itcs_cutover_private.delivery_facts_snapshot(p.source_version_id) IS DISTINCT FROM p.source_facts_snapshot
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.source_assignments) x
   LEFT JOIN public.teaching_assignments a ON a.id=(x->>'id')::uuid
   WHERE to_jsonb(a) IS DISTINCT FROM x) THEN
  RAISE EXCEPTION 'REVIEW_SOURCE_DRIFT' USING ERRCODE='23514'; END IF;
END $$;

CREATE FUNCTION itcs_cutover_private.native_review_execute(p_stage text,p_version uuid,p_published uuid,
 p_manifest jsonb,p_manifest_sha text,p_expected_published_snapshot text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p itcs_cutover_private.native_review_profiles%ROWTYPE;
 v uuid; cloned jsonb; moves jsonb; r jsonb; x jsonb; rules jsonb; result jsonb;
 n integer; hours numeric; snap text; before_snap text; after_snap text;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
  RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 IF p_stage NOT IN ('review_check','review_save') THEN RAISE EXCEPTION 'REVIEW_DRAFT_ONLY'; END IF;
 SELECT * INTO p FROM itcs_cutover_private.native_review_profiles WHERE profile=p_manifest->>'profile' FOR UPDATE;
 IF NOT FOUND OR p_manifest IS DISTINCT FROM jsonb_build_object('profile',p.profile)
 OR p_manifest_sha IS DISTINCT FROM p.manifest_sha OR p_version IS DISTINCT FROM p.source_version_id
 OR p_published IS DISTINCT FROM p.source_version_id
 OR p_expected_published_snapshot IS DISTINCT FROM p.source_snapshot THEN
  RAISE EXCEPTION 'UNREGISTERED_REVIEW_PROFILE' USING ERRCODE='23514'; END IF;
 PERFORM itcs_cutover_private.assert_native_review_source(p.profile);
 IF p.receipt IS NOT NULL THEN
  IF (SELECT status FROM public.schedule_versions WHERE id=p.draft_version_id) IS DISTINCT FROM 'draft'
  OR public.schedule_version_session_snapshot(p.draft_version_id) IS DISTINCT FROM p.receipt->>'after_snapshot'
  OR itcs_cutover_private.delivery_facts_snapshot(p.draft_version_id) IS DISTINCT FROM p.source_facts_snapshot THEN
   RAISE EXCEPTION 'REVIEW_DRAFT_DRIFT'; END IF;
  RETURN p.receipt||jsonb_build_object('replayed',true);
 END IF;
 -- The check stage runs this same writer inside a subtransaction which is
 -- unconditionally rolled back, including requests, assignments and audits.
 BEGIN
  cloned:=public.clone_schedule_version_current((p.manifest->>'college_id')::uuid,p.source_version_id,
   (p.manifest->>'term_id')::uuid,p.manifest->>'name',
   'النسخة المصححة للمراجعة قبل النشر؛ وفق التوزيع المسجل والمدقق.',false,false);
  v:=(cloned->>'version_id')::uuid;
  IF (cloned->>'sessions_copied')::int<>280 OR (cloned->>'sessions_skipped')::int<>2
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(cloned->'skipped_sessions') s
    WHERE s->>'reason'<>'inactive_assignment' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.manifest->'sessions') t
      WHERE (t->>'restore')::boolean AND t->>'source_session_id'=s->>'session_id')) THEN
   RAISE EXCEPTION 'REVIEW_CLONE_DRIFT'; END IF;
  UPDATE itcs_cutover_private.native_review_profiles SET draft_version_id=v WHERE profile=p.profile;
  INSERT INTO assignment_version_private.enabled_versions(version_id,college_code,note)
   VALUES(v,'ITCS','Registered proposal 16 review draft');
  UPDATE public.schedule_version_conflict_exceptions SET status='revoked'
   WHERE schedule_version_id=v AND status='approved';
  -- Normalize inherited promoted replacements to their unchanged active roots
  -- only in the new draft. This prevents replacement chains.
  UPDATE public.schedule_sessions s SET teaching_assignment_id=a.id,instructor_id=a.instructor_id
  FROM jsonb_array_elements(p.manifest->'sessions') t
  JOIN public.teaching_assignments a ON a.id=(t->>'parent_assignment_id')::uuid AND a.is_active
  WHERE s.schedule_version_id=v AND s.delivery_group_id=(t->>'delivery_group_id')::uuid AND (t->>'rebind')::boolean;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>6 THEN RAISE EXCEPTION 'REVIEW_ROOT_REBIND_DRIFT'; END IF;
  INSERT INTO public.schedule_sessions(college_id,schedule_version_id,course_offering_id,
   teaching_assignment_id,instructor_id,room_id,section_id,section_group_id,section_subgroup_id,
   cohort_id,delivery_group_id,plan_course_component_id,study_system,day_of_week,start_time,end_time,
   session_type,expected_students,source_type,is_locked,lock_reason)
  SELECT s.college_id,v,s.course_offering_id,a.id,a.instructor_id,s.room_id,s.section_id,s.section_group_id,
   s.section_subgroup_id,s.cohort_id,s.delivery_group_id,s.plan_course_component_id,s.study_system,
   s.day_of_week,s.start_time,s.end_time,s.session_type,s.expected_students,s.source_type,s.is_locked,s.lock_reason
  FROM jsonb_array_elements(p.manifest->'sessions') t
  JOIN public.schedule_sessions s ON s.id=(t->>'source_session_id')::uuid AND s.schedule_version_id=p.source_version_id
  JOIN public.teaching_assignments a ON a.id=(t->>'parent_assignment_id')::uuid AND a.is_active
  WHERE (t->>'restore')::boolean;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>2 THEN RAISE EXCEPTION 'REVIEW_RESTORE_DRIFT'; END IF;
  FOR x IN SELECT t FROM jsonb_array_elements(p.manifest->'replacements') t
   JOIN public.teaching_assignments a ON a.id=(t->>'replaces')::uuid
   ORDER BY coalesce((t->>'priority')::int,1),a.id LOOP
   IF (x->>'cross_college')::boolean THEN
    r:=public.submit_version_scoped_teaching_request(v,(x->>'replaces')::uuid,(x->>'instructor')::uuid,
      (x->>'hours')::numeric,'المقترح 16 — إسناد خاص بمسودة المراجعة');
    PERFORM public.decide_faculty_teaching_request((r->>'request_id')::uuid,'approved',
      'اعتماد إسنادات المسودة وفق توجيه المستخدم؛ المقترح 16');
   ELSE
    PERFORM public.create_version_scoped_replacement_assignment(v,(x->>'replaces')::uuid,
      (x->>'instructor')::uuid,(x->>'hours')::numeric);
   END IF;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('session_id',s.id,'day_of_week',(t->>'day_of_week')::int,
   'start_time',t->>'start_time','end_time',t->>'end_time','room_id',t->>'room_id')),count(*) INTO moves,n
  FROM jsonb_array_elements(p.manifest->'sessions') t
  JOIN public.schedule_sessions s ON s.schedule_version_id=v AND s.delivery_group_id=(t->>'delivery_group_id')::uuid
  WHERE (s.day_of_week,s.start_time,s.end_time,s.room_id) IS DISTINCT FROM
   ((t->>'day_of_week')::smallint,(t->>'start_time')::time,(t->>'end_time')::time,(t->>'room_id')::uuid);
  before_snap:=public.schedule_version_session_snapshot(v);
  after_snap:=public.preview_version_session_moves(v,moves);
  PERFORM public.apply_version_session_moves(v,moves,n,before_snap,after_snap);
  SET CONSTRAINTS public.scoped_cohort_instructors_final IMMEDIATE;
  SET CONSTRAINTS public.scoped_cohort_instructors_final DEFERRED;
  PERFORM assignment_version_private.assert_version_instructors(v);
  PERFORM assignment_version_private.assert_projected_load(v);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  SELECT count(*),sum(extract(epoch FROM end_time-start_time)/3600) INTO n,hours
   FROM public.schedule_sessions WHERE schedule_version_id=v;
  IF n<>282 OR hours<>644 OR itcs_cutover_private.delivery_facts_snapshot(v) IS DISTINCT FROM p.source_facts_snapshot
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.manifest->'sessions') t
    LEFT JOIN public.schedule_sessions s ON s.schedule_version_id=v AND s.delivery_group_id=(t->>'delivery_group_id')::uuid
    JOIN public.schedule_sessions original ON original.id=(t->>'source_session_id')::uuid
    WHERE s.id IS NULL OR (s.instructor_id,s.day_of_week,s.start_time,s.end_time,s.room_id) IS DISTINCT FROM
     ((t->>'instructor_id')::uuid,(t->>'day_of_week')::smallint,(t->>'start_time')::time,(t->>'end_time')::time,(t->>'room_id')::uuid)
     OR (to_jsonb(s)-ARRAY['id','schedule_version_id','teaching_assignment_id','instructor_id','day_of_week','start_time','end_time','room_id','created_at','updated_at','auto_schedule_run_id'])
       IS DISTINCT FROM (to_jsonb(original)-ARRAY['id','schedule_version_id','teaching_assignment_id','instructor_id','day_of_week','start_time','end_time','room_id','created_at','updated_at','auto_schedule_run_id'])) THEN
   RAISE EXCEPTION 'REVIEW_TARGET_MISMATCH'; END IF;
  rules:=public.itcs_cutover_path_rules(v);
  IF (rules->>'ok')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'REVIEW_PATH_RULES_FAILED: %',rules; END IF;
  PERFORM itcs_cutover_private.assert_native_review_source(p.profile);
  snap:=public.schedule_version_session_snapshot(v);
  result:=jsonb_build_object('ok',true,'status','draft','version_id',v,'name',p.manifest->>'name',
   'sessions',n,'hours',hours,'replacements',jsonb_array_length(p.manifest->'replacements'),
   'after_snapshot',snap,'rules',rules,'saved',p_stage='review_save');
  IF p_stage='review_check' THEN RAISE EXCEPTION USING ERRCODE='P1500',MESSAGE=result::text; END IF;
  UPDATE itcs_cutover_private.native_review_profiles SET receipt=result WHERE profile=p.profile;
  PERFORM itcs_cutover_private.save_review_proposal('save_review_proposal',p.source_version_id,p.source_version_id,
    jsonb_build_object('profile',p.profile),
    (SELECT payload_hash FROM itcs_cutover_private.review_proposal_registry WHERE profile=p.profile),p.source_snapshot);
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
   VALUES(auth.uid(),'itcs_review_draft_saved','schedule_versions',v,(p.manifest->>'college_id')::uuid,result);
 EXCEPTION WHEN SQLSTATE 'P1500' THEN
  GET STACKED DIAGNOSTICS snap=MESSAGE_TEXT;
  RETURN (snap::jsonb-'version_id')||jsonb_build_object('rolled_back',true);
 END;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION itcs_cutover_private.assert_native_review_source(text),
 itcs_cutover_private.native_review_execute(text,uuid,uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.itcs_native_draft_preview(p_profile text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE p itcs_cutover_private.native_review_profiles%ROWTYPE; r itcs_cutover_private.review_proposal_registry%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
  RAISE EXCEPTION 'SUPER_ADMIN_REQUIRED' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT p FROM itcs_cutover_private.native_review_profiles WHERE profile=p_profile;
 SELECT * INTO STRICT r FROM itcs_cutover_private.review_proposal_registry WHERE profile=p_profile;
 RETURN jsonb_build_object('profile',p.profile,'name',p.manifest->>'name','manifest_sha',p.manifest_sha,
  'source_version_id',p.source_version_id,'source_snapshot',p.source_snapshot,
  'sessions',jsonb_array_length(p.manifest->'sessions'),'hours',644,'replacements',jsonb_array_length(p.manifest->'replacements'),
  'version_id',p.draft_version_id,'receipt',p.receipt,'payload',r.payload);
END $$;
REVOKE ALL ON FUNCTION public.itcs_native_draft_preview(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.itcs_native_draft_preview(text) TO authenticated;
DO $patch$
DECLARE d text:=pg_get_functiondef('public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text)'::regprocedure);
 needle text:='  IF p_stage=''rooms'' THEN';
BEGIN
 IF (length(d)-length(replace(d,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'REVIEW_ENTRYPOINT_DRIFT'; END IF;
 EXECUTE replace(d,needle,
 '  IF p_manifest->>''profile''=''itcs_proposal16_review_20260930'' THEN
    RETURN itcs_cutover_private.native_review_execute(p_stage,p_version,p_published,p_manifest,p_manifest_sha,p_expected_published_snapshot);
  END IF;
'||needle);
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;

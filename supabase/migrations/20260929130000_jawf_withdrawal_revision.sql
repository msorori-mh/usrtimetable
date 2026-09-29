-- Preserve the published source timetable while preparing the two explicitly
-- requested withdrawals. This migration DOES NOT authorize partial publication.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE SCHEMA jawf_revision_private;
REVOKE ALL ON SCHEMA jawf_revision_private FROM PUBLIC,anon,authenticated;
CREATE TABLE jawf_revision_private.revisions (
 version_id uuid PRIMARY KEY REFERENCES public.schedule_versions(id),
 source_version_id uuid NOT NULL REFERENCES public.schedule_versions(id),
 source_session_hash text NOT NULL, source_ledger_hash text NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason))>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE jawf_revision_private.sessions (
 session_id uuid PRIMARY KEY,
 version_id uuid NOT NULL REFERENCES jawf_revision_private.revisions(version_id),
 source_session_id uuid NOT NULL REFERENCES public.schedule_sessions(id),
 original jsonb NOT NULL, expected jsonb NOT NULL,
 UNIQUE(version_id,source_session_id)
);
CREATE TABLE jawf_revision_private.withdrawals (
 version_id uuid NOT NULL REFERENCES jawf_revision_private.revisions(version_id),
 source_session_id uuid NOT NULL REFERENCES public.schedule_sessions(id),
 original jsonb NOT NULL, source_original jsonb NOT NULL,
 PRIMARY KEY(version_id,source_session_id)
);
ALTER TABLE jawf_revision_private.revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE jawf_revision_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE jawf_revision_private.withdrawals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA jawf_revision_private FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.jawf_revision_session_allowed(p_session public.schedule_sessions)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path='pg_catalog','public','jawf_revision_private' AS $$
 SELECT EXISTS(SELECT 1 FROM jawf_revision_private.sessions f
 JOIN jawf_revision_private.revisions r ON r.version_id=f.version_id
 JOIN public.schedule_versions v ON v.id=f.version_id
 JOIN public.schedule_versions old_v ON old_v.id=r.source_version_id
 JOIN public.schedule_sessions old_s ON old_s.id=f.source_session_id
 WHERE f.session_id=p_session.id AND f.version_id=p_session.schedule_version_id
 AND v.college_id='0d0e89c6-d041-43de-a448-249070ef6c81'::uuid
 AND p_session.college_id=v.college_id
 AND v.academic_term_id='a0963d5e-b042-4174-a325-a68599eae8ff'::uuid
 AND old_v.id='286e37d4-d45c-5942-b8e0-facdfed3081f'::uuid
 AND old_v.college_id=v.college_id AND old_v.academic_term_id=v.academic_term_id
 AND old_v.status IN ('published','archived')
 AND to_jsonb(old_s)=f.original
 AND to_jsonb(p_session)-ARRAY['created_at','updated_at']=f.expected-ARRAY['created_at','updated_at']);
$$;
REVOKE ALL ON FUNCTION public.jawf_revision_session_allowed(public.schedule_sessions) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jawf_revision_session_allowed(public.schedule_sessions) TO authenticated;

-- A verified copy inherits ONLY its original source-backed room/identity facts.
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('public.jawf_term_source_session_allowed(public.schedule_sessions)'::regprocedure);
 IF position('SELECT p_session.college_id=' IN d)=0 OR position('jawf_revision_session_allowed' IN d)>0 THEN
 RAISE EXCEPTION 'JAWF_REVISION_POLICY_DRIFT'; END IF;
 d:=replace(d,'SELECT p_session.college_id=',
 'SELECT public.jawf_revision_session_allowed(p_session) OR p_session.college_id=');
 EXECUTE d;
END; $$;

CREATE FUNCTION jawf_revision_private.guard_sessions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog','public','jawf_revision_private' AS $$
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') AND EXISTS(SELECT 1 FROM jawf_revision_private.revisions WHERE version_id=OLD.schedule_version_id)
 THEN
  IF TG_OP='DELETE' OR NEW.schedule_version_id IS DISTINCT FROM OLD.schedule_version_id THEN
   RAISE EXCEPTION 'JAWF_REVISION_SEALED' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP IN ('INSERT','UPDATE') AND EXISTS(SELECT 1 FROM jawf_revision_private.revisions WHERE version_id=NEW.schedule_version_id)
 AND NOT public.jawf_revision_session_allowed(NEW) THEN
  RAISE EXCEPTION 'JAWF_REVISION_SEALED' USING ERRCODE='23514';
 END IF;
 RETURN COALESCE(NEW,OLD);
END; $$;
REVOKE ALL ON FUNCTION jawf_revision_private.guard_sessions() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER a_jawf_revision_sealed BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_sessions
FOR EACH ROW EXECUTE FUNCTION jawf_revision_private.guard_sessions();

CREATE FUNCTION jawf_revision_private.prepare_withdrawals(p_session_hash text,p_ledger_hash text)
RETURNS jsonb LANGUAGE plpgsql SET search_path='pg_catalog','public','jawf_revision_private' AS $$
DECLARE
 v_source_id constant uuid:='286e37d4-d45c-5942-b8e0-facdfed3081f';
 withdrawn constant uuid[]:=ARRAY['05778417-77d1-49c8-81ba-055ab3d3d131'::uuid,'491b0de1-e005-460d-a79a-54ff071577e7'::uuid];
 v public.schedule_versions%ROWTYPE; target_id uuid:=gen_random_uuid(); n integer; h text;
 reason constant text:='بتوجيه المستخدم: إلغاء ارتباط شمسان الجراش بمبادئ الإحصاء وأحمد الرباطي بفيزياء عامة 2 في الجوف. المقرران باقيان؛ أربع ساعات غير مسندة. هذه مسودة تصحيح غير منشورة.';
BEGIN
 IF session_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'JAWF_REVISION_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_source_id::text,9174));
 SELECT * INTO STRICT v FROM public.schedule_versions WHERE id=v_source_id FOR UPDATE;
 IF v.status<>'published' OR v.college_id<>'0d0e89c6-d041-43de-a448-249070ef6c81'::uuid
 OR v.academic_term_id<>'a0963d5e-b042-4174-a325-a68599eae8ff'::uuid
 OR EXISTS(SELECT 1 FROM jawf_revision_private.revisions WHERE source_version_id=v_source_id)
 THEN RAISE EXCEPTION 'JAWF_REVISION_BASELINE_DRIFT'; END IF;
 PERFORM 1 FROM public.schedule_sessions WHERE schedule_version_id=v_source_id FOR SHARE;
 PERFORM 1 FROM public.existing_schedule_source_rows WHERE schedule_version_id=v_source_id FOR SHARE;
 SELECT count(*),md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) INTO n,h
 FROM public.schedule_sessions s WHERE schedule_version_id=v_source_id;
 IF n<>66 OR h IS DISTINCT FROM p_session_hash THEN RAISE EXCEPTION 'JAWF_REVISION_SESSION_DRIFT'; END IF;
 SELECT count(*),md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) INTO n,h
 FROM public.existing_schedule_source_rows s WHERE schedule_version_id=v_source_id;
 IF n<>67 OR h IS DISTINCT FROM p_ledger_hash THEN RAISE EXCEPTION 'JAWF_REVISION_LEDGER_DRIFT'; END IF;
 IF (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id=v_source_id AND id=ANY(withdrawn)
 AND ((id=withdrawn[1] AND instructor_id='86d9455c-456c-4bc8-8b9c-436ea4e78596'::uuid AND teaching_assignment_id IS NULL)
 OR (id=withdrawn[2] AND instructor_id='986fdef9-ec1f-4eaa-9f46-f0998d3727ac'::uuid
 AND teaching_assignment_id='feb017b1-f668-4d30-8a75-3d5c3bc36dc1'::uuid)))<>2
 OR EXISTS(SELECT 1 FROM public.teaching_assignments WHERE id='feb017b1-f668-4d30-8a75-3d5c3bc36dc1' AND is_active)
 THEN RAISE EXCEPTION 'JAWF_REVISION_WITHDRAWAL_DRIFT'; END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_sessions s WHERE schedule_version_id=v_source_id
 AND (replaced_by_split OR split_source_session_id IS NOT NULL OR NOT public.jawf_term_source_session_allowed(s)))
 THEN RAISE EXCEPTION 'JAWF_REVISION_SOURCE_NOT_VERIFIED'; END IF;
 INSERT INTO public.schedule_versions SELECT (jsonb_populate_record(NULL::public.schedule_versions,to_jsonb(v)||jsonb_build_object(
 'id',target_id,'name','الجوف — مسودة إلغاء إسناد الجراش والرباطي — 30-9','status','draft','notes',reason,
 'created_at',now(),'updated_at',now(),'created_by',auth.uid(),'eligibility_revision',0,
 'is_coordination',false,'disposable_test',false))).*;
 INSERT INTO jawf_revision_private.revisions VALUES(target_id,v_source_id,p_session_hash,p_ledger_hash,reason,now());
 INSERT INTO schedule_version_delivery_private.clone_provenance(version_id,source_version_id) VALUES(target_id,v_source_id);
 INSERT INTO jawf_revision_private.withdrawals
 SELECT target_id,s.id,to_jsonb(s),to_jsonb(r) FROM public.schedule_sessions s
 JOIN public.existing_schedule_source_rows r ON r.schedule_session_id=s.id AND r.schedule_version_id=v_source_id
 WHERE s.id=ANY(withdrawn);
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>2 THEN RAISE EXCEPTION 'JAWF_REVISION_WITHDRAWAL_COUNT'; END IF;
 INSERT INTO jawf_revision_private.sessions
 SELECT newid,target_id,s.id,to_jsonb(s),to_jsonb(s)||jsonb_build_object('id',newid,
 'schedule_version_id',target_id,'created_at',now(),'updated_at',now())
 FROM public.schedule_sessions s CROSS JOIN LATERAL(SELECT gen_random_uuid() newid WHERE s.id IS NOT NULL) ids
 WHERE s.schedule_version_id=v_source_id AND NOT s.id=ANY(withdrawn);
 INSERT INTO public.schedule_sessions SELECT (jsonb_populate_record(NULL::public.schedule_sessions,expected)).*
 FROM jawf_revision_private.sessions WHERE version_id=target_id;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>64 OR EXISTS(SELECT 1 FROM public.schedule_sessions s WHERE schedule_version_id=target_id AND NOT public.jawf_revision_session_allowed(s))
 OR (SELECT sum(extract(epoch FROM(end_time-start_time))/3600) FROM public.schedule_sessions WHERE schedule_version_id=target_id)<>149
 THEN RAISE EXCEPTION 'JAWF_REVISION_COPY_MISMATCH'; END IF;
 INSERT INTO public.schedule_version_events(college_id,schedule_version_id,event_type,from_status,to_status,performed_by,notes,metadata)
 VALUES(v.college_id,target_id,'cloned',NULL,'draft',auth.uid(),reason,
 jsonb_build_object('source_version_id',v_source_id,'sessions_copied',64,'withdrawn_sessions',withdrawn,'unassigned_hours',4));
 RETURN jsonb_build_object('version_id',target_id,'status','draft','sessions',64,'scheduled_hours',149,'required_hours',153,'unassigned_hours',4);
END; $$;
REVOKE ALL ON FUNCTION jawf_revision_private.prepare_withdrawals(text,text) FROM PUBLIC,anon,authenticated;
COMMIT;

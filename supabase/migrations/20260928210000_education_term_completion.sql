-- Current-term source completion. Exact private manifests preserve the published
-- baseline and the approved Akram correction. No authentication or physical
-- collision check is bypassed. Publishing still uses the official lifecycle.
BEGIN;
SET LOCAL lock_timeout='5s';

CREATE TABLE education_source_revision_private.additions (
  session_id uuid PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES education_source_revision_private.revisions(version_id),
  source_row_id uuid NOT NULL REFERENCES public.existing_schedule_source_rows(id),
  expected jsonb NOT NULL,
  UNIQUE(version_id,source_row_id)
);
ALTER TABLE education_source_revision_private.additions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON education_source_revision_private.additions FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.education_term_completion_session_allowed(p_session public.schedule_sessions)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path='pg_catalog','public','education_source_revision_private' AS $$
 SELECT p_session.schedule_version_id='badcb000-9280-4260-8000-000000000001'::uuid
 AND p_session.college_id='1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid
 AND EXISTS (SELECT 1 FROM education_source_revision_private.additions a
 JOIN education_source_revision_private.revisions r ON r.version_id=a.version_id
 JOIN public.schedule_versions v ON v.id=r.version_id
 JOIN public.existing_schedule_source_rows src ON src.id=a.source_row_id
 WHERE a.session_id=p_session.id AND a.version_id=p_session.schedule_version_id
 AND r.source_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
 AND v.academic_term_id='93705393-609d-4605-ae94-9572cd8b2090'::uuid
 AND src.delivery_group_id=p_session.delivery_group_id
 AND src.component_id=p_session.plan_course_component_id
 AND src.cohort_id=p_session.cohort_id
 AND to_jsonb(p_session)-ARRAY['created_at','updated_at']=a.expected-ARRAY['created_at','updated_at']);
$$;
REVOKE ALL ON FUNCTION public.education_term_completion_session_allowed(public.schedule_sessions) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.education_term_completion_session_allowed(public.schedule_sessions) TO authenticated;

-- Retain existing exact-copy checks, extending only the registered additions.
DO $$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.education_source_revision_session_allowed(public.schedule_sessions)'::regprocedure);
 IF position('SELECT EXISTS (' IN d)=0 THEN RAISE EXCEPTION 'COMPLETION_ALLOWED_DRIFT'; END IF;
 EXECUTE replace(d,'SELECT EXISTS (','SELECT public.education_term_completion_session_allowed(p_session) OR EXISTS (');
 d:=pg_get_functiondef('public.education_source_revision_verified(uuid)'::regprocedure);
 IF position('(SELECT count(*) FROM education_source_revision_private.sessions f WHERE f.version_id=r.version_id)=r.session_count' IN d)=0 THEN RAISE EXCEPTION 'COMPLETION_VERIFIED_DRIFT'; END IF;
 d:=replace(d,'(SELECT count(*) FROM education_source_revision_private.sessions f WHERE f.version_id=r.version_id)=r.session_count',
 '(SELECT count(*) FROM education_source_revision_private.sessions f WHERE f.version_id=r.version_id)+(SELECT count(*) FROM education_source_revision_private.additions a WHERE a.version_id=r.version_id)=r.session_count');
 d:=replace(d,'AND NOT EXISTS (', 'AND NOT EXISTS (SELECT 1 FROM education_source_revision_private.additions a LEFT JOIN public.schedule_sessions s ON s.id=a.session_id WHERE a.version_id=r.version_id AND (s.id IS NULL OR NOT public.education_term_completion_session_allowed(s))) AND NOT EXISTS (');
 EXECUTE d;
 -- Hosted rooms use their real canonical IDs. The exemption is an exact
 -- immutable session in this revision, never general cross-college access.
 d:=pg_get_functiondef('public.ensure_ss_college()'::regprocedure);
 IF position('IF rc IS NULL OR rc <> NEW.college_id THEN' IN d)=0 THEN RAISE EXCEPTION 'COMPLETION_ROOM_GUARD_DRIFT'; END IF;
 EXECUTE replace(d,'IF rc IS NULL OR rc <> NEW.college_id THEN',
 'IF rc IS NULL OR (rc <> NEW.college_id AND NOT (NEW.schedule_version_id=''badcb000-9280-4260-8000-000000000001''::uuid AND public.education_source_revision_session_allowed(NEW))) THEN');
END;
$$;

CREATE FUNCTION education_source_revision_private.create_term_completion()
RETURNS jsonb LANGUAGE plpgsql SET search_path='pg_catalog','public','education_source_revision_private' AS $$
DECLARE
 v_id constant uuid:='badcb000-9280-4260-8000-000000000001';
 v_source constant uuid:='7430bad7-2de7-5c90-9368-b214a199d6c3';
 v_akram constant uuid:='3fc16124-dbfa-4fc0-93c9-db1ea9a560dd';
 v_maryam constant uuid:='48ee97d1-ed6f-4242-8da9-3df094150b75';
 v_yusuf constant uuid:='3c1e2a05-d2bc-498f-8bd1-84fd5cf6f5af';
 v public.schedule_versions%ROWTYPE; x record; a public.teaching_assignments%ROWTYPE;
 j jsonb; sid uuid; h text; lh text; n integer; tbl text;
 v_reason text:='بتفويض المستخدم: استثناء نقل الجدول لهذا الفصل فقط؛ استكمال مريم ويوسف وحفظ تصحيح أكرم. الأعداد 40 لكل مجموعة تقديرية، والمشتركة 80. الاستضافة بمعرفات القاعات الأصلية، والاعتماد عبر المسار الرسمي.';
BEGIN
 IF session_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'SOURCE_REVISION_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_versions WHERE id=v_id) THEN
   RETURN jsonb_build_object('version_id',v_id,'already_created',true);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_source::text,9174));
 SELECT * INTO STRICT v FROM public.schedule_versions WHERE id=v_source FOR UPDATE;
 IF v.status<>'published' OR v.academic_term_id<>'93705393-609d-4605-ae94-9572cd8b2090'::uuid
 OR NOT EXISTS(SELECT 1 FROM public.schedule_versions WHERE id=v_akram AND status='approved')
 OR NOT public.education_source_revision_verified(v_akram) THEN RAISE EXCEPTION 'COMPLETION_BASELINE_DRIFT'; END IF;
 PERFORM 1 FROM public.existing_schedule_source_rows WHERE schedule_version_id=v_source FOR UPDATE;
 SELECT count(*),md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) INTO n,h FROM public.schedule_sessions s WHERE schedule_version_id=v_source;
 IF n<>339 THEN RAISE EXCEPTION 'COMPLETION_SOURCE_COUNT_DRIFT'; END IF;
 SELECT count(*),md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) INTO n,lh FROM public.existing_schedule_source_rows s WHERE schedule_version_id=v_source;
 IF n<>377 THEN RAISE EXCEPTION 'COMPLETION_LEDGER_COUNT_DRIFT'; END IF;
 INSERT INTO public.schedule_versions
 SELECT (jsonb_populate_record(NULL::public.schedule_versions,to_jsonb(v)||jsonb_build_object(
 'id',v_id,'name','التربية والعلوم — استكمال مريم ويوسف وحفظ تصحيح أكرم — الفصل الأول 2026-2027',
 'status','draft','notes',v_reason,'created_at',now(),'updated_at',now(),'created_by',auth.uid(),
 'is_coordination',false,'disposable_test',false,'eligibility_revision',0))).*;
 INSERT INTO education_source_revision_private.revisions
 (version_id,source_version_id,college_id,term_id,corrected_source_session_id,corrected_instructor_id,source_session_hash,source_ledger_hash,session_count,ledger_count,reason,created_by)
 VALUES(v_id,v_source,v.college_id,v.academic_term_id,'4124d9b4-7367-4e2b-a742-29fa59b031ff','728e3cb5-920f-49ca-948d-76ed413701c3',h,lh,341,377,v_reason,auth.uid());
 INSERT INTO schedule_version_delivery_private.clone_provenance VALUES(v_id,v_source,now());
 FOREACH tbl IN ARRAY ARRAY['scope','cohort_facts','group_facts','partner_group_facts','partition_facts','group_partition_facts','shared_link_facts','partner_partition_facts','component_room_type_facts','instructor_hour_waivers'] LOOP
 EXECUTE format('INSERT INTO schedule_version_delivery_private.%1$I SELECT (jsonb_populate_record(NULL::schedule_version_delivery_private.%1$I,to_jsonb(f)||jsonb_build_object(''version_id'',$1))).* FROM schedule_version_delivery_private.%1$I f WHERE version_id=$2',tbl) USING v_id,v_source;
 END LOOP;
 -- Version-specific sharing: historical Physics/Noura session stays intact.
 INSERT INTO schedule_version_delivery_private.partner_group_facts(version_id,group_id,college_id,expected_students,capacity_limit)
 SELECT v_id,id,college_id,expected_students,capacity_limit FROM public.delivery_groups
 WHERE id IN ('94776001-8c09-4907-8662-dc24b93114be','d183a739-2122-401c-9ecb-1de07213ae94') ON CONFLICT DO NOTHING;
 INSERT INTO schedule_version_delivery_private.shared_link_facts VALUES(v_id,'94776001-8c09-4907-8662-dc24b93114be','d183a739-2122-401c-9ecb-1de07213ae94',v.college_id);

 FOR x IN SELECT f.* FROM education_source_revision_private.sessions f WHERE f.version_id=v_akram LOOP
   sid:=gen_random_uuid();
   j:=x.expected||jsonb_build_object('id',sid,'schedule_version_id',v_id,'created_at',now(),'updated_at',now());
   IF x.source_session_id='cc95b111-cce9-48a4-848b-0133e7f31ca3'::uuid THEN
     SELECT * INTO STRICT a FROM public.teaching_assignments WHERE id='13a3d53f-daca-42bc-925f-e5963443c646' AND is_active AND instructor_id=v_maryam;
     j:=j||jsonb_build_object('instructor_id',v_maryam,'teaching_assignment_id',a.id,'delivery_group_id',a.delivery_group_id,'cohort_id',a.cohort_id,'course_offering_id',a.course_offering_id,'plan_course_component_id',a.plan_course_component_id,'day_of_week',6,'start_time','10:00:00','end_time','12:00:00','room_id','c832223a-dd38-5c3b-8124-f25aa759c847','expected_students',80);
   ELSIF x.source_session_id='f07e0571-a5d4-4ee0-aa3e-6b504128a6ba'::uuid THEN
     SELECT * INTO STRICT a FROM public.teaching_assignments WHERE id='560696ce-6a57-4186-b219-f948ef1c15eb' AND is_active AND instructor_id=v_maryam;
     j:=j||jsonb_build_object('instructor_id',v_maryam,'teaching_assignment_id',a.id);
   ELSIF x.source_session_id='6f134f18-03ca-49de-bb18-7d5d03fa3a7f'::uuid THEN
     j:=j||jsonb_build_object('instructor_id',v_yusuf,'day_of_week',2,'start_time','12:00:00','end_time','14:00:00','room_id','d3f3d7bb-10a6-4682-b1b3-d7447314c7e3');
   ELSIF x.source_session_id='ff726f9b-1413-4de0-a7cb-cc3ed61fe1f5'::uuid THEN
     j:=j||jsonb_build_object('room_id','dafd1fea-0be3-7877-87f7-aad56f4fc713');
   END IF;
   INSERT INTO education_source_revision_private.sessions VALUES(sid,v_id,x.source_session_id,x.original,j);
 END LOOP;
 FOR x IN SELECT * FROM (VALUES
 ('af7908bc-c78f-537d-9337-5cad7ed55d85'::uuid,'ba820124-886f-459a-addb-7016af65b52f'::uuid,6,'323a9f1e-e281-4104-92ec-38e856f828bd'::uuid),
 ('bdaaac34-649b-59e9-8567-b3e63cec2fc4','c1c98b8a-abc8-43d9-aa50-8ba46974c74f',2,'b7b0a317-45a4-423f-9f7e-d09f36b3a257')) AS t(source_id,assignment_id,day,room) LOOP
   SELECT * INTO STRICT a FROM public.teaching_assignments WHERE id=x.assignment_id AND is_active AND instructor_id=v_maryam;
   sid:=gen_random_uuid();
   j:=jsonb_build_object('id',sid,'college_id',v.college_id,'schedule_version_id',v_id,'course_offering_id',a.course_offering_id,'teaching_assignment_id',a.id,'instructor_id',v_maryam,'cohort_id',a.cohort_id,'delivery_group_id',a.delivery_group_id,'plan_course_component_id',a.plan_course_component_id,'room_id',x.room,'day_of_week',x.day,'start_time','08:00:00','end_time','10:00:00','session_type','lecture','study_system','regular','source_type','manual','expected_students',40,'is_locked',false,'replaced_by_split',false,'created_at',now(),'updated_at',now());
   -- Populate null columns so exact row verification has the full shape.
   j:=to_jsonb(jsonb_populate_record(NULL::public.schedule_sessions,j));
   INSERT INTO education_source_revision_private.additions VALUES(sid,v_id,x.source_id,j);
 END LOOP;

 INSERT INTO education_source_revision_private.source_rows(version_id,source_row_id,original,expected)
 SELECT v_id,s.id,to_jsonb(s),coalesce(old.expected,to_jsonb(s))||jsonb_build_object('schedule_version_id',v_id,'schedule_session_id',coalesce(f.session_id,ad.session_id))
 FROM public.existing_schedule_source_rows s
 LEFT JOIN education_source_revision_private.source_rows old ON old.version_id=v_akram AND old.source_row_id=s.id
 LEFT JOIN education_source_revision_private.sessions f ON f.version_id=v_id AND f.source_session_id=s.schedule_session_id
 LEFT JOIN education_source_revision_private.additions ad ON ad.version_id=v_id AND ad.source_row_id=s.id
 WHERE s.schedule_version_id=v_source;

 -- Both source rows point at one shared session; raw original cells remain.
 UPDATE education_source_revision_private.source_rows f SET expected=f.expected||jsonb_build_object('schedule_session_id',s.session_id,'status','imported','instructor_ids',jsonb_build_array(v_maryam),'shared_key','EDU-2026F-MARYAM-MATH-PHYS-L2','shared_member',f.source_row_id='672feab6-ff9f-5c6a-86d3-e3fdf58bb4e1'::uuid)
 FROM education_source_revision_private.sessions s WHERE f.version_id=v_id AND s.version_id=v_id AND s.source_session_id='cc95b111-cce9-48a4-848b-0133e7f31ca3' AND f.source_row_id IN ('296bbd4e-3ac8-593d-a1c9-8b002720ed6f','672feab6-ff9f-5c6a-86d3-e3fdf58bb4e1');
 FOR x IN SELECT session_id,expected FROM education_source_revision_private.sessions WHERE version_id=v_id UNION ALL SELECT session_id,expected FROM education_source_revision_private.additions WHERE version_id=v_id LOOP
   UPDATE education_source_revision_private.source_rows f SET expected=f.expected||jsonb_build_object('day_of_week',x.expected->'day_of_week','start_time',x.expected->'start_time','end_time',x.expected->'end_time','room_id',x.expected->'room_id','instructor_ids',jsonb_build_array(x.expected->'instructor_id'),'teaching_assignment_id',x.expected->'teaching_assignment_id','status','imported','pending_reasons','[]'::jsonb)
   WHERE f.version_id=v_id AND f.expected->>'schedule_session_id'=x.session_id::text;
 END LOOP;
 INSERT INTO public.schedule_sessions SELECT (jsonb_populate_record(NULL::public.schedule_sessions,expected)).* FROM education_source_revision_private.sessions WHERE version_id=v_id;
 INSERT INTO public.schedule_sessions SELECT (jsonb_populate_record(NULL::public.schedule_sessions,expected)).* FROM education_source_revision_private.additions WHERE version_id=v_id;
 IF NOT public.education_source_revision_verified(v_id) THEN RAISE EXCEPTION 'COMPLETION_COPY_MISMATCH'; END IF;
 INSERT INTO public.schedule_version_events(college_id,schedule_version_id,event_type,to_status,notes,metadata)
 VALUES(v.college_id,v_id,'cloned','draft',v_reason,jsonb_build_object('source_version_id',v_source,'preserved_akram_revision',v_akram,'sessions',341,'source_copies',339,'added_sessions',2,'shared_groups',2));
 RETURN jsonb_build_object('version_id',v_id,'sessions',341,'state','draft','publication','requires_official_checks');
END;
$$;
REVOKE ALL ON FUNCTION education_source_revision_private.create_term_completion() FROM PUBLIC,anon,authenticated;

-- Persist the complete reviewed source projection on official publication.
-- Akram-only revision semantics are unchanged by these same-value assignments.
DO $$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('education_source_revision_private.guard_publication()'::regprocedure);
 IF position('notes=f.expected->>''notes''' IN d)=0 THEN RAISE EXCEPTION 'COMPLETION_PUBLISH_DRIFT'; END IF;
 EXECUTE replace(d,'notes=f.expected->>''notes''',
 'notes=f.expected->>''notes'', day_of_week=(f.expected->>''day_of_week'')::integer, start_time=(f.expected->>''start_time'')::time, end_time=(f.expected->>''end_time'')::time, room_id=(f.expected->>''room_id'')::uuid, teaching_assignment_id=(f.expected->>''teaching_assignment_id'')::uuid, status=f.expected->>''status'', shared_key=f.expected->>''shared_key'', shared_member=(f.expected->>''shared_member'')::boolean, pending_reasons=ARRAY(SELECT jsonb_array_elements_text(f.expected->''pending_reasons''))');
END;
$$;

-- The two additions increase the frozen delivery total by four hours; the
-- Physics member is represented by its Mathematics shared anchor. Keep the
-- existing requirement that every unassigned group is fully source-backed.
DO $$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.schedule_version_delivery_coverage(uuid,uuid)'::regprocedure);
 IF position('total_groups=331' IN d)=0 OR position('required_hours=714' IN d)=0 OR position('scheduled_hours=714' IN d)=0 THEN RAISE EXCEPTION 'COMPLETION_COVERAGE_DRIFT'; END IF;
 d:=replace(d,'total_groups=331','total_groups=CASE WHEN p_schedule_version_id=''badcb000-9280-4260-8000-000000000001''::uuid THEN 333 ELSE 331 END');
 d:=replace(d,'required_hours=714','required_hours=CASE WHEN p_schedule_version_id=''badcb000-9280-4260-8000-000000000001''::uuid THEN 718 ELSE 714 END');
 d:=replace(d,'scheduled_hours=714','scheduled_hours=CASE WHEN p_schedule_version_id=''badcb000-9280-4260-8000-000000000001''::uuid THEN 718 ELSE 714 END');
 EXECUTE d;
END;
$$;
COMMIT;

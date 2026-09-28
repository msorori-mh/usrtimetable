-- Exact source-backed hosting for the two authorized Jawf drafts, this term only.
BEGIN;
CREATE SCHEMA jawf_term_source_private;
REVOKE ALL ON SCHEMA jawf_term_source_private FROM PUBLIC,anon,authenticated;
CREATE TABLE jawf_term_source_private.sessions (
 session_id uuid PRIMARY KEY, source_row_id uuid NOT NULL UNIQUE REFERENCES public.existing_schedule_source_rows(id),
 version_id uuid NOT NULL REFERENCES public.schedule_versions(id), expected jsonb NOT NULL,
 source_original jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE jawf_term_source_private.sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON jawf_term_source_private.sessions FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.jawf_term_source_session_allowed(p_session public.schedule_sessions)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='pg_catalog','public','jawf_term_source_private' AS $$
 SELECT p_session.college_id='0d0e89c6-d041-43de-a448-249070ef6c81'::uuid
 AND p_session.schedule_version_id IN ('286e37d4-d45c-5942-b8e0-facdfed3081f'::uuid,'9ef411ff-0e91-e754-2985-44799be1255e'::uuid)
 AND EXISTS(SELECT 1 FROM jawf_term_source_private.sessions f
 JOIN public.existing_schedule_source_rows src ON src.id=f.source_row_id
 JOIN public.schedule_versions v ON v.id=f.version_id
 JOIN public.delivery_groups g ON g.id=src.delivery_group_id
 WHERE f.session_id=p_session.id AND f.version_id=p_session.schedule_version_id
 AND v.academic_term_id='a0963d5e-b042-4174-a325-a68599eae8ff'::uuid
 AND src.term_id=v.academic_term_id AND src.college_id=p_session.college_id
 AND src.schedule_version_id=v.id AND src.delivery_group_id=p_session.delivery_group_id
 AND src.cohort_id=p_session.cohort_id AND src.component_id=p_session.plan_course_component_id
 AND p_session.instructor_id=ANY(src.instructor_ids)
 AND src.day_of_week=p_session.day_of_week AND src.start_time=p_session.start_time AND src.end_time=p_session.end_time
 AND g.active AND NOT g.is_obsolete
 AND to_jsonb(p_session)-ARRAY['created_at','updated_at']=f.expected-ARRAY['created_at','updated_at']);
$$;
REVOKE ALL ON FUNCTION public.jawf_term_source_session_allowed(public.schedule_sessions) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jawf_term_source_session_allowed(public.schedule_sessions) TO authenticated;
DO $$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.ensure_ss_college()'::regprocedure);
 IF position('AND NOT public.education_2026f_source_external_session_allowed(NEW)' IN d)=0 OR position('IF rc IS NULL OR (' IN d)=0 THEN RAISE EXCEPTION 'JAWF_HOSTING_GUARD_DRIFT'; END IF;
 d:=replace(d,'AND NOT public.education_2026f_source_external_session_allowed(NEW)','AND NOT public.education_2026f_source_external_session_allowed(NEW) AND NOT public.jawf_term_source_session_allowed(NEW)');
 d:=replace(d,'rc <> NEW.college_id AND NOT (','rc <> NEW.college_id AND NOT public.jawf_term_source_session_allowed(NEW) AND NOT (');
 EXECUTE d;
 d:=pg_get_functiondef('public.guard_schedule_session_current_delivery_group()'::regprocedure);
 IF position('IF public.education_source_revision_session_allowed(NEW) THEN RETURN NEW; END IF;' IN d)=0 THEN RAISE EXCEPTION 'JAWF_FRESHNESS_GUARD_DRIFT'; END IF;
 EXECUTE replace(d,'IF public.education_source_revision_session_allowed(NEW) THEN RETURN NEW; END IF;',
 'IF public.education_source_revision_session_allowed(NEW) OR public.jawf_term_source_session_allowed(NEW) THEN RETURN NEW; END IF;');
END;
$$;

CREATE FUNCTION jawf_term_source_private.materialize_ready()
RETURNS jsonb LANGUAGE plpgsql SET search_path='pg_catalog','public','jawf_term_source_private' AS $$
DECLARE src public.existing_schedule_source_rows%ROWTYPE; room public.rooms%ROWTYPE;
 off public.course_offerings%ROWTYPE; g public.delivery_groups%ROWTYPE; comp public.plan_course_components%ROWTYPE;
 ta public.teaching_assignments%ROWTYPE; sid uuid; j jsonb; why text; n integer:=0; held integer:=0; detail jsonb:='[]';
BEGIN
 IF session_user NOT IN ('postgres','supabase_admin') THEN RAISE EXCEPTION 'JAWF_OPERATOR_REQUIRED' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(9282026,1);
 FOR src IN SELECT r.* FROM public.existing_schedule_source_rows r JOIN public.schedule_versions v ON v.id=r.schedule_version_id
 WHERE r.schedule_version_id IN ('286e37d4-d45c-5942-b8e0-facdfed3081f','9ef411ff-0e91-e754-2985-44799be1255e')
 AND r.college_id='0d0e89c6-d041-43de-a448-249070ef6c81' AND r.term_id='a0963d5e-b042-4174-a325-a68599eae8ff'
 AND v.status='draft' AND r.schedule_session_id IS NULL ORDER BY r.level_number,r.source_id FOR UPDATE OF r LOOP
  why:=NULL; sid:=gen_random_uuid(); room:=NULL;
  SELECT * INTO comp FROM public.plan_course_components WHERE id=src.component_id;
  SELECT * INTO g FROM public.delivery_groups WHERE id=src.delivery_group_id;
  SELECT * INTO off FROM public.course_offerings WHERE plan_course_id=src.plan_course_id AND term_id=src.term_id AND college_id=src.college_id AND is_active ORDER BY id LIMIT 1;
  SELECT * INTO ta FROM public.teaching_assignments WHERE id=src.teaching_assignment_id AND is_active;
  IF comp.component_type='project' OR NOT coalesce(comp.is_timetabled,true) THEN
    why:='بحث التخرج خارج الجدول الأسبوعي والنصاب وفق توجيه المستخدم';
  ELSIF src.start_time IS NULL OR src.end_time IS NULL OR src.day_of_week IS NULL THEN
    why:='وقت المحاضرة غير موجود في المصدر؛ يلزم تحديده';
  ELSIF cardinality(src.instructor_ids)<>1 OR coalesce(cardinality(src.instructor_ids),0)=0 THEN
    why:='هوية المحاضر غير محسومة من المصدر: '||coalesce(src.raw_teacher,'غير مذكور');
  ELSIF off.id IS NULL OR g.id IS NULL OR NOT g.active OR g.is_obsolete THEN
    why:='بيانات المقرر أو المجموعة غير مكتملة';
  ELSIF EXISTS(SELECT 1 FROM public.schedule_sessions s JOIN public.schedule_versions v ON v.id=s.schedule_version_id
    JOIN public.academic_terms t ON t.id=v.academic_term_id
    WHERE (v.status='published' OR v.id='badcb000-9280-4260-8000-000000000001' OR v.id IN ('286e37d4-d45c-5942-b8e0-facdfed3081f','9ef411ff-0e91-e754-2985-44799be1255e'))
    AND v.id NOT IN ('7430bad7-2de7-5c90-9368-b214a199d6c3','3fc16124-dbfa-4fc0-93c9-db1ea9a560dd')
    AND t.start_date<='2026-12-26' AND t.end_date>='2026-09-06'
    AND (s.instructor_id=src.instructor_ids[1] OR EXISTS(SELECT 1 FROM public.faculty_identity_links a JOIN public.faculty_identity_links b ON b.identity_id=a.identity_id WHERE a.instructor_id=s.instructor_id AND b.instructor_id=src.instructor_ids[1]))
    AND s.day_of_week=src.day_of_week AND s.start_time<src.end_time AND s.end_time>src.start_time) THEN
    why:='تعارض فعلي: المحاضر محجوز في محاضرة أخرى في الوقت نفسه؛ طلاب الجوف مستقلون';
  END IF;
  IF why IS NULL THEN
   SELECT r.* INTO room FROM public.rooms r WHERE r.is_active AND r.capacity>=coalesce(g.expected_students,40)
    AND r.college_id=CASE WHEN src.schedule_version_id='286e37d4-d45c-5942-b8e0-facdfed3081f'::uuid THEN '1ee291b2-bec9-43d3-b42b-5a4f46946399'::uuid ELSE 'f30ff526-3918-4395-b8a0-dff1873534bf'::uuid END
    AND (r.available_days IS NULL OR src.day_of_week=ANY(r.available_days))
    AND coalesce(r.available_start_time,'00:00'::time)<=src.start_time AND coalesce(r.available_end_time,'23:59'::time)>=src.end_time
    AND ((comp.component_type='theory' AND r.room_type='lecture_hall') OR
      (comp.component_type='practical' AND r.room_type='workshop' AND
       ((src.raw_course ~ '(فيزياء|الضوء|كهرب|ف عامة)' AND r.name='معمل الفيزياء') OR
        (src.raw_course ~ '(كيمي|ك عامة|تحليلية)' AND r.name='معمل الكيمياء') OR
        (src.raw_course ~ '(بيولوج|احياء|أحياء|فسيولوج)' AND r.name='معمل الأحياء') OR
        (src.raw_course LIKE '%جيولوج%' AND r.name LIKE 'معمل جيولوجيا%'))))
    AND NOT EXISTS(SELECT 1 FROM public.schedule_sessions s JOIN public.schedule_versions v ON v.id=s.schedule_version_id JOIN public.academic_terms t ON t.id=v.academic_term_id
      WHERE (v.status='published' OR v.id='badcb000-9280-4260-8000-000000000001' OR v.id IN ('286e37d4-d45c-5942-b8e0-facdfed3081f','9ef411ff-0e91-e754-2985-44799be1255e'))
      AND v.id NOT IN ('7430bad7-2de7-5c90-9368-b214a199d6c3','3fc16124-dbfa-4fc0-93c9-db1ea9a560dd')
      AND t.start_date<='2026-12-26' AND t.end_date>='2026-09-06' AND s.room_id=r.id AND s.day_of_week=src.day_of_week AND s.start_time<src.end_time AND s.end_time>src.start_time)
    ORDER BY (r.id=src.room_id) DESC NULLS LAST,(regexp_replace(r.name,'[ق[:space:].]','','g')=regexp_replace(src.raw_room,'[ق[:space:].]','','g')) DESC,r.capacity,r.id LIMIT 1;
   IF room.id IS NULL THEN why:='لا توجد قاعة استضافة متاحة في الكلية المضيفة توافق الموعد والنوع والسعة'; END IF;
  END IF;
  IF why IS NULL THEN
   BEGIN
    j:=jsonb_build_object('id',sid,'schedule_version_id',src.schedule_version_id,'college_id',src.college_id,'course_offering_id',off.id,'teaching_assignment_id',ta.id,'instructor_id',src.instructor_ids[1],'cohort_id',src.cohort_id,'delivery_group_id',src.delivery_group_id,'plan_course_component_id',src.component_id,'room_id',room.id,'day_of_week',src.day_of_week,'start_time',src.start_time,'end_time',src.end_time,'session_type',CASE WHEN comp.component_type='practical' THEN 'lab' ELSE 'lecture' END,'study_system','regular','source_type','manual','expected_students',coalesce(g.expected_students,40),'is_locked',false,'replaced_by_split',false,'created_at',now(),'updated_at',now());
    j:=to_jsonb(jsonb_populate_record(NULL::public.schedule_sessions,j));
    INSERT INTO jawf_term_source_private.sessions(session_id,source_row_id,version_id,expected,source_original) VALUES(sid,src.id,src.schedule_version_id,j,to_jsonb(src));
    INSERT INTO public.schedule_sessions SELECT (jsonb_populate_record(NULL::public.schedule_sessions,j)).*;
    UPDATE public.existing_schedule_source_rows SET schedule_session_id=sid,room_id=room.id,status='imported',pending_reasons=ARRAY[]::text[],notes=concat_ws(E'\n',notes,'استثناء هذا الفصل بتفويض المستخدم: استضافة بالمعرف الحقيقي للقاعة، مجموعة الجوف مستقلة؛ العدد تقديري.') WHERE id=src.id;
    n:=n+1;
   EXCEPTION WHEN OTHERS THEN why:='تعذر التسكين: '||SQLERRM;
   END;
  END IF;
  IF why IS NOT NULL THEN
    UPDATE public.existing_schedule_source_rows SET pending_reasons=ARRAY[why] WHERE id=src.id;
    held:=held+1; detail:=detail||jsonb_build_array(jsonb_build_object('source_id',src.source_id,'reason',why));
  END IF;
 END LOOP;
 RETURN jsonb_build_object('created',n,'held',held,'blockers',detail);
END;
$$;
REVOKE ALL ON FUNCTION jawf_term_source_private.materialize_ready() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_verified_hosted_schedule_sessions(p_version uuid)
RETURNS SETOF public.schedule_sessions LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='pg_catalog','public' AS $$
DECLARE c uuid;
BEGIN
 SELECT college_id INTO c FROM public.schedule_versions WHERE id=p_version;
 IF auth.uid() IS NULL OR c IS NULL OR NOT public.can_view_college(auth.uid(),c) THEN RAISE EXCEPTION 'HOSTED_SESSION_READ_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT s.* FROM public.schedule_sessions s JOIN public.rooms r ON r.id=s.room_id
 WHERE s.schedule_version_id=p_version AND r.college_id<>s.college_id
 AND ((p_version='badcb000-9280-4260-8000-000000000001'::uuid AND public.education_source_revision_session_allowed(s)) OR public.jawf_term_source_session_allowed(s));
END;
$$;
COMMIT;

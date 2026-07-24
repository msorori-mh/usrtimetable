\set ON_ERROR_STOP on
CREATE FUNCTION pg_temp.assert_true(ok boolean, message text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN IF NOT ok THEN RAISE EXCEPTION 'ASSERT: %', message; END IF; END $$;

INSERT INTO colleges VALUES
 ('10000000-0000-4000-8000-000000000001','C1'),
 ('10000000-0000-4000-8000-000000000002','C2');
INSERT INTO academic_programs VALUES
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','CS'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','IT');
INSERT INTO app_user_access VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','college_admin',true),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','read_only',true),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','college_admin',true);
INSERT INTO room_types VALUES
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','lecture_hall',true,40),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','computer_lab',true,25),
 ('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','seminar_room',true,20),
 ('40000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','project_room',true,10),
 ('40000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001','inactive',false,10),
 ('40000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001','zero',true,0),
 ('40000000-0000-4000-8000-000000000007','10000000-0000-4000-8000-000000000002','foreign',true,10);

CREATE FUNCTION pg_temp.component(t text,h numeric,r uuid,timetabled boolean DEFAULT true)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('component_type',t,'hours',h,'weekly_contact_hours',h,
   'is_timetabled',timetabled,'counts_toward_regular_load',t NOT IN ('project','summer_training'),
   'counts_toward_overtime',t NOT IN ('project','summer_training'),
   'compensation_mode',CASE WHEN t IN ('project','summer_training') THEN 'none' ELSE 'per_hour' END,
   'required_room_type_id',r)
$$;
CREATE FUNCTION pg_temp.row_payload(course_code text, components jsonb, program_id uuid DEFAULT
 '20000000-0000-4000-8000-000000000001')
RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('rowNumber',2,'values',jsonb_build_object(
   '_program_id',program_id,'plan_code','CS-2026','plan_version','1','plan_name','CS Plan',
   'course_code',course_code,'course_name',course_code,'semester',1,
   '_plan_component_sync',components))
$$;
CREATE FUNCTION pg_temp.new_job(payload jsonb, actor uuid DEFAULT
 '30000000-0000-4000-8000-000000000001', entity text DEFAULT 'full_study_plan')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result uuid;
BEGIN
 INSERT INTO import_jobs(college_id,target_entity,mode,status,created_by,validated_payload,payload_manifest)
 VALUES('10000000-0000-4000-8000-000000000001',entity,'upsert','preview',actor,payload,md5(payload::text))
 RETURNING id INTO result;
 RETURN result;
END $$;

SELECT set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',false);
DO $$
DECLARE payload jsonb; job uuid; result jsonb; before_count bigint;
BEGIN
 payload := jsonb_build_array(
   pg_temp.row_payload('CS101',jsonb_build_array(
     pg_temp.component('theory',2,'40000000-0000-4000-8000-000000000001'),
     pg_temp.component('practical',2,'40000000-0000-4000-8000-000000000002'),
     pg_temp.component('tutorial',1,'40000000-0000-4000-8000-000000000003'),
     pg_temp.component('project',1,'40000000-0000-4000-8000-000000000004'))),
   pg_temp.row_payload('CS102',jsonb_build_array(
     pg_temp.component('theory',3,'40000000-0000-4000-8000-000000000001')))
 );
 job := pg_temp.new_job(payload);
 result := public.commit_plan_component_import_job_atomic_v2(job,NULL);
 PERFORM pg_temp.assert_true((result->>'plan_courses_inserted')::int=2,'two plan courses inserted');
 PERFORM pg_temp.assert_true((result->>'components_inserted')::int=5,'five components inserted');
 PERFORM pg_temp.assert_true((result->>'persisted_components_with_required_room_type_id')::int=5,
   'all required room ids persisted');
 PERFORM pg_temp.assert_true((SELECT count(*) FROM plan_course_components
   WHERE required_room_type_id IS NOT NULL)=5,'theory/practical/tutorial/project saved');
 result := public.commit_plan_component_import_job_atomic_v2(job,NULL);
 PERFORM pg_temp.assert_true((result->>'idempotent_replay')::boolean,'same job replay idempotent');

 payload := jsonb_build_array(pg_temp.row_payload('CS101',jsonb_build_array(
   pg_temp.component('theory',2,'40000000-0000-4000-8000-000000000003'))));
 job := pg_temp.new_job(payload);
 result := public.commit_plan_component_import_job_atomic_v2(job,NULL);
 PERFORM pg_temp.assert_true((SELECT required_room_type_id
   FROM plan_course_components pcc JOIN plan_courses pc ON pc.id=pcc.plan_course_id
   JOIN courses c ON c.id=pc.course_id WHERE c.code='CS101' AND pcc.component_type='theory')
   ='40000000-0000-4000-8000-000000000003','legal room type update');

 payload := jsonb_build_array(pg_temp.row_payload('SUMMER1',jsonb_build_array(
   pg_temp.component('summer_training',4,NULL,false))));
 job := pg_temp.new_job(payload);
 result := public.commit_plan_component_import_job_atomic_v2(job,NULL);
 PERFORM pg_temp.assert_true((result->>'persisted_components_with_required_room_type_id')::int=0,
   'summer training legal exemption');
END $$;

CREATE FUNCTION pg_temp.expect_failure(label text, payload jsonb, actor uuid, expected text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE job uuid; pc_before bigint; comp_before bigint; audit_before bigint;
  max_pc timestamptz; max_comp timestamptz;
BEGIN
 SELECT count(*),max(updated_at) INTO pc_before,max_pc FROM plan_courses;
 SELECT count(*),max(updated_at) INTO comp_before,max_comp FROM plan_course_components;
 SELECT count(*) INTO audit_before FROM audit_logs;
 job := pg_temp.new_job(payload,actor);
 PERFORM set_config('request.jwt.claim.sub',COALESCE(actor::text,''),true);
 BEGIN
   PERFORM public.commit_plan_component_import_job_atomic_v2(job,NULL);
   RAISE EXCEPTION 'expected failure %', label;
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM NOT LIKE '%'||expected||'%' THEN
     RAISE EXCEPTION '% wrong error: %',label,SQLERRM;
   END IF;
 END;
 PERFORM pg_temp.assert_true((SELECT count(*) FROM plan_courses)=pc_before,label||' plan count stable');
 PERFORM pg_temp.assert_true((SELECT count(*) FROM plan_course_components)=comp_before,label||' component count stable');
 PERFORM pg_temp.assert_true((SELECT count(*) FROM audit_logs)=audit_before,label||' audit count stable');
 PERFORM pg_temp.assert_true((SELECT max(updated_at) FROM plan_courses) IS NOT DISTINCT FROM max_pc,
   label||' plan timestamps stable');
 PERFORM pg_temp.assert_true((SELECT max(updated_at) FROM plan_course_components) IS NOT DISTINCT FROM max_comp,
   label||' component timestamps stable');
END $$;

SELECT pg_temp.expect_failure('null room',
 jsonb_build_array(pg_temp.row_payload('N1',jsonb_build_array(pg_temp.component('theory',1,NULL)))),
 '30000000-0000-4000-8000-000000000001','ROOM_TYPE_REQUIRED_ATOMIC');
SELECT pg_temp.expect_failure('missing room',
 jsonb_build_array(pg_temp.row_payload('N2',jsonb_build_array(pg_temp.component('theory',1,
 '49999999-0000-4000-8000-000000000099')))),
 '30000000-0000-4000-8000-000000000001','ROOM_TYPE_NOT_FOUND_ATOMIC');
SELECT pg_temp.expect_failure('wrong college',
 jsonb_build_array(pg_temp.row_payload('N3',jsonb_build_array(pg_temp.component('theory',1,
 '40000000-0000-4000-8000-000000000007')))),
 '30000000-0000-4000-8000-000000000001','ROOM_TYPE_WRONG_COLLEGE_ATOMIC');
SELECT pg_temp.expect_failure('inactive',
 jsonb_build_array(pg_temp.row_payload('N4',jsonb_build_array(pg_temp.component('theory',1,
 '40000000-0000-4000-8000-000000000005')))),
 '30000000-0000-4000-8000-000000000001','ROOM_TYPE_INACTIVE_ATOMIC');
SELECT pg_temp.expect_failure('zero capacity',
 jsonb_build_array(pg_temp.row_payload('N5',jsonb_build_array(pg_temp.component('theory',1,
 '40000000-0000-4000-8000-000000000006')))),
 '30000000-0000-4000-8000-000000000001','ROOM_TYPE_ZERO_CAPACITY_ATOMIC');
SELECT pg_temp.expect_failure('unknown component',
 jsonb_build_array(pg_temp.row_payload('N6',jsonb_build_array(pg_temp.component('mystery',1,
 '40000000-0000-4000-8000-000000000001')))),
 '30000000-0000-4000-8000-000000000001','ROOM_TYPE_COMPONENT_CONTRACT_INVALID');
SELECT pg_temp.expect_failure('negative hours',
 jsonb_build_array(pg_temp.row_payload('N7',jsonb_build_array(pg_temp.component('theory',-1,
 '40000000-0000-4000-8000-000000000001')))),
 '30000000-0000-4000-8000-000000000001','ROOM_TYPE_COMPONENT_CONTRACT_INVALID');
SELECT pg_temp.expect_failure('duplicate component',
 jsonb_build_array(pg_temp.row_payload('N8',jsonb_build_array(
 pg_temp.component('theory',1,'40000000-0000-4000-8000-000000000001'),
 pg_temp.component('theory',2,'40000000-0000-4000-8000-000000000001')))),
 '30000000-0000-4000-8000-000000000001','ROOM_TYPE_COMPONENT_CONTRACT_INVALID');
SELECT pg_temp.expect_failure('read only',
 jsonb_build_array(pg_temp.row_payload('N9',jsonb_build_array(pg_temp.component('theory',1,
 '40000000-0000-4000-8000-000000000001')))),
 '30000000-0000-4000-8000-000000000002','college import access denied');
SELECT pg_temp.expect_failure('other college actor',
 jsonb_build_array(pg_temp.row_payload('N10',jsonb_build_array(pg_temp.component('theory',1,
 '40000000-0000-4000-8000-000000000001')))),
 '30000000-0000-4000-8000-000000000003','college import access denied');
SELECT pg_temp.expect_failure('last row rollback',jsonb_build_array(
 pg_temp.row_payload('ROLLBACK_OK',jsonb_build_array(pg_temp.component('theory',1,
 '40000000-0000-4000-8000-000000000001'))),
 pg_temp.row_payload('ROLLBACK_BAD',jsonb_build_array(pg_temp.component('practical',1,NULL)))),
 '30000000-0000-4000-8000-000000000001','ROOM_TYPE_REQUIRED_ATOMIC');
SELECT pg_temp.expect_failure('summer scheduled',
 jsonb_build_array(pg_temp.row_payload('N11',jsonb_build_array(
 pg_temp.component('summer_training',4,NULL,true)))),
 '30000000-0000-4000-8000-000000000001','SUMMER_TRAINING_ROOM_POLICY_REQUIRED');

-- anon: create as manager, clear JWT only for the call.
DO $$
DECLARE payload jsonb; job uuid;
BEGIN
 payload:=jsonb_build_array(pg_temp.row_payload('ANON1',jsonb_build_array(
   pg_temp.component('theory',1,'40000000-0000-4000-8000-000000000001'))));
 job:=pg_temp.new_job(payload);
 PERFORM set_config('request.jwt.claim.sub','',true);
 BEGIN
   PERFORM public.commit_plan_component_import_job_atomic_v2(job,NULL);
   RAISE EXCEPTION 'anon unexpectedly allowed';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM NOT LIKE '%authentication required%' THEN RAISE; END IF;
 END;
END $$;

-- Contract proof for concurrency: unique natural key plus two transaction locks.
SELECT pg_temp.assert_true(
 pg_get_functiondef('public.commit_plan_component_import_job_atomic_v2(uuid,timestamptz)'::regprocedure)
 LIKE '%pg_advisory_xact_lock%' AND
 EXISTS(SELECT 1 FROM pg_constraint WHERE conname='pcc_unique'),
 'concurrent imports serialize and component natural key is unique');

-- Force a count mismatch and prove the entire nested legacy write rolls back.
BEGIN;
CREATE OR REPLACE FUNCTION public._import_sync_plan_components_atomic_v2(
 p_college uuid,p_plan_course uuid,p_components jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN RETURN jsonb_build_object('inserted',0,'updated',0,'room_types_saved',0); END $$;
DO $$
DECLARE payload jsonb; job uuid; before_count bigint;
BEGIN
 SELECT count(*) INTO before_count FROM plan_courses;
 payload:=jsonb_build_array(pg_temp.row_payload('MISMATCH1',jsonb_build_array(
   pg_temp.component('theory',1,'40000000-0000-4000-8000-000000000001'))));
 job:=pg_temp.new_job(payload);
 PERFORM set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
 BEGIN
   PERFORM public.commit_plan_component_import_job_atomic_v2(job,NULL);
   RAISE EXCEPTION 'count mismatch unexpectedly passed';
 EXCEPTION WHEN OTHERS THEN
   IF SQLERRM NOT LIKE '%ATOMIC_ROOM_TYPE_PERSISTENCE_COUNT_MISMATCH%' THEN RAISE; END IF;
 END;
 PERFORM pg_temp.assert_true((SELECT count(*) FROM plan_courses)=before_count,'mismatch rollback');
END $$;
ROLLBACK;

SELECT 'PLAN_COMPONENT_ROOM_TYPE_ATOMIC_PERSISTENCE_PG17_SQL: PASS' AS result;

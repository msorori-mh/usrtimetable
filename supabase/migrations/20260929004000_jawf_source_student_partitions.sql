-- Explicit source groups 1 and 2 contain disjoint estimated 80-student sets.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.academic_cohorts WHERE id='a6a2c3fa-73f3-4b22-9fdf-4c9f9888b50d' AND college_id='0d0e89c6-d041-43de-a448-249070ef6c81' AND expected_students=160 AND count_status='estimated')
 OR (SELECT count(*) FROM public.delivery_groups WHERE cohort_id='a6a2c3fa-73f3-4b22-9fdf-4c9f9888b50d' AND active AND NOT is_obsolete AND expected_students=80 AND group_number IN(1,2))<>12
 OR EXISTS(SELECT 1 FROM public.cohort_student_partitions WHERE cohort_id='a6a2c3fa-73f3-4b22-9fdf-4c9f9888b50d')
 THEN RAISE EXCEPTION 'JAWF_SOURCE_PARTITION_BASELINE_DRIFT'; END IF;
END; $$;
INSERT INTO public.cohort_student_partitions(id,college_id,cohort_id,partition_code,headcount) VALUES
 ('ac290001-0000-4000-8000-000000000001','0d0e89c6-d041-43de-a448-249070ef6c81','a6a2c3fa-73f3-4b22-9fdf-4c9f9888b50d','JWF-PA-L1-G1',80),
 ('ac290001-0000-4000-8000-000000000002','0d0e89c6-d041-43de-a448-249070ef6c81','a6a2c3fa-73f3-4b22-9fdf-4c9f9888b50d','JWF-PA-L1-G2',80);
INSERT INTO public.delivery_group_partition_members(college_id,cohort_id,delivery_group_id,partition_id)
SELECT g.college_id,g.cohort_id,g.id,CASE WHEN group_number=1 THEN 'ac290001-0000-4000-8000-000000000001'::uuid ELSE 'ac290001-0000-4000-8000-000000000002'::uuid END
FROM public.delivery_groups g WHERE cohort_id='a6a2c3fa-73f3-4b22-9fdf-4c9f9888b50d' AND active AND NOT is_obsolete;
DO $$ DECLARE d text; BEGIN
 d:=pg_get_functiondef('public.jawf_term_completion_verified(uuid)'::regprocedure);
 IF position('AND (SELECT count(*) FROM schedule_sessions' IN d)=0 THEN RAISE EXCEPTION 'JAWF_VERIFIER_DRIFT'; END IF;
 d:=replace(d,'AND (SELECT count(*) FROM schedule_sessions',E'AND (SELECT count(*) FROM delivery_group_partition_members m JOIN delivery_groups g ON g.id=m.delivery_group_id JOIN cohort_student_partitions p ON p.id=m.partition_id WHERE g.cohort_id=''a6a2c3fa-73f3-4b22-9fdf-4c9f9888b50d'' AND p.cohort_id=g.cohort_id AND p.active AND p.headcount=80 AND p.partition_code=''JWF-PA-L1-G''||g.group_number::text)=12\n AND (SELECT count(*) FROM schedule_sessions');
 EXECUTE d;
END; $$;
INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
VALUES(NULL,'jawf.source_student_partitions','academic_cohorts','a6a2c3fa-73f3-4b22-9fdf-4c9f9888b50d','0d0e89c6-d041-43de-a448-249070ef6c81','{"source_groups":[1,2],"estimated_headcounts":[80,80],"mapping_count":12,"reason":"Represent independent source groups rather than suppressing student conflicts"}'::jsonb);
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;

DO $sharia$
DECLARE
 c constant uuid:='8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb';
 t constant uuid:='b69f5c5c-8754-4485-9c37-ebdcf6b39092';
 p constant uuid:='7a1c9b2e-5d34-4f18-9a6b-3c2f8e5d0001';
 d constant uuid:='7d2ffbc4-fee3-4ffc-a2c8-4819e5429fe6';
 old_ids constant uuid[]:=ARRAY[
  '369cf17c-66c4-449b-a52b-39116aff81cc','3ad9b69b-a075-4d5a-a605-443571a76129',
  '4d5bd3b8-144b-4e93-be38-83b5e5f7ed98','5f5f4419-6013-42c9-852a-f9c075a2ef13',
  '73fa5074-90f3-45f3-9668-2a3d8f620cad','8235be81-2c08-4a9b-ad00-ca6dce3a591c',
  'd7e9f5bd-72e2-4e29-8301-d450947ba7c5','f55bcc2b-adad-44f7-a47e-4615a8e46b1d']::uuid[];
 new_ids constant uuid[]:=ARRAY[
  'd5f3d7cc-6f01-48ac-874e-3a7cf2413a24','f3b92e2e-fb1b-4b36-8bd3-5ee023693a56',
  '629643e5-4674-4710-9cf2-ad4fd1edd56a','ed4e3ecb-c80d-4fea-a584-201fbe8f3737',
  '63eda38c-61ee-413c-a44e-1a78108bda8f','29df4a0f-408f-4b51-963c-d68d677c0d65',
  '8df9fd74-a495-4971-83b7-06731a09d433','f5697c82-d124-4ba1-a916-470345f7962c']::uuid[];
 before_hash text; after_hash text; n integer; mins integer; candidate uuid; affected integer; pre_new integer;
 i integer; r record;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(9262,4);

 IF array_length(old_ids,1)<>8 OR array_length(new_ids,1)<>8 THEN RAISE EXCEPTION 'SHARIA_MAP_COUNT_DRIFT'; END IF;

 IF NOT EXISTS(SELECT 1 FROM public.schedule_versions WHERE id=p AND college_id=c AND academic_term_id=t AND status='published')
 OR NOT EXISTS(SELECT 1 FROM public.schedule_versions WHERE id=d AND college_id=c AND academic_term_id=t AND status='draft')
 THEN RAISE EXCEPTION 'SHARIA_VERSION_STATE_CHANGED'; END IF;

 SELECT md5(coalesce(string_agg((to_jsonb(s)-'teaching_assignment_id'-'delivery_group_id')::text,'' ORDER BY s.id),'')),count(*)
 INTO before_hash,n FROM public.schedule_sessions s WHERE s.schedule_version_id IN(p,d);
 IF n<>122 THEN RAISE EXCEPTION 'SHARIA_SESSION_SCOPE_DRIFT count=%',n; END IF;

 FOR i IN 1..8 LOOP
  SELECT count(*),(array_agg(x.id))[1] INTO n,candidate
  FROM public.teaching_assignments o
  JOIN public.delivery_groups og ON og.id=o.delivery_group_id
  JOIN public.academic_cohorts oc ON oc.id=o.cohort_id
  JOIN public.course_offerings oo ON oo.id=o.course_offering_id
  JOIN public.teaching_assignments x ON x.is_active AND x.college_id=o.college_id
   AND x.instructor_id=o.instructor_id AND x.course_offering_id=o.course_offering_id
   AND x.cohort_id IS NOT DISTINCT FROM o.cohort_id
   AND x.plan_course_component_id IS NOT DISTINCT FROM o.plan_course_component_id
   AND x.session_type IS NOT DISTINCT FROM o.session_type
   AND x.weekly_hours IS NOT DISTINCT FROM o.weekly_hours
   AND x.assigned_component_hours IS NOT DISTINCT FROM o.assigned_component_hours
  JOIN public.delivery_groups xg ON xg.id=x.delivery_group_id AND xg.active AND NOT coalesce(xg.is_obsolete,false)
   AND xg.college_id=og.college_id AND xg.cohort_id=og.cohort_id
   AND xg.plan_course_id=og.plan_course_id AND xg.component_id=og.component_id
  JOIN public.academic_cohorts xc ON xc.id=x.cohort_id AND xc.term_id=oc.term_id
   AND xc.study_system=oc.study_system AND xc.program_id=oc.program_id AND xc.level_id=oc.level_id
  JOIN public.course_offerings xo ON xo.id=x.course_offering_id AND xo.term_id=oo.term_id
   AND xo.study_system=oo.study_system AND xo.program_id IS NOT DISTINCT FROM oo.program_id
   AND xo.course_id=oo.course_id
  WHERE o.id=old_ids[i] AND NOT o.is_active AND o.college_id=c AND oc.term_id=t AND og.is_obsolete;
  IF n<>1 OR candidate IS DISTINCT FROM new_ids[i] THEN
   RAISE EXCEPTION 'SHARIA_REPLACEMENT_NOT_UNIQUE old=% expected=% actual=% count=%',old_ids[i],new_ids[i],candidate,n;
  END IF;
 END LOOP;

 FOR r IN SELECT unnest(ARRAY[p,d]) version_id LOOP
  SELECT count(*),coalesce(sum(extract(epoch FROM(end_time-start_time))/60),0)::integer INTO n,mins
  FROM public.schedule_sessions WHERE schedule_version_id=r.version_id;
  IF n<>61 OR mins<>8040 THEN RAISE EXCEPTION 'SHARIA_BASELINE_DRIFT version=% count=% minutes=%',r.version_id,n,mins; END IF;
  IF (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id=r.version_id AND teaching_assignment_id=ANY(old_ids))<>8
  THEN RAISE EXCEPTION 'SHARIA_STALE_REF_COUNT_DRIFT version=%',r.version_id; END IF;
 END LOOP;

 SELECT count(*) INTO pre_new FROM public.schedule_sessions
  WHERE schedule_version_id IN(p,d) AND teaching_assignment_id=ANY(new_ids);

 IF EXISTS(SELECT 1 FROM public.schedule_sessions s JOIN public.teaching_assignments o ON o.id=s.teaching_assignment_id
  WHERE s.schedule_version_id IN(p,d) AND s.teaching_assignment_id=ANY(old_ids)
    AND s.delivery_group_id IS DISTINCT FROM o.delivery_group_id)
 THEN RAISE EXCEPTION 'SHARIA_OLD_REF_PAIR_MISMATCH'; END IF;

 IF EXISTS(SELECT 1 FROM public.time_slot_templates WHERE college_id=c AND is_active)
 THEN RAISE EXCEPTION 'SHARIA_ACTIVE_TEMPLATE_ALREADY_EXISTS'; END IF;

 IF EXISTS(
  (SELECT day_of_week,start_time,end_time,count(*) FROM public.schedule_sessions WHERE schedule_version_id=p GROUP BY 1,2,3
   EXCEPT SELECT day_of_week,start_time,end_time,count(*) FROM public.schedule_sessions WHERE schedule_version_id=d GROUP BY 1,2,3)
  UNION ALL
  (SELECT day_of_week,start_time,end_time,count(*) FROM public.schedule_sessions WHERE schedule_version_id=d GROUP BY 1,2,3
   EXCEPT SELECT day_of_week,start_time,end_time,count(*) FROM public.schedule_sessions WHERE schedule_version_id=p GROUP BY 1,2,3))
 THEN RAISE EXCEPTION 'SHARIA_VERSION_WINDOWS_DIFFER'; END IF;

 IF EXISTS(SELECT 1 FROM public.schedule_sessions WHERE schedule_version_id IN(p,d)
   AND (study_system<>'regular' OR start_time<'08:00'::time OR end_time>'14:00'::time))
 THEN RAISE EXCEPTION 'SHARIA_SESSION_OUTSIDE_WINDOW'; END IF;

 IF (SELECT array_agg(DISTINCT day_of_week ORDER BY day_of_week) FROM public.schedule_sessions WHERE schedule_version_id=p)
    IS DISTINCT FROM ARRAY[0,1,2,3,4,6]::smallint[]
 THEN RAISE EXCEPTION 'SHARIA_TEACHING_DAYS_AMBIGUOUS'; END IF;

 EXECUTE 'ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_ss_lock_iud';
 EXECUTE 'ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_ss_updated';
 EXECUTE 'ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_ss_lifecycle_dependency_lock';

 FOR i IN 1..8 LOOP
  UPDATE public.schedule_sessions s
     SET teaching_assignment_id=new_ids[i],
         delivery_group_id=(SELECT x.delivery_group_id FROM public.teaching_assignments x WHERE x.id=new_ids[i])
   WHERE s.teaching_assignment_id=old_ids[i] AND s.schedule_version_id IN(p,d);
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>2 THEN RAISE EXCEPTION 'SHARIA_UNEXPECTED_ROW_COUNT old=% rows=%',old_ids[i],affected; END IF;
 END LOOP;

 SET CONSTRAINTS ALL IMMEDIATE;
 EXECUTE 'ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_lifecycle_dependency_lock';
 EXECUTE 'ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_updated';
 EXECUTE 'ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_lock_iud';

 INSERT INTO public.time_slot_templates(college_id,study_system,day_of_week,start_time,end_time,slot_duration_minutes,is_active)
 SELECT c,'regular',day_number,'08:00','14:00',60,true FROM unnest(ARRAY[0,1,2,3,4,6]::smallint[]) day_number;

 SELECT md5(coalesce(string_agg((to_jsonb(s)-'teaching_assignment_id'-'delivery_group_id')::text,'' ORDER BY s.id),'')),count(*)
 INTO after_hash,n FROM public.schedule_sessions s WHERE s.schedule_version_id IN(p,d);
 IF n<>122 OR after_hash IS DISTINCT FROM before_hash THEN RAISE EXCEPTION 'SHARIA_SESSION_INVARIANT_CHANGED'; END IF;

 IF (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id IN(p,d) AND teaching_assignment_id=ANY(new_ids))<>pre_new+16
 OR EXISTS(SELECT 1 FROM public.schedule_sessions WHERE schedule_version_id IN(p,d) AND teaching_assignment_id=ANY(old_ids))
 THEN RAISE EXCEPTION 'SHARIA_REFERENCE_REPAIR_FAILED'; END IF;

 FOR r IN SELECT unnest(ARRAY[p,d]) version_id LOOP
  SELECT count(*),coalesce(sum(extract(epoch FROM(end_time-start_time))/60),0)::integer INTO n,mins
  FROM public.schedule_sessions WHERE schedule_version_id=r.version_id;
  IF n<>61 OR mins<>8040 THEN RAISE EXCEPTION 'SHARIA_POSTCHECK_FAILED version=% count=% minutes=%',r.version_id,n,mins; END IF;
  IF (SELECT count(DISTINCT s.delivery_group_id) FROM public.schedule_sessions s
      JOIN public.delivery_groups g ON g.id=s.delivery_group_id AND g.active AND NOT coalesce(g.is_obsolete,false)
      WHERE s.schedule_version_id=r.version_id)<>53
  THEN RAISE EXCEPTION 'SHARIA_GROUP_COVERAGE_FAILED version=%',r.version_id; END IF;
 END LOOP;

 IF (SELECT count(*) FROM public.time_slot_templates WHERE college_id=c AND study_system='regular' AND is_active
   AND start_time='08:00' AND end_time='14:00' AND slot_duration_minutes=60 AND day_of_week=ANY(ARRAY[0,1,2,3,4,6]))<>6
 THEN RAISE EXCEPTION 'SHARIA_TEMPLATE_FAILED'; END IF;

 IF EXISTS(SELECT 1 FROM public.schedule_sessions s JOIN public.delivery_groups g ON g.id=s.delivery_group_id
   WHERE s.schedule_version_id IN(p,d)
     AND (g.expected_students<=0 OR g.expected_students IS DISTINCT FROM (
       SELECT sum(cp.headcount) FROM public.delivery_group_partition_members pm
       JOIN public.cohort_student_partitions cp ON cp.id=pm.partition_id AND cp.active
       WHERE pm.delivery_group_id=g.id AND pm.cohort_id=g.cohort_id AND cp.cohort_id=g.cohort_id)))
 THEN RAISE EXCEPTION 'SHARIA_INCOMPLETE_PARTITION_REMAINS'; END IF;

 IF EXISTS(SELECT 1 FROM public.schedule_sessions s WHERE s.schedule_version_id IN(p,d)
   AND NOT EXISTS(SELECT 1 FROM public.time_slot_templates x WHERE x.college_id=s.college_id AND x.is_active
     AND x.day_of_week=s.day_of_week AND (x.study_system=s.study_system OR x.study_system='both')
     AND x.start_time<=s.start_time AND x.end_time>=s.end_time))
 THEN RAISE EXCEPTION 'SHARIA_SYSTEM_TEMPLATE_REMAINS'; END IF;

 IF (SELECT count(*) FROM public.delivery_groups g JOIN public.academic_cohorts ac ON ac.id=g.cohort_id
   WHERE g.college_id=c AND ac.term_id=t AND g.active AND NOT coalesce(g.is_obsolete,false))<>53
 THEN RAISE EXCEPTION 'SHARIA_ACTIVE_GROUP_COUNT_CHANGED'; END IF;
END
$sharia$;
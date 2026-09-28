-- Preserve selected-version group counts, memberships, room types and approved
-- hour waivers when cloning. No global data changes; all existing guards remain.
CREATE OR REPLACE FUNCTION public.clone_schedule_version_current(p_college_id uuid, p_source_version_id uuid, p_target_term_id uuid, p_name text, p_notes text DEFAULT NULL::text, p_disposable_test boolean DEFAULT false, p_require_complete boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
 v_actor uuid:=auth.uid(); v_source public.schedule_versions%ROWTYPE;
 v_id uuid; v_rows jsonb; v_skipped jsonb; v_copied integer; v_total integer;
 v_result jsonb; v_waivers integer;
BEGIN
 IF v_actor IS NULL THEN
   IF session_user NOT IN ('postgres','supabase_admin') AND COALESCE(auth.role(),'')<>'service_role' THEN
     RAISE EXCEPTION 'CLONE_NOT_AUTHORIZED' USING ERRCODE='42501';
   END IF;
 ELSIF NOT public.can_manage_college(v_actor,p_college_id) THEN
   RAISE EXCEPTION 'CLONE_NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;
 IF coalesce(p_disposable_test,false) AND NOT public.is_super_admin(v_actor) THEN
   RAISE EXCEPTION 'DISPOSABLE_CLONE_SUPER_ADMIN_REQUIRED' USING ERRCODE='42501';
 END IF;
 IF nullif(btrim(p_name),'') IS NULL THEN RAISE EXCEPTION 'CLONE_NAME_REQUIRED'; END IF;
 SELECT * INTO v_source FROM public.schedule_versions
 WHERE id=p_source_version_id AND college_id=p_college_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CLONE_SOURCE_NOT_FOUND'; END IF;
 IF p_target_term_id IS DISTINCT FROM v_source.academic_term_id THEN
   RAISE EXCEPTION 'CLONE_TERM_REMAP_REQUIRED';
 END IF;
 -- Hold source/identity rows against edits until the atomic clone is complete.
 PERFORM 1 FROM public.schedule_sessions WHERE schedule_version_id=p_source_version_id FOR SHARE;
 PERFORM 1 FROM public.teaching_assignments WHERE id IN
   (SELECT teaching_assignment_id FROM public.schedule_sessions WHERE schedule_version_id=p_source_version_id) FOR SHARE;
 PERFORM 1 FROM public.delivery_groups WHERE id IN
   (SELECT delivery_group_id FROM public.schedule_sessions WHERE schedule_version_id=p_source_version_id) FOR SHARE;
 PERFORM 1 FROM public.instructors WHERE id IN
   (SELECT instructor_id FROM public.schedule_sessions WHERE schedule_version_id=p_source_version_id) FOR SHARE;
 WITH checked AS (
  SELECT s.*,CASE
   WHEN coalesce(s.replaced_by_split,false) THEN 'replaced_by_split'
   WHEN i.id IS NULL OR NOT i.is_active THEN 'inactive_instructor'
   WHEN s.teaching_assignment_id IS NOT NULL AND (a.id IS NULL OR NOT coalesce(a.is_active,true)) THEN 'inactive_assignment'
   WHEN s.teaching_assignment_id IS NOT NULL AND
    (a.instructor_id IS DISTINCT FROM s.instructor_id OR a.course_offering_id IS DISTINCT FROM s.course_offering_id
     OR (a.delivery_group_id IS NOT NULL AND a.delivery_group_id IS DISTINCT FROM s.delivery_group_id)) THEN 'changed_assignment'
   WHEN s.delivery_group_id IS NOT NULL AND (g.id IS NULL OR NOT coalesce(g.active,true) OR coalesce(g.is_obsolete,false)) THEN 'inactive_group'
   WHEN s.delivery_group_id IS NOT NULL AND
    (g.component_id IS DISTINCT FROM s.plan_course_component_id OR g.cohort_id IS DISTINCT FROM s.cohort_id) THEN 'changed_group'
   WHEN pc.component_type='summer_training' OR (pc.component_type='project' AND NOT coalesce(pc.counts_toward_regular_load,true)) THEN 'non_weekly_component'
   ELSE NULL END AS skip_reason
  FROM public.schedule_sessions s
  LEFT JOIN public.teaching_assignments a ON a.id=s.teaching_assignment_id
  LEFT JOIN public.instructors i ON i.id=s.instructor_id
  LEFT JOIN public.operational_delivery_groups g ON g.id=s.delivery_group_id
  LEFT JOIN public.plan_course_components pc ON pc.id=s.plan_course_component_id
  WHERE s.schedule_version_id=p_source_version_id AND s.college_id=p_college_id
 ) SELECT count(*),
  coalesce(jsonb_agg(to_jsonb(checked)-'skip_reason') FILTER(WHERE skip_reason IS NULL),'[]'),
  coalesce(jsonb_agg(jsonb_build_object('session_id',id,'delivery_group_id',delivery_group_id,
   'teaching_assignment_id',teaching_assignment_id,'reason',skip_reason,'was_locked',is_locked)) FILTER(WHERE skip_reason IS NOT NULL),'[]')
 INTO v_total,v_rows,v_skipped FROM checked;
 IF coalesce(p_require_complete,false) AND jsonb_array_length(v_skipped)>0 THEN
   RAISE EXCEPTION 'CLONE_SOURCE_HAS_STALE_SESSIONS';
 END IF;
 INSERT INTO public.schedule_versions(college_id,academic_term_id,name,status,notes,created_by,disposable_test)
 VALUES(p_college_id,p_target_term_id,btrim(p_name),'draft',coalesce(p_notes,v_source.notes),v_actor,coalesce(p_disposable_test,false)) RETURNING id INTO v_id;

 INSERT INTO schedule_version_delivery_private.clone_provenance(version_id,source_version_id) VALUES(v_id,p_source_version_id);

 -- Preserve the source version's delivery model before guarded session inserts.
 -- Both the snapshot and sessions participate in this same transaction.
 INSERT INTO schedule_version_delivery_private.scope(cohort_id,college_id,version_id)
 SELECT cohort_id,college_id,v_id FROM schedule_version_delivery_private.scope
 WHERE version_id=p_source_version_id;
 INSERT INTO schedule_version_delivery_private.cohort_facts(cohort_id,college_id,expected_students,scheduling_headcount,version_id)
 SELECT cohort_id,college_id,expected_students,scheduling_headcount,v_id FROM schedule_version_delivery_private.cohort_facts
 WHERE version_id=p_source_version_id;
 INSERT INTO schedule_version_delivery_private.group_facts(capacity_limit,cohort_id,college_id,expected_students,group_code,group_id,version_id)
 SELECT capacity_limit,cohort_id,college_id,expected_students,group_code,group_id,v_id FROM schedule_version_delivery_private.group_facts
 WHERE version_id=p_source_version_id;
 INSERT INTO schedule_version_delivery_private.partner_group_facts(capacity_limit,college_id,expected_students,group_id,version_id)
 SELECT capacity_limit,college_id,expected_students,group_id,v_id FROM schedule_version_delivery_private.partner_group_facts
 WHERE version_id=p_source_version_id;
 INSERT INTO schedule_version_delivery_private.partition_facts(cohort_id,college_id,headcount,partition_code,partition_id,version_id)
 SELECT cohort_id,college_id,headcount,partition_code,partition_id,v_id FROM schedule_version_delivery_private.partition_facts
 WHERE version_id=p_source_version_id;
 INSERT INTO schedule_version_delivery_private.group_partition_facts(group_id,partition_id,version_id)
 SELECT group_id,partition_id,v_id FROM schedule_version_delivery_private.group_partition_facts
 WHERE version_id=p_source_version_id;
 INSERT INTO schedule_version_delivery_private.shared_link_facts(anchor_group_id,college_id,member_group_id,version_id)
 SELECT anchor_group_id,college_id,member_group_id,v_id FROM schedule_version_delivery_private.shared_link_facts
 WHERE version_id=p_source_version_id;
 INSERT INTO schedule_version_delivery_private.partner_partition_facts(cohort_id,group_id,headcount,partition_id,version_id)
 SELECT cohort_id,group_id,headcount,partition_id,v_id FROM schedule_version_delivery_private.partner_partition_facts
 WHERE version_id=p_source_version_id;
 INSERT INTO schedule_version_delivery_private.component_room_type_facts(component_id,room_type_id,version_id)
 SELECT component_id,room_type_id,v_id FROM schedule_version_delivery_private.component_room_type_facts
 WHERE version_id=p_source_version_id;
 INSERT INTO schedule_version_delivery_private.instructor_hour_waivers(assignment_id,college_id,group_id,instructor_id,reason,source_assignment_id,term_id,version_id)
 SELECT assignment_id,college_id,group_id,instructor_id,reason,source_assignment_id,term_id,v_id FROM schedule_version_delivery_private.instructor_hour_waivers
 WHERE version_id=p_source_version_id;
 INSERT INTO public.schedule_sessions(
  college_id,schedule_version_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,
  section_id,section_group_id,section_subgroup_id,cohort_id,delivery_group_id,plan_course_component_id,
  study_system,day_of_week,start_time,end_time,session_type,expected_students,source_type,is_locked,lock_reason)
 SELECT college_id,v_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,
  section_id,section_group_id,section_subgroup_id,cohort_id,delivery_group_id,plan_course_component_id,
  study_system,day_of_week,start_time,end_time,session_type,expected_students,source_type,is_locked,lock_reason
 FROM jsonb_populate_recordset(NULL::public.schedule_sessions,v_rows);
 GET DIAGNOSTICS v_copied=ROW_COUNT;
 -- Carry over ONLY approved, still-valid, officially scoped exceptions, re-bound to the
 -- equivalent session(s) in the clone. Revoked, expired, or unmappable exceptions are
 -- never carried, so the guards keep rejecting those overlaps.
 WITH mapping AS (
   SELECT os.id AS old_id, min(ns.id::text)::uuid AS new_id
   FROM public.schedule_sessions os
   JOIN public.schedule_sessions ns
     ON ns.schedule_version_id=v_id
    AND ns.college_id=os.college_id
    AND ns.day_of_week=os.day_of_week
    AND ns.start_time=os.start_time
    AND ns.end_time=os.end_time
    AND ns.instructor_id IS NOT DISTINCT FROM os.instructor_id
    AND ns.room_id IS NOT DISTINCT FROM os.room_id
    AND ns.delivery_group_id IS NOT DISTINCT FROM os.delivery_group_id
    AND ns.course_offering_id IS NOT DISTINCT FROM os.course_offering_id
    AND ns.plan_course_component_id IS NOT DISTINCT FROM os.plan_course_component_id
   WHERE os.schedule_version_id=p_source_version_id AND os.college_id=p_college_id
   GROUP BY os.id
   HAVING count(*)=1
 )
 INSERT INTO public.schedule_version_conflict_exceptions(
   college_id,schedule_version_id,conflict_code,session_id,related_session_id,
   approval_type,reason,source,status,approved_by,approved_at,metadata)
 SELECT e.college_id,v_id,e.conflict_code,m1.new_id,m2.new_id,
   e.approval_type,e.reason,e.source,'approved',e.approved_by,e.approved_at,
   coalesce(e.metadata,'{}'::jsonb) || jsonb_build_object(
     'cloned_from_exception_id',e.id,
     'cloned_from_session_id',e.session_id,
     'cloned_from_related_session_id',e.related_session_id,
     'cloned_from_version_id',p_source_version_id)
 FROM public.schedule_version_conflict_exceptions e
 JOIN mapping m1 ON m1.old_id=e.session_id
 LEFT JOIN mapping m2 ON m2.old_id=e.related_session_id
 WHERE e.schedule_version_id=p_source_version_id
  AND e.college_id=p_college_id
  AND e.status='approved'
  AND e.approval_type IN ('cross_college_instructor','source_file_literal_match')
  AND e.conflict_code IN ('instructor_conflict','cross_college_instructor_conflict','delivery_group_conflict')
  AND (e.related_session_id IS NULL OR m2.new_id IS NOT NULL)
  AND (e.metadata->>'expires_at' IS NULL
       OR (e.metadata->>'expires_at')::timestamptz > now());
 GET DIAGNOSTICS v_waivers=ROW_COUNT;
 v_result:=jsonb_build_object('version_id',v_id,'source_sessions',v_total,'sessions_copied',v_copied,
   'sessions_skipped',jsonb_array_length(v_skipped),'skipped_sessions',v_skipped,
   'exceptions_carried',v_waivers);
 INSERT INTO public.schedule_version_events(college_id,schedule_version_id,event_type,from_status,to_status,performed_by,notes,metadata)
 VALUES(p_college_id,v_id,'cloned',NULL,'draft',v_actor,'استنساخ وفق الإسنادات الحالية؛ يلزم استكمال التسكين وفحص الجودة',
  v_result || jsonb_build_object('source_version_id',p_source_version_id,'disposable_test',coalesce(p_disposable_test,false)));
 RETURN v_result;
END $function$
;

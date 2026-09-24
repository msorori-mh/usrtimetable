-- Clone only sessions whose operational identities remain current. All writes
-- (version, sessions, event) commit together; existing session guards stay active.
CREATE OR REPLACE FUNCTION public.clone_schedule_version_current(
 p_college_id uuid, p_source_version_id uuid, p_target_term_id uuid,
 p_name text, p_notes text DEFAULT NULL, p_disposable_test boolean DEFAULT false,
 p_require_complete boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 v_actor uuid:=auth.uid(); v_source public.schedule_versions%ROWTYPE;
 v_id uuid; v_rows jsonb; v_skipped jsonb; v_copied integer; v_total integer;
 v_result jsonb;
BEGIN
 IF v_actor IS NULL OR NOT public.can_manage_college(v_actor,p_college_id) THEN
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
 INSERT INTO public.schedule_sessions(
  college_id,schedule_version_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,
  section_id,section_group_id,section_subgroup_id,cohort_id,delivery_group_id,plan_course_component_id,
  study_system,day_of_week,start_time,end_time,session_type,expected_students,source_type,is_locked,lock_reason)
 SELECT college_id,v_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,
  section_id,section_group_id,section_subgroup_id,cohort_id,delivery_group_id,plan_course_component_id,
  study_system,day_of_week,start_time,end_time,session_type,expected_students,source_type,is_locked,lock_reason
 FROM jsonb_populate_recordset(NULL::public.schedule_sessions,v_rows);
 GET DIAGNOSTICS v_copied=ROW_COUNT;
 v_result:=jsonb_build_object('version_id',v_id,'source_sessions',v_total,'sessions_copied',v_copied,
   'sessions_skipped',jsonb_array_length(v_skipped),'skipped_sessions',v_skipped);
 INSERT INTO public.schedule_version_events(college_id,schedule_version_id,event_type,from_status,to_status,performed_by,notes,metadata)
 VALUES(p_college_id,v_id,'cloned',NULL,'draft',v_actor,'استنساخ وفق الإسنادات الحالية؛ يلزم استكمال التسكين وفحص الجودة',
  v_result || jsonb_build_object('source_version_id',p_source_version_id,'disposable_test',coalesce(p_disposable_test,false)));
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.clone_schedule_version_current(uuid,uuid,uuid,text,text,boolean,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.clone_schedule_version_current(uuid,uuid,uuid,text,text,boolean,boolean) TO authenticated;

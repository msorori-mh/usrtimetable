-- Read-only university aggregation over verified faculty registry links.
-- Rollback: DROP FUNCTION public.get_faculty_university_report(uuid,uuid,uuid[]);
CREATE OR REPLACE FUNCTION public.get_faculty_university_report(
  p_instructor_id uuid, p_term_id uuid, p_version_ids uuid[] DEFAULT '{}'::uuid[]
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid(); v_identity uuid; v_university uuid;
  v_year text; v_type text; v_ids uuid[]; v_terms uuid[]; v_colleges uuid[];
  v_quota numeric; v_quotas numeric[]; v_missing boolean; v_pending boolean;
  v_hours numeric; v_project numeric; v_members jsonb; v_sessions jsonb;
  v_versions jsonb; v_college_hours jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
  SELECT l.identity_id,f.university_id INTO v_identity,v_university
  FROM faculty_identity_links l JOIN faculty_identities f ON f.id=l.identity_id
  JOIN instructors i ON i.id=l.instructor_id
  WHERE i.id=p_instructor_id AND can_view_college(v_uid,i.college_id);
  IF v_identity IS NULL THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
  -- A partial view must never masquerade as the university total.
  IF EXISTS(SELECT 1 FROM faculty_identity_links l JOIN instructors i ON i.id=l.instructor_id
    WHERE l.identity_id=v_identity AND NOT can_view_college(v_uid,i.college_id)) THEN
    RAISE EXCEPTION 'FACULTY_REPORT_REQUIRES_ACCESS_TO_ALL_LINKED_COLLEGES' USING ERRCODE='42501';
  END IF;
  SELECT academic_year,term_type INTO v_year,v_type FROM academic_terms t
  WHERE t.id=p_term_id AND can_view_college(v_uid,t.college_id)
    AND EXISTS(SELECT 1 FROM colleges c WHERE c.id=t.college_id AND c.university_id=v_university);
  IF v_year IS NULL OR v_type IS NULL THEN RAISE EXCEPTION 'FACULTY_REPORT_TERM_METADATA_REQUIRED'; END IF;
  SELECT array_agg(i.id),array_agg(DISTINCT i.college_id),
    jsonb_agg(jsonb_build_object('id',i.id,'name',coalesce(i.full_name_ar,i.full_name),
      'college_id',i.college_id,'college',c.name,'base_quota',i.max_weekly_hours,
      'release',i.administrative_release_hours,'specialization',i.specialization) ORDER BY c.name,i.id)
  INTO v_ids,v_colleges,v_members FROM faculty_identity_links l
  JOIN instructors i ON i.id=l.instructor_id JOIN colleges c ON c.id=i.college_id
  WHERE l.identity_id=v_identity;
  SELECT array_agg(t.id) INTO v_terms FROM academic_terms t JOIN colleges c ON c.id=t.college_id
  WHERE t.academic_year=v_year AND t.term_type=v_type AND c.university_id=v_university;
  IF EXISTS(SELECT 1 FROM teaching_assignments ta JOIN course_offerings o ON o.id=ta.course_offering_id
    WHERE ta.instructor_id=ANY(v_ids) AND ta.is_active AND o.term_id=ANY(v_terms)
      AND NOT can_view_college(v_uid,ta.college_id)) THEN
    RAISE EXCEPTION 'FACULTY_REPORT_REQUIRES_ACCESS_TO_ALL_LINKED_COLLEGES' USING ERRCODE='42501';
  END IF;
  SELECT array_agg(DISTINCT x) INTO v_colleges FROM (
    SELECT unnest(v_colleges) x UNION
    SELECT ta.college_id FROM teaching_assignments ta JOIN course_offerings o ON o.id=ta.course_offering_id
      WHERE ta.instructor_id=ANY(v_ids) AND ta.is_active AND o.term_id=ANY(v_terms)
  ) q;
  IF EXISTS(SELECT 1 FROM unnest(coalesce(p_version_ids,'{}')) id
    WHERE NOT EXISTS(SELECT 1 FROM schedule_versions s WHERE s.id=id
      AND s.college_id=ANY(v_colleges) AND s.academic_term_id=ANY(v_terms)
      AND can_view_college(v_uid,s.college_id) AND NOT s.disposable_test))
    OR EXISTS(SELECT 1 FROM schedule_versions WHERE id=ANY(p_version_ids)
      GROUP BY college_id HAVING count(*)>1) THEN RAISE EXCEPTION 'FACULTY_REPORT_INVALID_VERSION_SELECTION'; END IF;
  SELECT array_agg(DISTINCT (q->>'required_load_hours')::numeric),
    bool_or(q->>'required_load_hours' IS NULL)
  INTO v_quotas,v_missing FROM (
    SELECT compute_instructor_standard_workload(id,NULL) q FROM unnest(v_ids) id
  ) x;
  IF NOT v_missing AND cardinality(v_quotas)=1 THEN v_quota:=v_quotas[1]; END IF;
  SELECT coalesce(sum(w.standard_assigned_hours),0),coalesce(sum(w.project_supervision_hours),0)
  INTO v_hours,v_project FROM v_instructor_delivery_workload w
  WHERE w.instructor_id=ANY(v_ids) AND w.term_id=ANY(v_terms) AND can_view_college(v_uid,w.college_id);
  SELECT EXISTS(
    SELECT 1 FROM teaching_assignments a JOIN course_offerings o ON o.id=a.course_offering_id
    WHERE a.instructor_id=ANY(v_ids) AND a.is_active AND o.term_id=ANY(v_terms)
      AND (a.delivery_group_id IS NULL OR
        (a.assigned_component_hours IS NULL AND
          (SELECT count(*) FROM teaching_assignments b WHERE b.delivery_group_id=a.delivery_group_id AND b.is_active)>1))
  ) OR EXISTS(
    SELECT 1 FROM teaching_assignments a JOIN course_offerings o ON o.id=a.course_offering_id
    WHERE a.instructor_id=ANY(v_ids) AND a.is_active AND o.term_id=ANY(v_terms)
      AND a.delivery_group_id IS NOT NULL GROUP BY a.delivery_group_id HAVING count(*)>1
  ) INTO v_pending;
  SELECT coalesce(jsonb_agg(x),'[]') INTO v_college_hours FROM (
    SELECT w.college_id,c.name college,sum(w.standard_assigned_hours) assigned_hours,
      sum(w.project_supervision_hours) project_hours
    FROM v_instructor_delivery_workload w JOIN colleges c ON c.id=w.college_id
    WHERE w.instructor_id=ANY(v_ids) AND w.term_id=ANY(v_terms)
      AND can_view_college(v_uid,w.college_id) GROUP BY w.college_id,c.name
  ) x;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'college_id',s.college_id,'college',c.name,
    'name',s.name,'status',s.status,'is_coordination',s.is_coordination) ORDER BY c.name,s.created_at DESC),'[]')
  INTO v_versions FROM schedule_versions s JOIN colleges c ON c.id=s.college_id
  WHERE s.college_id=ANY(v_colleges) AND s.academic_term_id=ANY(v_terms)
    AND can_view_college(v_uid,s.college_id) AND NOT s.disposable_test;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'college',c.name,'college_id',s.college_id,
    'version_id',s.schedule_version_id,'day',s.day_of_week,'start',s.start_time,'end',s.end_time,
    'course',co.name,'room',r.name,'type',s.session_type,'study_system',s.study_system)
    ORDER BY s.day_of_week,s.start_time,s.id),'[]')
  INTO v_sessions FROM schedule_sessions s JOIN colleges c ON c.id=s.college_id
    LEFT JOIN course_offerings o ON o.id=s.course_offering_id LEFT JOIN courses co ON co.id=o.course_id
    LEFT JOIN rooms r ON r.id=s.room_id
  WHERE s.schedule_version_id=ANY(p_version_ids) AND NOT s.replaced_by_split
    AND can_view_college(v_uid,s.college_id)
    AND (s.instructor_id=ANY(v_ids) OR EXISTS(
      SELECT 1 FROM existing_schedule_source_rows src WHERE src.schedule_session_id=s.id
        AND src.instructor_ids && v_ids));
  RETURN jsonb_build_object('identity_id',v_identity,
    'university_number',(SELECT university_number FROM faculty_identities WHERE id=v_identity),
    'academic_year',v_year,'term_type',v_type,'members',v_members,'quota',v_quota,
    'quota_status',CASE WHEN v_missing THEN 'missing' WHEN cardinality(v_quotas)>1 THEN 'conflict' ELSE 'ok' END,
    'assigned_hours',v_hours,'project_hours',v_project,'allocation_pending',v_pending,
    'overload',CASE WHEN v_quota IS NOT NULL AND NOT v_pending THEN greatest(0,v_hours-v_quota) END,
    'deficit',CASE WHEN v_quota IS NOT NULL AND NOT v_pending THEN greatest(0,v_quota-v_hours) END,
    'colleges',v_college_hours,'versions',v_versions,'sessions',v_sessions);
END $$;
REVOKE ALL ON FUNCTION public.get_faculty_university_report(uuid,uuid,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_faculty_university_report(uuid,uuid,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.link_faculty_identity_with_evidence(
  p_instructor_id uuid,p_university_number text,p_evidence text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501';
  END IF;
  IF length(trim(coalesce(p_evidence,'')))<12 THEN RAISE EXCEPTION 'FACULTY_IDENTITY_EVIDENCE_REQUIRED'; END IF;
  PERFORM link_verified_faculty_identity(p_instructor_id,p_university_number);
  INSERT INTO audit_logs(actor_id,action,entity,entity_id,details)
  VALUES(auth.uid(),'faculty_identity_evidence','instructors',p_instructor_id,
    jsonb_build_object('university_number',upper(trim(p_university_number)),'evidence',trim(p_evidence)));
END $$;
REVOKE ALL ON FUNCTION public.link_faculty_identity_with_evidence(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_faculty_identity_with_evidence(uuid,text,text) TO authenticated;

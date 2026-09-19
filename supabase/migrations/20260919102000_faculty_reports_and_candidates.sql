CREATE FUNCTION faculty_private.workload(p_instructor_id uuid,p_term_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h record;v_ids uuid[];v_terms uuid[];v_year text;v_type text;
 v_hours numeric;v_project numeric;v_colleges jsonb;v_pending boolean;
BEGIN
 SELECT hp.* INTO h FROM faculty_private.home_profiles hp JOIN faculty_identity_links l ON l.identity_id=hp.identity_id WHERE l.instructor_id=p_instructor_id;
 IF h.identity_id IS NULL THEN RAISE EXCEPTION 'FACULTY_IDENTITY_NOT_FOUND'; END IF;
 SELECT array_agg(instructor_id) INTO v_ids FROM faculty_identity_links WHERE identity_id=h.identity_id;
 IF p_term_id IS NOT NULL THEN
  SELECT coalesce(nullif(btrim(academic_year),''),substring(t.name from '[0-9]{4}-[0-9]{4}')),t.term_type INTO v_year,v_type FROM academic_terms t
  JOIN colleges c ON c.id=t.college_id WHERE t.id=p_term_id AND c.university_id=h.university_id;
  IF v_year IS NULL OR v_type IS NULL THEN RAISE EXCEPTION 'FACULTY_REPORT_TERM_METADATA_REQUIRED'; END IF;
  SELECT array_agg(t.id) INTO v_terms FROM academic_terms t JOIN colleges c ON c.id=t.college_id
  WHERE c.university_id=h.university_id AND coalesce(nullif(btrim(t.academic_year),''),substring(t.name from '[0-9]{4}-[0-9]{4}'))=v_year AND t.term_type=v_type;
 END IF;
 SELECT coalesce(sum(standard_assigned_hours),0),coalesce(sum(project_supervision_hours),0)
 INTO v_hours,v_project FROM v_instructor_delivery_workload WHERE instructor_id=ANY(v_ids) AND (p_term_id IS NULL OR term_id=ANY(v_terms));
 SELECT EXISTS(SELECT 1 FROM teaching_assignments a JOIN course_offerings o ON o.id=a.course_offering_id
 WHERE a.instructor_id=ANY(v_ids) AND a.is_active AND (p_term_id IS NULL OR o.term_id=ANY(v_terms))
 AND (a.delivery_group_id IS NULL OR (a.assigned_component_hours IS NULL AND
  (SELECT count(*) FROM teaching_assignments b WHERE b.delivery_group_id=a.delivery_group_id AND b.is_active)>1)))
 OR EXISTS(SELECT 1 FROM teaching_assignments a JOIN course_offerings o ON o.id=a.course_offering_id
 WHERE a.instructor_id=ANY(v_ids) AND a.is_active AND a.delivery_group_id IS NOT NULL AND (p_term_id IS NULL OR o.term_id=ANY(v_terms))
 GROUP BY a.delivery_group_id HAVING count(*)>1) INTO v_pending;
 SELECT coalesce(jsonb_agg(x),'[]') INTO v_colleges FROM (
 SELECT college_id,college_id=h.home_college_id AS is_home_college,sum(standard_assigned_hours) AS standard_assigned_hours,
 sum(project_supervision_hours) AS project_supervision_hours FROM v_instructor_delivery_workload
 WHERE instructor_id=ANY(v_ids) AND (p_term_id IS NULL OR term_id=ANY(v_terms)) GROUP BY college_id) x;
 RETURN jsonb_build_object('instructor_id',p_instructor_id,'identity_id',h.identity_id,'college_id',h.home_college_id,
 'term_id',p_term_id,'rank_code',NULL,'academic_rank',h.academic_rank,'required_load_hours',h.quota,
 'standard_assigned_hours',v_hours,'project_supervision_hours',v_project,'hours_by_college',v_colleges,'allocation_pending',v_pending,
 'deficit_hours',CASE WHEN NOT v_pending AND h.quota IS NOT NULL THEN greatest(0,h.quota-v_hours) END,
 'overload_hours',CASE WHEN NOT v_pending AND h.quota IS NOT NULL THEN greatest(0,v_hours-h.quota) END,
 'status',CASE WHEN h.quota IS NULL THEN 'policy_missing' WHEN v_pending THEN 'allocation_pending'
 WHEN v_hours=0 THEN 'unassigned' WHEN v_hours>h.quota THEN 'overload' WHEN v_hours<h.quota THEN 'deficit' ELSE 'ok' END);
END $$;
CREATE OR REPLACE FUNCTION public.compute_instructor_standard_workload(p_instructor_id uuid,p_term_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM instructors i WHERE i.id=p_instructor_id AND can_view_college(auth.uid(),i.college_id)) THEN
 RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 v:=faculty_private.workload(p_instructor_id,p_term_id);
 -- College managers receive aggregate capacity without names or details of other colleges.
 IF NOT (is_super_admin(auth.uid()) OR has_role(auth.uid(),'university_leadership')) THEN v:=v||jsonb_build_object('hours_by_college','[]'::jsonb); END IF;
 RETURN v;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA faculty_private FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_delivery_group_assignment_candidates(p_delivery_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_candidates jsonb := '[]'::jsonb;
  v_colleges jsonb := '[]'::jsonb;
  v_alloc jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_group_id IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_dg FROM public.operational_delivery_groups WHERE id = p_delivery_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_view_college(v_uid, v_dg.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
  v_alloc := public.compute_delivery_group_allocation(p_delivery_group_id);

  SELECT COALESCE(jsonb_agg(x ORDER BY x.is_home_college DESC, x.college_name, x.full_name), '[]'::jsonb)
  INTO v_candidates
  FROM (
    SELECT
      i.id AS instructor_id,
      i.full_name,
      i.academic_rank,
      hp.home_college_id AS home_college_id,
      c.name AS college_name,
      (hp.home_college_id = v_dg.college_id) AS is_home_college,
      CASE WHEN hp.home_college_id = v_dg.college_id THEN i.employee_number ELSE NULL END AS employee_number,
      EXISTS (
        SELECT 1 FROM public.teaching_assignments ta
        WHERE ta.delivery_group_id = p_delivery_group_id
          AND EXISTS(SELECT 1 FROM public.faculty_identity_links al WHERE al.instructor_id=ta.instructor_id AND al.identity_id=hp.identity_id)
          AND ta.is_active = TRUE
      ) AS already_assigned
    FROM faculty_private.home_profiles hp
    JOIN public.instructors i ON i.id=hp.source_instructor_id
    JOIN public.colleges c ON c.id=hp.home_college_id
    WHERE i.is_active = TRUE AND c.university_id=(SELECT university_id FROM colleges WHERE id=v_dg.college_id)
  ) x;

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
      'college_id', c.id,
      'college_name', c.name,
      'is_home_college', (c.id = v_dg.college_id)
    )), '[]'::jsonb)
  INTO v_colleges
  FROM public.colleges c
  WHERE c.university_id=(SELECT university_id FROM colleges WHERE id=v_dg.college_id) AND EXISTS (SELECT 1 FROM faculty_private.home_profiles hp WHERE hp.home_college_id=c.id AND hp.is_active);

  RETURN jsonb_build_object(
    'ok', true,
    'delivery_group_id', p_delivery_group_id,
    'college_id', v_dg.college_id,
    'is_obsolete', COALESCE(v_dg.is_obsolete, false),
    'active', COALESCE(v_dg.active, true),
    'component_type', v_pcc.component_type,
    'component_hours', v_pcc.weekly_contact_hours,
    'allocation', v_alloc,
    'candidates', v_candidates,
    'candidate_colleges', v_colleges,
    'assignable', NOT COALESCE(v_dg.is_obsolete, false)
      AND COALESCE(v_dg.active, true)
      AND COALESCE(v_pcc.component_type, '') IS DISTINCT FROM 'summer_training'
      AND public.can_manage_college(v_uid, v_dg.college_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_instructor_workload_after_assignment(p_instructor_id uuid, p_delivery_group_id uuid, p_assigned_component_hours numeric DEFAULT NULL::numeric, p_assignment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_instructor public.instructors%ROWTYPE;
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_term_id uuid;
  v_current jsonb;
  v_proposed_hours numeric;
  v_projected_standard numeric;
  v_projected_project numeric;
  v_required numeric;
  v_warnings jsonb := '[]'::jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_co_count integer;
  v_is_project boolean;
  v_status_before text;
  v_status_after text;
  v_deficit_before numeric;
  v_deficit_after numeric;
  v_overload_before numeric;
  v_overload_after numeric;
  v_old_std numeric := 0;
  v_old_proj numeric := 0;
  v_peer_hours numeric := 0;
  v_baseline_standard numeric;
  v_baseline_project numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_instructor_id IS NULL OR p_delivery_group_id IS NULL THEN
    RAISE EXCEPTION 'INSTRUCTOR_AND_DELIVERY_GROUP_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_instructor FROM public.instructors WHERE id = p_instructor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO v_dg FROM public.operational_delivery_groups WHERE id = p_delivery_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.can_view_college(v_uid, v_dg.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF (SELECT hp.home_college_id FROM faculty_private.home_profiles hp JOIN faculty_identity_links l ON l.identity_id=hp.identity_id WHERE l.instructor_id=p_instructor_id) <> v_dg.college_id THEN
    v_warnings := v_warnings || jsonb_build_array('CROSS_COLLEGE_ASSIGNMENT');
  END IF;
  IF COALESCE(v_dg.is_obsolete, false) THEN
    v_conflicts := v_conflicts || jsonb_build_array('OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN');
  END IF;
  IF COALESCE(v_dg.active, true) = false THEN
    v_conflicts := v_conflicts || jsonb_build_array('DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN');
  END IF;

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
  IF v_pcc.component_type = 'summer_training' THEN
    v_conflicts := v_conflicts || jsonb_build_array('SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN');
  END IF;

  SELECT ac.term_id INTO v_term_id FROM public.academic_cohorts ac WHERE ac.id = v_dg.cohort_id;

  v_current := faculty_private.workload(p_instructor_id, v_term_id);
  v_baseline_standard := COALESCE((v_current->>'standard_assigned_hours')::numeric, 0);
  v_baseline_project := COALESCE((v_current->>'project_supervision_hours')::numeric, 0);
  v_required := (v_current->>'required_load_hours')::numeric;
  v_status_before := v_current->>'status';
  v_deficit_before := COALESCE((v_current->>'deficit_hours')::numeric, 0);
  v_overload_before := COALESCE((v_current->>'overload_hours')::numeric, 0);

  SELECT COUNT(*)::integer INTO v_co_count
  FROM public.teaching_assignments ta
  WHERE ta.delivery_group_id = p_delivery_group_id
    AND ta.is_active = TRUE
    AND (p_assignment_id IS NULL OR ta.id IS DISTINCT FROM p_assignment_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.teaching_assignments ta
    WHERE ta.delivery_group_id = p_delivery_group_id
      AND ta.instructor_id = p_instructor_id
      AND ta.is_active = TRUE
      AND (p_assignment_id IS NULL OR ta.id = p_assignment_id)
  ) THEN
    v_co_count := v_co_count + 1;
  ELSE
    v_co_count := GREATEST(v_co_count, 1);
  END IF;

  IF v_co_count > 1 AND p_assigned_component_hours IS NULL THEN
    v_conflicts := v_conflicts || jsonb_build_array('CO_TEACHING_HOURS_SPLIT_REQUIRED');
    v_proposed_hours := 0;
  ELSIF p_assigned_component_hours IS NOT NULL THEN
    IF p_assigned_component_hours <= 0 THEN
      v_conflicts := v_conflicts || jsonb_build_array('ASSIGNED_HOURS_MUST_BE_POSITIVE');
    END IF;
    v_proposed_hours := p_assigned_component_hours;
  ELSE
    v_proposed_hours := COALESCE(v_pcc.weekly_contact_hours, 0);
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN ta.assigned_component_hours IS NOT NULL THEN ta.assigned_component_hours
      WHEN v_co_count <= 1 THEN COALESCE(v_pcc.weekly_contact_hours, 0)
      ELSE 0
    END
  ), 0)
  INTO v_peer_hours
  FROM public.teaching_assignments ta
  WHERE ta.delivery_group_id = p_delivery_group_id
    AND ta.is_active = TRUE
    AND (p_assignment_id IS NULL OR ta.id IS DISTINCT FROM p_assignment_id);

  IF COALESCE(v_peer_hours, 0) + COALESCE(v_proposed_hours, 0) > COALESCE(v_pcc.weekly_contact_hours, 0) THEN
    v_conflicts := v_conflicts || jsonb_build_array('CO_TEACHING_HOURS_OVER_ALLOCATED');
  END IF;

  v_is_project := COALESCE(v_dg.excluded_from_standard_workload, false)
    OR COALESCE(v_pcc.counts_toward_regular_load, true) = false;

  IF p_assignment_id IS NOT NULL THEN
    SELECT
      CASE
        WHEN pcc.component_type = 'summer_training' THEN 0
        WHEN COALESCE(dg.excluded_from_standard_workload, false)
          OR COALESCE(pcc.counts_toward_regular_load, true) = false THEN 0
        WHEN (
          SELECT COUNT(*) FROM public.teaching_assignments ta2
          WHERE ta2.delivery_group_id = ta.delivery_group_id AND ta2.is_active = TRUE
        ) > 1 THEN COALESCE(ta.assigned_component_hours, 0)
        ELSE COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0)
      END,
      CASE
        WHEN pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN
          CASE WHEN (
            SELECT COUNT(*) FROM public.teaching_assignments ta2
            WHERE ta2.delivery_group_id = ta.delivery_group_id AND ta2.is_active = TRUE
          ) > 1 THEN COALESCE(ta.assigned_component_hours, 0)
          ELSE COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) END
        ELSE 0
      END
    INTO v_old_std, v_old_proj
    FROM public.teaching_assignments ta
    JOIN public.operational_delivery_groups dg ON dg.id = ta.delivery_group_id
    JOIN public.plan_course_components pcc ON pcc.id = COALESCE(ta.plan_course_component_id, dg.component_id)
    WHERE ta.id = p_assignment_id;

    v_baseline_standard := GREATEST(0, v_baseline_standard - COALESCE(v_old_std, 0));
    v_baseline_project := GREATEST(0, v_baseline_project - COALESCE(v_old_proj, 0));
  END IF;

  IF v_is_project THEN
    v_projected_standard := v_baseline_standard;
    v_projected_project := v_baseline_project + COALESCE(v_proposed_hours, 0);
  ELSE
    v_projected_standard := v_baseline_standard + COALESCE(v_proposed_hours, 0);
    v_projected_project := v_baseline_project;
  END IF;

  IF v_required IS NULL THEN
    v_status_after := 'policy_missing';
    v_warnings := v_warnings || jsonb_build_array('policy_missing');
    v_deficit_after := 0;
    v_overload_after := 0;
  ELSIF v_projected_standard = 0 THEN
    v_status_after := 'unassigned';
    v_deficit_after := v_required;
    v_overload_after := 0;
  ELSIF v_projected_standard > v_required THEN
    v_status_after := 'overload';
    v_overload_after := v_projected_standard - v_required;
    v_deficit_after := 0;
    v_warnings := v_warnings || jsonb_build_array('workload_overload');
  ELSIF v_projected_standard < v_required THEN
    v_status_after := 'deficit';
    v_deficit_after := v_required - v_projected_standard;
    v_overload_after := 0;
  ELSE
    v_status_after := 'ok';
    v_deficit_after := 0;
    v_overload_after := 0;
  END IF;

  IF v_required IS NOT NULL AND v_projected_standard > v_required + 12 THEN
    v_conflicts := v_conflicts || jsonb_build_array('INSTRUCTOR_EXTRA_HOURS_LIMIT_EXCEEDED');
  END IF;

  IF v_status_before = 'policy_missing' AND v_required IS NOT NULL THEN
    v_warnings := v_warnings || jsonb_build_array('policy_missing');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'instructor_id', p_instructor_id,
    'delivery_group_id', p_delivery_group_id,
    'term_id', v_term_id,
    'required_load_hours', v_required,
    'current_standard_assigned_hours', (v_current->>'standard_assigned_hours')::numeric,
    'proposed_assignment_hours', v_proposed_hours,
    'projected_standard_assigned_hours', v_projected_standard,
    'current_project_hours', (v_current->>'project_supervision_hours')::numeric,
    'projected_project_hours', v_projected_project,
    'deficit_before', v_deficit_before,
    'deficit_after', v_deficit_after,
    'overload_before', v_overload_before,
    'overload_after', v_overload_after,
    'status_before', v_status_before,
    'status_after', v_status_after,
    'policy_missing', v_required IS NULL,
    'warnings', v_warnings,
    'assignment_conflicts', v_conflicts,
    'component_type', v_pcc.component_type,
    'is_project', v_is_project
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_faculty_university_report(p_instructor_id uuid, p_term_id uuid, p_version_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  SELECT coalesce(nullif(btrim(academic_year),''),substring(t.name from '[0-9]{4}-[0-9]{4}')),t.term_type INTO v_year,v_type FROM academic_terms t
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
  WHERE coalesce(nullif(btrim(t.academic_year),''),substring(t.name from '[0-9]{4}-[0-9]{4}'))=v_year AND t.term_type=v_type AND c.university_id=v_university;
  IF EXISTS(SELECT 1 FROM teaching_assignments ta JOIN course_offerings o ON o.id=ta.course_offering_id
    WHERE ta.instructor_id=ANY(v_ids) AND ta.is_active AND o.term_id=ANY(v_terms)
      AND NOT can_view_college(v_uid,ta.college_id)) THEN
    RAISE EXCEPTION 'FACULTY_REPORT_REQUIRES_ACCESS_TO_ALL_LINKED_COLLEGES' USING ERRCODE='42501';
  END IF;
  SELECT array_agg(DISTINCT x) INTO v_colleges FROM (
    SELECT unnest(v_colleges) x UNION
    SELECT ta.college_id FROM teaching_assignments ta JOIN course_offerings o ON o.id=ta.course_offering_id
      WHERE ta.instructor_id=ANY(v_ids) AND ta.is_active AND o.term_id=ANY(v_terms)
    UNION SELECT ss.college_id FROM schedule_sessions ss JOIN schedule_versions sv ON sv.id=ss.schedule_version_id
      WHERE sv.academic_term_id=ANY(v_terms) AND NOT sv.disposable_test AND NOT ss.replaced_by_split
      AND (ss.instructor_id=ANY(v_ids) OR EXISTS(SELECT 1 FROM existing_schedule_source_rows src
        WHERE src.schedule_session_id=ss.id AND src.instructor_ids && v_ids))
  ) q;
  IF EXISTS(SELECT 1 FROM unnest(v_colleges) c WHERE NOT can_view_college(v_uid,c)) THEN
    RAISE EXCEPTION 'FACULTY_REPORT_REQUIRES_ACCESS_TO_ALL_LINKED_COLLEGES' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(coalesce(p_version_ids,'{}')) id
    WHERE NOT EXISTS(SELECT 1 FROM schedule_versions s WHERE s.id=id
      AND s.college_id=ANY(v_colleges) AND s.academic_term_id=ANY(v_terms)
      AND can_view_college(v_uid,s.college_id) AND NOT s.disposable_test))
    OR EXISTS(SELECT 1 FROM schedule_versions WHERE id=ANY(p_version_ids)
      GROUP BY college_id HAVING count(*)>1) THEN RAISE EXCEPTION 'FACULTY_REPORT_INVALID_VERSION_SELECTION'; END IF;
  SELECT h.quota,h.quota IS NULL,CASE WHEN h.quota IS NOT NULL THEN ARRAY[h.quota] ELSE '{}'::numeric[] END
  INTO v_quota,v_missing,v_quotas FROM faculty_private.home_profiles h WHERE h.identity_id=v_identity;
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
  IF cardinality(coalesce(p_version_ids,'{}'))=0 THEN
    SELECT coalesce(array_agg(id),'{}') INTO p_version_ids FROM (
      SELECT DISTINCT ON (sv.college_id) sv.id FROM schedule_versions sv
      WHERE sv.college_id=ANY(v_colleges) AND sv.academic_term_id=ANY(v_terms)
       AND NOT sv.disposable_test AND (sv.status='published' OR (sv.is_coordination AND sv.status IN ('draft','review','approved')))
      ORDER BY sv.college_id,(sv.status='published') DESC,sv.created_at DESC,sv.id
    ) chosen;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'college',c.name,'college_id',s.college_id,
    'version_id',s.schedule_version_id,'day',s.day_of_week,'start',s.start_time,'end',s.end_time,
    'course',co.name,'room',r.name,'type',s.session_type,'study_system',s.study_system,
    'group_name',coalesce(participants.groups,dg.group_code),'program',coalesce(participants.programs,ap.name))
    ORDER BY s.day_of_week,s.start_time,s.id),'[]')
  INTO v_sessions FROM schedule_sessions s JOIN colleges c ON c.id=s.college_id
    LEFT JOIN course_offerings o ON o.id=s.course_offering_id LEFT JOIN courses co ON co.id=o.course_id
    LEFT JOIN rooms r ON r.id=s.room_id
    LEFT JOIN delivery_groups dg ON dg.id=s.delivery_group_id
    LEFT JOIN academic_cohorts ac ON ac.id=coalesce(s.cohort_id,dg.cohort_id)
    LEFT JOIN academic_programs ap ON ap.id=ac.program_id
    LEFT JOIN LATERAL (
      SELECT string_agg(DISTINCT member.group_code,' / ' ORDER BY member.group_code) AS groups,
        string_agg(DISTINCT prog.name,' / ' ORDER BY prog.name) AS programs
      FROM delivery_groups member JOIN academic_cohorts cohort ON cohort.id=member.cohort_id
      JOIN academic_programs prog ON prog.id=cohort.program_id
      WHERE member.id=s.delivery_group_id OR EXISTS(SELECT 1 FROM shared_lecture_links sl
        WHERE sl.anchor_group_id=s.delivery_group_id AND sl.member_group_id=member.id)
    ) participants ON true
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
    'colleges',v_college_hours,'versions',v_versions,'sessions',v_sessions,
    'selected_version_ids',p_version_ids,
    'unscheduled',(SELECT coalesce(jsonb_agg(x),'[]') FROM (
      SELECT a.id,c.name AS college,co.name AS course,dg.group_code AS group_name,
        coalesce(a.assigned_component_hours,a.weekly_hours) AS hours
      FROM teaching_assignments a JOIN course_offerings o ON o.id=a.course_offering_id
      JOIN courses co ON co.id=o.course_id JOIN colleges c ON c.id=a.college_id
      LEFT JOIN delivery_groups dg ON dg.id=a.delivery_group_id
      WHERE a.instructor_id=ANY(v_ids) AND a.is_active AND o.term_id=ANY(v_terms)
        AND NOT EXISTS(SELECT 1 FROM schedule_sessions ss WHERE ss.schedule_version_id=ANY(p_version_ids)
          AND NOT ss.replaced_by_split AND (ss.instructor_id=ANY(v_ids) OR EXISTS(
           SELECT 1 FROM existing_schedule_source_rows src WHERE src.schedule_session_id=ss.id AND src.instructor_ids && v_ids))
          AND ((a.delivery_group_id IS NOT NULL AND ss.delivery_group_id=a.delivery_group_id)
            OR (a.delivery_group_id IS NULL AND ss.course_offering_id=a.course_offering_id)))
    ) x));
END $function$;

-- Preserve the existing +12 hour policy, applying it to the single university identity.
CREATE OR REPLACE FUNCTION public.enforce_instructor_extra_hours_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_term uuid;v_load jsonb;v_quota numeric;
BEGIN
 IF NOT coalesce(NEW.is_active,false) THEN RETURN NEW; END IF;
 SELECT term_id INTO v_term FROM course_offerings WHERE id=NEW.course_offering_id;
 IF public.existing_schedule_intake_enabled(NEW.college_id,v_term) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(180600,1);
 v_load:=faculty_private.workload(NEW.instructor_id,v_term);
 v_quota:=(v_load->>'required_load_hours')::numeric;
 IF v_quota IS NULL THEN RAISE EXCEPTION 'INSTRUCTOR_QUOTA_REQUIRED: يجب اعتماد النصاب من الكلية الأصلية' USING ERRCODE='23514'; END IF;
 IF (v_load->>'allocation_pending')::boolean THEN RAISE EXCEPTION 'FACULTY_ALLOCATION_REVIEW_REQUIRED' USING ERRCODE='23514'; END IF;
 IF (v_load->>'standard_assigned_hours')::numeric>v_quota+12 THEN
  RAISE EXCEPTION 'INSTRUCTOR_EXTRA_HOURS_LIMIT_EXCEEDED: الساعات الزائدة لا يجوز أن تتجاوز 12 ساعة أسبوعيًا' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

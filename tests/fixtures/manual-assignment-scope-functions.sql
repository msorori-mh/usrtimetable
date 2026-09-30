-- Production function baseline only; historical IDs anonymized. No user records.
CREATE OR REPLACE FUNCTION faculty_private.quota_applicability(p_type text, p_employment text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE
  WHEN p_type IN ('permanent','appointed') AND p_employment='contract' THEN NULL
  WHEN p_type IN ('permanent','appointed') THEN true
  WHEN p_type IN ('con','annual_contract','contract_unspecified') THEN false
  WHEN p_employment='contract' THEN false
  ELSE NULL END
$function$
;

CREATE OR REPLACE FUNCTION faculty_private.workload(p_instructor_id uuid, p_term_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
 WHERE a.instructor_id=ANY(v_ids) AND a.is_active AND assignment_version_private.is_counted(a.id) AND (p_term_id IS NULL OR o.term_id=ANY(v_terms))
 AND (a.delivery_group_id IS NULL OR (a.assigned_component_hours IS NULL AND
  (SELECT count(*) FROM teaching_assignments b WHERE b.delivery_group_id=a.delivery_group_id AND b.is_active AND NOT assignment_version_private.is_replacement_pair(a.id,b.id))>1)))
 OR EXISTS(SELECT 1 FROM teaching_assignments a JOIN course_offerings o ON o.id=a.course_offering_id
 WHERE a.instructor_id=ANY(v_ids) AND a.is_active AND assignment_version_private.is_counted(a.id) AND a.delivery_group_id IS NOT NULL AND (p_term_id IS NULL OR o.term_id=ANY(v_terms))
 GROUP BY a.delivery_group_id HAVING count(*)>1) INTO v_pending;
 SELECT coalesce(jsonb_agg(x),'[]') INTO v_colleges FROM (
 SELECT college_id,college_id=h.home_college_id AS is_home_college,sum(standard_assigned_hours) AS standard_assigned_hours,
 sum(project_supervision_hours) AS project_supervision_hours FROM v_instructor_delivery_workload
 WHERE instructor_id=ANY(v_ids) AND (p_term_id IS NULL OR term_id=ANY(v_terms)) GROUP BY college_id) x;
 RETURN jsonb_build_object('instructor_id',p_instructor_id,'identity_id',h.identity_id,'college_id',h.home_college_id,
 'term_id',p_term_id,'rank_code',NULL,'academic_rank',h.academic_rank,'required_load_hours',h.quota,
 'quota_applicable',faculty_private.quota_applicability(h.type_code,h.employment_type),
 'standard_assigned_hours',v_hours,'project_supervision_hours',v_project,'hours_by_college',v_colleges,'allocation_pending',v_pending,
 'deficit_hours',CASE WHEN NOT v_pending AND h.quota IS NOT NULL THEN greatest(0,h.quota-v_hours) END,
 'overload_hours',CASE WHEN NOT v_pending AND h.quota IS NOT NULL THEN greatest(0,v_hours-h.quota) END,
 'status',CASE WHEN v_pending THEN 'allocation_pending'
 WHEN faculty_private.quota_applicability(h.type_code,h.employment_type) IS FALSE THEN 'not_applicable'
 WHEN h.quota IS NULL THEN 'policy_missing'
 WHEN v_hours=0 THEN 'unassigned' WHEN v_hours>h.quota THEN 'overload' WHEN v_hours<h.quota THEN 'deficit' ELSE 'ok' END);
END $function$
;

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

  IF (v_current->>'quota_applicable')::boolean IS FALSE THEN
    v_status_after := 'not_applicable';
    v_deficit_before := NULL;
    v_overload_before := NULL;
    v_deficit_after := NULL;
    v_overload_after := NULL;
  ELSIF v_required IS NULL THEN
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
    'quota_applicable', (v_current->>'quota_applicable')::boolean,
    'policy_missing', v_required IS NULL AND (v_current->>'quota_applicable')::boolean IS NOT FALSE,
    'warnings', v_warnings,
    'assignment_conflicts', v_conflicts,
    'component_type', v_pcc.component_type,
    'is_project', v_is_project
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.compute_delivery_group_allocation(p_delivery_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_dg public.delivery_groups%ROWTYPE;
  v_hours numeric;
  v_type text;
  v_sum numeric := 0;
  v_count integer := 0;
  v_remaining numeric;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
  IF p_delivery_group_id IS NULL THEN RAISE EXCEPTION 'DELIVERY_GROUP_ID_REQUIRED' USING ERRCODE='check_violation'; END IF;

  v_dg := public.operational_delivery_group(p_delivery_group_id);
  IF v_dg.id IS NULL THEN RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE='no_data_found'; END IF;
  IF NOT public.can_view_college(v_uid,v_dg.college_id) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;

  SELECT pcc.weekly_contact_hours,pcc.component_type INTO v_hours,v_type
  FROM public.plan_course_components pcc WHERE pcc.id=v_dg.component_id;

  SELECT COALESCE(SUM(ta.assigned_component_hours),0),COUNT(*)::integer INTO v_sum,v_count
  FROM public.teaching_assignments ta
  WHERE ta.delivery_group_id=p_delivery_group_id AND ta.is_active=true;

  IF v_count=1 THEN
    SELECT COALESCE(ta.assigned_component_hours,v_hours,0) INTO v_sum
    FROM public.teaching_assignments ta
    WHERE ta.delivery_group_id=p_delivery_group_id AND ta.is_active=true LIMIT 1;
  END IF;

  v_remaining:=GREATEST(0,COALESCE(v_hours,0)-COALESCE(v_sum,0));
  IF v_count=0 THEN v_status:='unassigned';
  ELSIF COALESCE(v_sum,0)>COALESCE(v_hours,0) THEN v_status:='over_allocated';
  ELSIF COALESCE(v_sum,0)<COALESCE(v_hours,0) THEN v_status:='under_allocated';
  ELSE v_status:='fully_allocated'; END IF;

  RETURN jsonb_build_object('delivery_group_id',p_delivery_group_id,'component_type',v_type,
    'component_hours',v_hours,'assigned_hours_total',v_sum,'remaining_hours',v_remaining,
    'assignment_count',v_count,'is_co_taught',v_count>1,'allocation_status',v_status);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validate_assignment_allocation_locked(p_delivery_group_id uuid, p_exclude_assignment_id uuid, p_new_hours numeric, p_component_hours numeric, p_include_new_row boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_co_count integer;
  v_null_split_count integer;
  v_sum_assigned numeric;
BEGIN
  IF p_include_new_row AND p_exclude_assignment_id IS NULL
     AND nullif(current_setting('app.version_scoped_pending_assignment', true), '') IS NOT NULL
     AND EXISTS (SELECT 1 FROM assignment_version_private.scope s
       WHERE s.assignment_id = nullif(current_setting('app.version_scoped_pending_assignment', true), '')::uuid)
     AND NOT EXISTS (SELECT 1 FROM public.teaching_assignments t
       WHERE t.id = nullif(current_setting('app.version_scoped_pending_assignment', true), '')::uuid) THEN
    RETURN;
  END IF;
  SELECT COUNT(*)::integer,
         COUNT(*) FILTER (
           WHERE ta.assigned_component_hours IS NULL
             AND (p_exclude_assignment_id IS NULL OR ta.id IS DISTINCT FROM p_exclude_assignment_id)
         )::integer
           + CASE WHEN p_include_new_row AND p_new_hours IS NULL THEN 1 ELSE 0 END,
         COALESCE(
           SUM(ta.assigned_component_hours) FILTER (
             WHERE p_exclude_assignment_id IS NULL OR ta.id IS DISTINCT FROM p_exclude_assignment_id
           ),
           0
         )
           + CASE WHEN p_include_new_row THEN COALESCE(p_new_hours, 0) ELSE 0 END
    INTO v_co_count, v_null_split_count, v_sum_assigned
  FROM public.teaching_assignments ta
  WHERE ta.delivery_group_id = p_delivery_group_id
    AND ta.is_active = TRUE
    AND NOT EXISTS (SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id = ta.id);

  IF p_include_new_row
     AND (
       p_exclude_assignment_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.teaching_assignments ta2
         WHERE ta2.id = p_exclude_assignment_id
           AND ta2.delivery_group_id = p_delivery_group_id
           AND ta2.is_active = TRUE
       )
     ) THEN
    v_co_count := v_co_count + 1;
  END IF;

  IF v_co_count > 1 AND v_null_split_count > 0 THEN
    RAISE EXCEPTION 'CO_TEACHING_HOURS_SPLIT_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF p_component_hours IS NOT NULL AND v_sum_assigned > p_component_hours THEN
    RAISE EXCEPTION 'CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION faculty_private.submit_request(p_delivery_group_id uuid, p_instructor_id uuid, p_hours numeric, p_notes text, p_assignment_id uuid DEFAULT NULL::uuid, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE h record; g public.delivery_groups%ROWTYPE; a public.teaching_assignments%ROWTYPE;
 v_term uuid;v_component_hours numeric;v_hours numeric;r public.faculty_teaching_requests%ROWTYPE;
 v_orphan_id uuid; v_orphan_count integer:=0;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 -- Match the identity linker lock before taking any delivery-group lock.
 PERFORM pg_advisory_xact_lock(180600,1);
 SELECT hp.* INTO h FROM faculty_private.home_profiles hp JOIN faculty_identity_links l ON l.identity_id=hp.identity_id
 WHERE l.instructor_id=p_instructor_id;
 IF h.identity_id IS NULL OR h.home_college_id IS NULL THEN RAISE EXCEPTION 'FACULTY_HOME_REVIEW_REQUIRED'; END IF;
 IF NOT coalesce(h.is_active,false) THEN RAISE EXCEPTION 'INSTRUCTOR_INACTIVE'; END IF;
 g:=lock_delivery_group_for_assignment(p_delivery_group_id);
 IF NOT can_manage_college(auth.uid(),g.college_id) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM colleges WHERE id=g.college_id AND university_id=h.university_id) THEN RAISE EXCEPTION 'FACULTY_UNIVERSITY_MISMATCH'; END IF;
 PERFORM assert_delivery_group_assignable(g.is_obsolete,g.active);
 SELECT c.term_id,p.weekly_contact_hours INTO v_term,v_component_hours FROM academic_cohorts c
 JOIN plan_course_components p ON p.id=g.component_id WHERE c.id=g.cohort_id AND p.component_type<>'summer_training';
 IF v_term IS NULL OR v_component_hours IS NULL THEN RAISE EXCEPTION 'REQUEST_COMPONENT_INVALID'; END IF;
 v_hours:=coalesce(p_hours,v_component_hours);
 IF v_hours<=0 THEN RAISE EXCEPTION 'ASSIGNED_HOURS_MUST_BE_POSITIVE'; END IF;
 IF p_assignment_id IS NOT NULL THEN
  SELECT * INTO a FROM teaching_assignments WHERE id=p_assignment_id FOR UPDATE;
  IF a.delivery_group_id IS DISTINCT FROM g.id OR a.instructor_id IS DISTINCT FROM p_instructor_id OR NOT a.is_active
    OR a.updated_at IS DISTINCT FROM p_expected_updated_at THEN RAISE EXCEPTION 'STALE_ASSIGNMENT_UPDATE'; END IF;
 ELSE
  IF EXISTS(SELECT 1 FROM teaching_assignments ta JOIN faculty_identity_links l ON l.instructor_id=ta.instructor_id
    WHERE ta.delivery_group_id=g.id AND ta.is_active AND l.identity_id=h.identity_id) THEN RAISE EXCEPTION 'DUPLICATE_ACTIVE_ASSIGNMENT'; END IF;
 END IF;
 IF p_assignment_id IS NULL THEN
  -- Same safe orphan rule as apply_create_assignment: active assignment in the shared-lecture scope
  -- whose instructor row no longer exists. Exactly one may be excluded; more than one fails closed.
  SELECT count(*)::integer INTO v_orphan_count FROM teaching_assignments ta LEFT JOIN instructors i ON i.id=ta.instructor_id
  WHERE ta.delivery_group_id IN (SELECT m.group_id FROM shared_lecture_group_ids(g.id) m) AND ta.is_active AND i.id IS NULL;
  IF v_orphan_count>1 THEN RAISE EXCEPTION 'MULTIPLE_ORPHAN_ASSIGNMENTS_REVIEW_REQUIRED' USING ERRCODE='check_violation'; END IF;
  IF v_orphan_count=1 THEN
   SELECT ta.id INTO v_orphan_id FROM teaching_assignments ta LEFT JOIN instructors i ON i.id=ta.instructor_id
   WHERE ta.delivery_group_id IN (SELECT m.group_id FROM shared_lecture_group_ids(g.id) m) AND ta.is_active AND i.id IS NULL
   FOR UPDATE OF ta;
  END IF;
 END IF;
 PERFORM validate_assignment_allocation_locked(g.id,coalesce(p_assignment_id,v_orphan_id),v_hours,v_component_hours,true);
 IF h.home_college_id=g.college_id THEN
   IF p_assignment_id IS NOT NULL THEN RETURN faculty_private.apply_update_assignment(p_assignment_id,p_expected_updated_at,v_hours,p_notes); END IF;
   RETURN faculty_private.apply_create_assignment(g.id,h.source_instructor_id,v_hours,p_notes);
 END IF;
 IF EXISTS(SELECT 1 FROM faculty_teaching_requests WHERE identity_id=h.identity_id AND delivery_group_id=g.id AND status='pending') THEN
   RAISE EXCEPTION 'FACULTY_REQUEST_ALREADY_PENDING';
 END IF;
 INSERT INTO faculty_teaching_requests(identity_id,instructor_id,home_college_id,college_id,delivery_group_id,term_id,
 component_hours,assigned_hours,assignment_id,expected_assignment_updated_at,notes,requested_by)
 VALUES(h.identity_id,CASE WHEN p_assignment_id IS NULL THEN h.source_instructor_id ELSE p_instructor_id END,
 h.home_college_id,g.college_id,g.id,v_term,v_component_hours,v_hours,p_assignment_id,p_expected_updated_at,p_notes,auth.uid()) RETURNING * INTO r;
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,college_id,details)
 VALUES(auth.uid(),'faculty_teaching_requested','faculty_teaching_requests',r.id,r.college_id,jsonb_build_object('home_college_id',r.home_college_id,'hours',v_hours));
 IF is_super_admin(auth.uid()) THEN RETURN public.decide_faculty_teaching_request(r.id,'approved','اعتماد مباشر بواسطة الأدمن'); END IF;
 RETURN jsonb_build_object('ok',true,'action','requested','request_id',r.id,'delivery_group_id',g.id,'instructor_id',r.instructor_id);
END $function$
;

CREATE OR REPLACE FUNCTION faculty_private.apply_create_assignment(p_delivery_group_id uuid, p_instructor_id uuid, p_assigned_component_hours numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_instructor public.instructors%ROWTYPE;
  v_offering_id uuid;
  v_session_type text;
  v_effective_hours numeric;
  v_existing public.teaching_assignments%ROWTYPE;
  v_orphan public.teaching_assignments%ROWTYPE;
  v_orphan_count integer := 0;
  v_row public.teaching_assignments%ROWTYPE;
  v_action text;
  v_audit_action text;
  v_draft_before integer := 0;
  v_draft_after integer := 0;
  v_hist_before integer := 0;
  v_hist_after integer := 0;
  v_draft_ids uuid[];
  v_fp_before text;
  v_fp_after text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_group_id IS NULL OR p_instructor_id IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_AND_INSTRUCTOR_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  v_dg := public.lock_delivery_group_for_assignment(p_delivery_group_id);
  PERFORM public.assert_delivery_group_assignable(v_dg.is_obsolete, v_dg.active);

  SELECT * INTO v_instructor
  FROM public.instructors
  WHERE id = p_instructor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_pcc
  FROM public.plan_course_components
  WHERE id = v_dg.component_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_COMPONENT_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pcc.component_type = 'summer_training' THEN
    RAISE EXCEPTION 'SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;
  IF p_assigned_component_hours IS NOT NULL AND p_assigned_component_hours <= 0 THEN
    RAISE EXCEPTION 'ASSIGNED_HOURS_MUST_BE_POSITIVE' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_existing
  FROM public.teaching_assignments ta
  WHERE ta.college_id = v_dg.college_id
    AND ta.delivery_group_id = p_delivery_group_id
    AND ta.instructor_id = p_instructor_id
  ORDER BY ta.is_active DESC, ta.updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing.id IS NOT NULL AND v_existing.is_active THEN
    RAISE EXCEPTION 'DUPLICATE_ACTIVE_ASSIGNMENT' USING ERRCODE = 'unique_violation';
  END IF;

  -- An orphan is active and attached to the group, but its instructor row is gone.
  -- Fail closed when more than one orphan exists; that state needs explicit review.
  SELECT count(*)::integer
  INTO v_orphan_count
  FROM public.teaching_assignments ta
  LEFT JOIN public.instructors i ON i.id = ta.instructor_id
  WHERE ta.delivery_group_id IN (SELECT m.group_id FROM public.shared_lecture_group_ids(p_delivery_group_id) m)
    AND ta.is_active = true
    AND i.id IS NULL;

  IF v_orphan_count > 1 THEN
    RAISE EXCEPTION 'MULTIPLE_ORPHAN_ASSIGNMENTS_REVIEW_REQUIRED'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_orphan_count = 1 THEN
    SELECT ta.* INTO v_orphan
    FROM public.teaching_assignments ta
    LEFT JOIN public.instructors i ON i.id = ta.instructor_id
    WHERE ta.delivery_group_id IN (SELECT m.group_id FROM public.shared_lecture_group_ids(p_delivery_group_id) m)
      AND ta.is_active = true
      AND i.id IS NULL
    LIMIT 1
    FOR UPDATE OF ta;
  END IF;

  v_offering_id := public.resolve_offering_for_delivery_group(p_delivery_group_id);
  IF v_offering_id IS NULL THEN
    RAISE EXCEPTION 'NO_COMPATIBILITY_OFFERING' USING ERRCODE = 'check_violation';
  END IF;

  v_session_type := CASE v_pcc.component_type
    WHEN 'theory' THEN 'lecture'
    WHEN 'practical' THEN 'lab'
    WHEN 'tutorial' THEN 'tutorial'
    WHEN 'project' THEN 'seminar'
    ELSE 'lecture'
  END;
  v_effective_hours := COALESCE(p_assigned_component_hours, v_pcc.weekly_contact_hours, 0);

  PERFORM public.validate_assignment_allocation_locked(
    p_delivery_group_id,
    COALESCE(
      v_orphan.id,
      CASE WHEN v_existing.id IS NOT NULL AND NOT v_existing.is_active THEN v_existing.id END
    ),
    p_assigned_component_hours,
    v_pcc.weekly_contact_hours,
    true
  );

  IF v_orphan.id IS NOT NULL THEN
    -- Draft-only repair: historical (non-draft) sessions stay on the old orphan row untouched.
    IF v_instructor.is_active IS DISTINCT FROM true OR v_instructor.availability_status IS DISTINCT FROM 'available' THEN
      RAISE EXCEPTION 'ORPHAN_REPAIR_INSTRUCTOR_INVALID' USING ERRCODE = 'check_violation';
    END IF;

    SELECT array_agg(ss.id ORDER BY ss.id) INTO v_draft_ids
    FROM public.schedule_sessions ss
    JOIN public.schedule_versions sv ON sv.id = ss.schedule_version_id
    WHERE ss.teaching_assignment_id = v_orphan.id AND sv.status = 'draft';
    v_draft_before := coalesce(array_length(v_draft_ids, 1), 0);

    SELECT count(*)::integer INTO v_hist_before
    FROM public.schedule_sessions ss
    JOIN public.schedule_versions sv ON sv.id = ss.schedule_version_id
    WHERE ss.teaching_assignment_id = v_orphan.id AND sv.status <> 'draft';

    PERFORM 1 FROM public.schedule_sessions WHERE id = ANY(coalesce(v_draft_ids, '{}')) FOR UPDATE;

    SELECT string_agg(concat_ws('|', ss.id, ss.schedule_version_id, ss.day_of_week, ss.start_time, ss.end_time,
             ss.room_id, ss.delivery_group_id, ss.cohort_id, ss.course_offering_id, ss.section_id,
             ss.section_group_id, ss.section_subgroup_id, ss.session_type, ss.study_system), ',' ORDER BY ss.id)
    INTO v_fp_before
    FROM public.schedule_sessions ss WHERE ss.id = ANY(coalesce(v_draft_ids, '{}'))
       OR ss.teaching_assignment_id = v_orphan.id;

    UPDATE public.teaching_assignments SET is_active = false
    WHERE id = v_orphan.id AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ORPHAN_DEACTIVATION_FAILED' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO public.teaching_assignments (
      college_id, course_offering_id, instructor_id, section_number, session_type,
      weekly_hours, notes, expected_students, cohort_id, plan_course_component_id,
      delivery_group_id, assigned_component_hours, is_active
    ) VALUES (
      v_dg.college_id, v_offering_id, p_instructor_id,
      COALESCE(v_dg.group_code, v_dg.group_number::text), v_session_type,
      v_effective_hours, p_notes, COALESCE(v_dg.expected_students, 0),
      v_dg.cohort_id, v_dg.component_id, p_delivery_group_id,
      p_assigned_component_hours, true
    )
    RETURNING * INTO v_row;

    IF v_draft_before > 0 AND v_instructor.college_id IS DISTINCT FROM v_dg.college_id THEN
      UPDATE public.faculty_teaching_requests fr SET assignment_id = v_row.id
      WHERE fr.id = (
        SELECT fr2.id FROM public.faculty_teaching_requests fr2
        WHERE fr2.instructor_id = p_instructor_id AND fr2.college_id = v_dg.college_id
          AND fr2.delivery_group_id = p_delivery_group_id AND fr2.status = 'approved'
          AND fr2.assignment_id IS NULL AND fr2.decided_by = v_uid AND fr2.decided_at = now()
        ORDER BY fr2.created_at DESC LIMIT 1);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ORPHAN_REPAIR_REQUEST_BINDING_FAILED' USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    IF v_draft_before > 0 THEN
      UPDATE public.schedule_sessions SET
        teaching_assignment_id = v_row.id,
        instructor_id = p_instructor_id
      WHERE id = ANY(v_draft_ids)
        AND teaching_assignment_id = v_orphan.id;
      GET DIAGNOSTICS v_draft_after = ROW_COUNT;
    END IF;

    SELECT count(*)::integer INTO v_hist_after
    FROM public.schedule_sessions ss
    JOIN public.schedule_versions sv ON sv.id = ss.schedule_version_id
    WHERE ss.teaching_assignment_id = v_orphan.id AND sv.status <> 'draft';

    SELECT string_agg(concat_ws('|', ss.id, ss.schedule_version_id, ss.day_of_week, ss.start_time, ss.end_time,
             ss.room_id, ss.delivery_group_id, ss.cohort_id, ss.course_offering_id, ss.section_id,
             ss.section_group_id, ss.section_subgroup_id, ss.session_type, ss.study_system), ',' ORDER BY ss.id)
    INTO v_fp_after
    FROM public.schedule_sessions ss WHERE ss.id = ANY(coalesce(v_draft_ids, '{}'))
       OR ss.teaching_assignment_id = v_orphan.id;

    IF v_draft_after <> v_draft_before
       OR v_hist_after <> v_hist_before
       OR v_fp_after IS DISTINCT FROM v_fp_before
       OR EXISTS (SELECT 1 FROM public.schedule_sessions ss WHERE ss.id = ANY(coalesce(v_draft_ids, '{}'))
                  AND (ss.teaching_assignment_id IS DISTINCT FROM v_row.id OR ss.instructor_id IS DISTINCT FROM p_instructor_id)) THEN
      RAISE EXCEPTION 'ORPHAN_REPAIR_INVARIANT_VIOLATION' USING ERRCODE = 'check_violation';
    END IF;

    v_action := 'orphan_repaired';
    v_audit_action := 'teaching_assignment_orphan_repaired';
  ELSIF v_existing.id IS NOT NULL AND NOT v_existing.is_active THEN
    UPDATE public.teaching_assignments SET
      is_active = true,
      assigned_component_hours = p_assigned_component_hours,
      weekly_hours = v_effective_hours,
      notes = COALESCE(p_notes, notes),
      course_offering_id = v_offering_id,
      cohort_id = v_dg.cohort_id,
      plan_course_component_id = v_dg.component_id,
      session_type = v_session_type,
      expected_students = COALESCE(v_dg.expected_students, expected_students)
    WHERE id = v_existing.id
    RETURNING * INTO v_row;
    v_action := 'reactivated';
    v_audit_action := 'teaching_assignment_reactivated';
  ELSE
    INSERT INTO public.teaching_assignments (
      college_id, course_offering_id, instructor_id, section_number, session_type,
      weekly_hours, notes, expected_students, cohort_id, plan_course_component_id,
      delivery_group_id, assigned_component_hours, is_active
    ) VALUES (
      v_dg.college_id, v_offering_id, p_instructor_id,
      COALESCE(v_dg.group_code, v_dg.group_number::text), v_session_type,
      v_effective_hours, p_notes, COALESCE(v_dg.expected_students, 0),
      v_dg.cohort_id, v_dg.component_id, p_delivery_group_id,
      p_assigned_component_hours, true
    )
    RETURNING * INTO v_row;
    v_action := 'created';
    v_audit_action := 'teaching_assignment_created';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid, v_audit_action, 'teaching_assignments', v_row.id, v_dg.college_id,
    jsonb_build_object(
      'assignment_id', v_row.id,
      'delivery_group_id', p_delivery_group_id,
      'instructor_id', p_instructor_id,
      'component_type', v_pcc.component_type,
      'old_orphan_instructor_id', CASE WHEN v_orphan.id IS NOT NULL THEN v_orphan.instructor_id END,
      'new_assigned_hours', p_assigned_component_hours,
      'lifecycle_action', v_action,
      'old_assignment_id', v_orphan.id,
      'new_assignment_id', CASE WHEN v_orphan.id IS NOT NULL THEN v_row.id END,
      'draft_sessions_relinked', v_draft_after,
      'historical_sessions_preserved', v_hist_after
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', v_action,
    'assignment_id', v_row.id,
    'delivery_group_id', p_delivery_group_id,
    'instructor_id', p_instructor_id,
    'assigned_component_hours', v_row.assigned_component_hours,
    'is_active', v_row.is_active,
    'updated_at', v_row.updated_at,
    'allocation', public.compute_delivery_group_allocation(p_delivery_group_id)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION faculty_private.guard_assignment_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE h record; v_request uuid;
BEGIN
 IF NOT NEW.is_active THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.is_active AND NEW.instructor_id=OLD.instructor_id
  AND NEW.delivery_group_id IS NOT DISTINCT FROM OLD.delivery_group_id AND NEW.college_id=OLD.college_id
  AND NEW.assigned_component_hours IS NOT DISTINCT FROM OLD.assigned_component_hours
  AND NEW.weekly_hours IS NOT DISTINCT FROM OLD.weekly_hours THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(180600,1);
 SELECT hp.* INTO h FROM faculty_private.home_profiles hp JOIN faculty_identity_links l ON l.identity_id=hp.identity_id
 WHERE l.instructor_id=NEW.instructor_id;

 IF EXISTS (
   SELECT 1 FROM schedule_version_delivery_private.instructor_hour_waivers w
   JOIN public.schedule_versions draft ON draft.id=w.version_id
   JOIN public.teaching_assignments src ON src.id=w.source_assignment_id
   JOIN public.delivery_groups target ON target.id=w.group_id
   JOIN public.delivery_groups old_group ON old_group.id=src.delivery_group_id
   JOIN public.schedule_sessions published ON published.teaching_assignment_id=src.id
     AND published.delivery_group_id=src.delivery_group_id
   JOIN public.schedule_versions v2 ON v2.id=published.schedule_version_id
   WHERE w.assignment_id=NEW.id AND w.instructor_id=NEW.instructor_id
     AND w.group_id=NEW.delivery_group_id AND w.college_id=NEW.college_id
     AND draft.status='draft' AND draft.college_id=NEW.college_id
     AND draft.academic_term_id=w.term_id
     AND v2.id='00000000-0000-4000-8000-000000009000'::uuid
     AND v2.status='published' AND v2.college_id=NEW.college_id
     AND v2.academic_term_id=w.term_id
     AND src.is_active AND src.instructor_id=NEW.instructor_id
     AND src.college_id=NEW.college_id
     AND src.course_offering_id=NEW.course_offering_id
     AND src.cohort_id=NEW.cohort_id
     AND src.plan_course_component_id=NEW.plan_course_component_id
     AND src.session_type=NEW.session_type
     AND src.weekly_hours=NEW.weekly_hours
     AND src.assigned_component_hours IS NOT DISTINCT FROM NEW.assigned_component_hours
     AND src.required_room_type IS NOT DISTINCT FROM NEW.required_room_type
     AND target.cohort_id=old_group.cohort_id
     AND target.component_id=old_group.component_id
     AND target.plan_course_id=old_group.plan_course_id
     AND NOT EXISTS (
       SELECT 1 FROM public.teaching_assignments other
       WHERE other.delivery_group_id=NEW.delivery_group_id
         AND other.is_active AND other.id<>NEW.id AND NOT assignment_version_private.is_replacement_pair(NEW.id,other.id)
         AND (other.instructor_id=NEW.instructor_id OR EXISTS (
           SELECT 1 FROM public.faculty_identity_links a
           JOIN public.faculty_identity_links b ON b.identity_id=a.identity_id
           WHERE a.instructor_id=other.instructor_id AND b.instructor_id=NEW.instructor_id))
     )
 ) THEN RETURN NEW; END IF;
 IF h.home_college_id IS NULL THEN RAISE EXCEPTION 'FACULTY_HOME_REVIEW_REQUIRED'; END IF;
 IF NEW.delivery_group_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM teaching_assignments a JOIN faculty_identity_links l ON l.instructor_id=a.instructor_id
  WHERE a.delivery_group_id=NEW.delivery_group_id AND a.is_active AND a.id<>NEW.id AND l.identity_id=h.identity_id AND NOT assignment_version_private.is_replacement_pair(NEW.id,a.id)
    AND (NEW.scope_version_id IS NULL OR EXISTS (
      SELECT 1 FROM public.version_effective_assignments(NEW.scope_version_id) e
      WHERE e.assignment_id=a.id)))
 THEN RAISE EXCEPTION 'DUPLICATE_FACULTY_ASSIGNMENT'; END IF;
 IF h.home_college_id=NEW.college_id THEN RETURN NEW; END IF; IF TG_OP='UPDATE' AND NOT OLD.is_active AND NEW.instructor_id=OLD.instructor_id AND NEW.delivery_group_id IS NOT DISTINCT FROM OLD.delivery_group_id AND NEW.college_id=OLD.college_id AND NEW.assigned_component_hours IS NOT DISTINCT FROM OLD.assigned_component_hours AND NEW.weekly_hours IS NOT DISTINCT FROM OLD.weekly_hours AND EXISTS (SELECT 1 FROM public.schedule_sessions original JOIN public.schedule_versions original_version ON original_version.id=original.schedule_version_id JOIN public.delivery_groups g ON g.id=NEW.delivery_group_id JOIN public.academic_cohorts cohort ON cohort.id=g.cohort_id WHERE original.teaching_assignment_id=NEW.id AND original.delivery_group_id=NEW.delivery_group_id AND original.instructor_id=NEW.instructor_id AND original_version.status='published' AND original_version.academic_term_id=cohort.term_id AND original_version.college_id=NEW.college_id) THEN RETURN NEW; END IF;
 SELECT id INTO v_request FROM faculty_teaching_requests r WHERE r.identity_id=h.identity_id
 AND r.instructor_id=NEW.instructor_id AND r.home_college_id=h.home_college_id AND r.college_id=NEW.college_id
 AND r.delivery_group_id=NEW.delivery_group_id AND r.status='approved'
 AND r.assigned_hours=coalesce(NEW.assigned_component_hours,NEW.weekly_hours)
 AND (r.assignment_id IS NULL OR r.assignment_id=NEW.id)
 AND ((r.decided_by=auth.uid() AND r.decided_at=now()) OR (TG_OP='UPDATE' AND NOT OLD.is_active AND r.assignment_id=NEW.id AND r.decided_at IS NOT NULL AND EXISTS (SELECT 1 FROM public.schedule_sessions original JOIN public.schedule_versions original_version ON original_version.id=original.schedule_version_id WHERE original.teaching_assignment_id=NEW.id AND original.delivery_group_id=NEW.delivery_group_id AND original.instructor_id=NEW.instructor_id AND original_version.status='published' AND original_version.academic_term_id=r.term_id AND original_version.college_id=NEW.college_id))) ORDER BY r.created_at DESC LIMIT 1;
 IF v_request IS NULL THEN RAISE EXCEPTION 'اعتماد التكليف من الكلية الأصلية مطلوب قبل الإسناد'; END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION faculty_private.apply_update_assignment(p_assignment_id uuid, p_expected_updated_at timestamp with time zone, p_assigned_component_hours numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.teaching_assignments%ROWTYPE;
  v_dg public.delivery_groups%ROWTYPE;
  v_old_hours numeric;
  v_pcc_type text;
  v_pcc_hours numeric;
  v_effective numeric;
  v_dg_id uuid;
  v_college_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_assignment_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_ID_AND_EXPECTED_UPDATED_AT_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  -- Resolve context without locking assignment first (stable lock order)
  SELECT ta.delivery_group_id, ta.college_id
    INTO v_dg_id, v_college_id
  FROM public.teaching_assignments ta
  WHERE ta.id = p_assignment_id;
  IF v_college_id IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  -- Permission checked by the request/decision RPC; this core is not exposed.
  IF v_dg_id IS NULL THEN
    RAISE EXCEPTION 'LEGACY_ASSIGNMENT_NOT_SUPPORTED_BY_V2_RPC' USING ERRCODE = 'check_violation';
  END IF;

  v_dg := public.lock_delivery_group_for_assignment(v_dg_id);
  PERFORM public.assert_delivery_group_assignable(v_dg.is_obsolete, v_dg.active);

  SELECT * INTO v_row
  FROM public.teaching_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'STALE_ASSIGNMENT_UPDATE' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_row.is_active THEN
    RAISE EXCEPTION 'INACTIVE_ASSIGNMENT_UPDATE_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;

  IF p_assigned_component_hours IS NOT NULL AND p_assigned_component_hours <= 0 THEN
    RAISE EXCEPTION 'ASSIGNED_HOURS_MUST_BE_POSITIVE' USING ERRCODE = 'check_violation';
  END IF;

  v_old_hours := v_row.assigned_component_hours;
  SELECT pcc.component_type,
         pcc.weekly_contact_hours,
         COALESCE(p_assigned_component_hours, v_row.assigned_component_hours, pcc.weekly_contact_hours, 0)
    INTO v_pcc_type, v_pcc_hours, v_effective
  FROM public.plan_course_components pcc
  WHERE pcc.id = v_row.plan_course_component_id;

  PERFORM public.validate_assignment_allocation_locked(
    v_dg_id,
    p_assignment_id,
    COALESCE(p_assigned_component_hours, v_row.assigned_component_hours),
    v_pcc_hours,
    true
  );

  UPDATE public.teaching_assignments SET
    assigned_component_hours = COALESCE(p_assigned_component_hours, assigned_component_hours),
    weekly_hours = v_effective,
    notes = COALESCE(p_notes, notes)
  WHERE id = p_assignment_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    'teaching_assignment_hours_updated',
    'teaching_assignments',
    v_row.id,
    v_row.college_id,
    jsonb_build_object(
      'assignment_id', v_row.id,
      'delivery_group_id', v_row.delivery_group_id,
      'instructor_id', v_row.instructor_id,
      'component_type', v_pcc_type,
      'old_assigned_hours', v_old_hours,
      'new_assigned_hours', v_row.assigned_component_hours
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'updated',
    'assignment_id', v_row.id,
    'assigned_component_hours', v_row.assigned_component_hours,
    'updated_at', v_row.updated_at,
    'allocation', public.compute_delivery_group_allocation(v_row.delivery_group_id)
  );
END;
$function$
;

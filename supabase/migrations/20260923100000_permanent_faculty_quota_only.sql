-- Quotas apply only to confirmed permanent/appointed faculty.
-- Contracted teaching still requires valid allocation and normal cross-college approval.
BEGIN;
CREATE OR REPLACE FUNCTION faculty_private.quota_applicability(p_type text,p_employment text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE
  WHEN p_type IN ('permanent','appointed') AND p_employment='contract' THEN NULL
  WHEN p_type IN ('permanent','appointed') THEN true
  WHEN p_type IN ('con','annual_contract','contract_unspecified') THEN false
  WHEN p_employment='contract' THEN false
  ELSE NULL END
$$;
REVOKE ALL ON FUNCTION faculty_private.quota_applicability(text,text) FROM PUBLIC,anon,authenticated;
-- Preserve the installed view's home resolution and effective-quota arithmetic.
DO $patch$
DECLARE v text; needle text := 'WHEN r.home_college_id IS NOT NULL AND';
BEGIN
 v:=pg_get_viewdef('faculty_private.home_profiles'::regclass,true);
 IF position('quota_applicability(s.type_code, s.employment_type)' in v)>0 THEN RETURN; END IF;
 IF (length(v)-length(replace(v,needle,'')))/length(needle) <> 1 THEN
  RAISE EXCEPTION 'QUOTA_VIEW_PATCH_CONTEXT_CHANGED';
 END IF;
 EXECUTE 'CREATE OR REPLACE VIEW faculty_private.home_profiles AS ' || replace(v,needle,
  'WHEN faculty_private.quota_applicability(s.type_code,s.employment_type) IS TRUE AND r.home_college_id IS NOT NULL AND');
END $patch$;
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
CREATE OR REPLACE FUNCTION public.enforce_instructor_extra_hours_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_term uuid;v_load jsonb;v_quota numeric;
BEGIN
 IF NOT coalesce(NEW.is_active,false) THEN RETURN NEW; END IF;
 SELECT term_id INTO v_term FROM course_offerings WHERE id=NEW.course_offering_id;
 IF public.existing_schedule_intake_enabled(NEW.college_id,v_term) THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(180600,1);
 v_load:=faculty_private.workload(NEW.instructor_id,v_term);
 v_quota:=(v_load->>'required_load_hours')::numeric;
 IF (v_load->>'allocation_pending')::boolean THEN RAISE EXCEPTION 'FACULTY_ALLOCATION_REVIEW_REQUIRED' USING ERRCODE='23514'; END IF;
 IF (v_load->>'quota_applicable')::boolean IS FALSE THEN RETURN NEW; END IF;
 IF v_quota IS NULL THEN RAISE EXCEPTION 'INSTRUCTOR_QUOTA_REQUIRED: يجب اعتماد النصاب من الكلية الأصلية' USING ERRCODE='23514'; END IF;
 IF (v_load->>'standard_assigned_hours')::numeric>v_quota+12 THEN
  RAISE EXCEPTION 'INSTRUCTOR_EXTRA_HOURS_LIMIT_EXCEEDED: الساعات الزائدة لا يجوز أن تتجاوز 12 ساعة أسبوعيًا' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
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
-- Retain the installed report and all of its access/selection checks.
DO $patch$
DECLARE v text; needle text := '''quota_status'',CASE WHEN v_missing THEN ''missing''';
BEGIN
 v:=pg_get_functiondef('public.get_faculty_university_report(uuid,uuid,uuid[])'::regprocedure);
 IF position('quota_applicability(h.type_code,h.employment_type)' in v)>0 THEN RETURN; END IF;
 IF (length(v)-length(replace(v,needle,'')))/length(needle) <> 1 THEN
  RAISE EXCEPTION 'QUOTA_REPORT_PATCH_CONTEXT_CHANGED';
 END IF;
 EXECUTE replace(v,needle,'''quota_status'',CASE WHEN (SELECT faculty_private.quota_applicability(h.type_code,h.employment_type) FROM faculty_private.home_profiles h WHERE h.identity_id=v_identity) IS FALSE THEN ''not_applicable'' WHEN v_missing THEN ''missing''');
END $patch$;
COMMIT;

CREATE OR REPLACE FUNCTION public.compute_instructor_standard_workload(p_instructor_id uuid, p_term_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_instructor public.instructors%ROWTYPE;
  v_required numeric;
  v_rank_code text;
  v_standard numeric := 0;
  v_project numeric := 0;
  v_status text;
  v_deficit numeric := 0;
  v_overload numeric := 0;
BEGIN
  IF p_instructor_id IS NULL THEN
    RAISE EXCEPTION 'INSTRUCTOR_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_instructor FROM public.instructors WHERE id = p_instructor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    public.can_view_college(v_uid, v_instructor.college_id)
    OR public.can_manage_college(v_uid, v_instructor.college_id)
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT fwp.required_load_hours, fwp.rank_code
    INTO v_required, v_rank_code
  FROM public.faculty_workload_policies fwp
  WHERE fwp.college_id = v_instructor.college_id
    AND fwp.active = true
    AND (
      lower(fwp.rank_code) = lower(COALESCE(v_instructor.academic_rank, ''))
      OR EXISTS (
        SELECT 1
        FROM unnest(fwp.rank_aliases) alias
        WHERE lower(alias) = lower(COALESCE(v_instructor.academic_rank, ''))
      )
    )
  ORDER BY fwp.rank_code
  LIMIT 1;

  -- The instructor form is authoritative; rank policy is a fallback.
  -- Zero is a valid saved load, not a missing value.
  IF v_instructor.max_weekly_hours IS NOT NULL THEN
    v_required := GREATEST(0, v_instructor.max_weekly_hours
      - COALESCE(v_instructor.administrative_release_hours, 0));
  ELSIF v_required IS NOT NULL THEN
    v_required := GREATEST(0, v_required
      - COALESCE(v_instructor.administrative_release_hours, 0));
  END IF;

  SELECT
    COALESCE(SUM(w.standard_assigned_hours), 0),
    COALESCE(SUM(w.project_supervision_hours), 0)
  INTO v_standard, v_project
  FROM public.v_instructor_delivery_workload w
  WHERE w.instructor_id = p_instructor_id
    AND w.college_id = v_instructor.college_id
    AND (p_term_id IS NULL OR w.term_id = p_term_id);

  IF v_required IS NULL THEN
    v_status := 'policy_missing';
  ELSIF v_standard = 0 THEN
    v_status := 'unassigned';
  ELSIF v_standard > v_required THEN
    v_status := 'overload';
    v_overload := v_standard - v_required;
  ELSIF v_standard < v_required THEN
    v_status := 'deficit';
    v_deficit := v_required - v_standard;
  ELSE
    v_status := 'ok';
  END IF;

  RETURN jsonb_build_object(
    'instructor_id', p_instructor_id,
    'college_id', v_instructor.college_id,
    'term_id', p_term_id,
    'rank_code', v_rank_code,
    'academic_rank', v_instructor.academic_rank,
    'required_load_hours', v_required,
    'standard_assigned_hours', v_standard,
    'project_supervision_hours', v_project,
    'deficit_hours', v_deficit,
    'overload_hours', v_overload,
    'status', v_status
  );
END;
$function$

CREATE OR REPLACE FUNCTION public.enforce_instructor_extra_hours_limit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
 v_base numeric; v_release numeric; v_rank text; v_term uuid; v_total numeric; v_limit numeric;
BEGIN
 IF NOT COALESCE(NEW.is_active,false) THEN RETURN NEW; END IF;
 -- Serialize writers for one instructor before reading the aggregate.
 SELECT max_weekly_hours,administrative_release_hours,academic_rank
 INTO v_base,v_release,v_rank FROM public.instructors
 WHERE id=NEW.instructor_id AND college_id=NEW.college_id FOR UPDATE;
 IF v_base IS NULL THEN
  SELECT required_load_hours INTO v_base FROM public.faculty_workload_policies
  WHERE college_id=NEW.college_id AND active
   AND (lower(rank_code)=lower(COALESCE(v_rank,'')) OR EXISTS(
    SELECT 1 FROM unnest(rank_aliases) a WHERE lower(a)=lower(COALESCE(v_rank,''))))
  ORDER BY rank_code LIMIT 1;
 END IF;
 IF v_base IS NULL THEN
  RAISE EXCEPTION 'INSTRUCTOR_QUOTA_REQUIRED: يجب تحديد النصاب الأساسي للمحاضر قبل الإسناد' USING ERRCODE='23514';
 END IF;
 v_limit:=GREATEST(0,v_base-COALESCE(v_release,0))+12;
 SELECT term_id INTO v_term FROM public.course_offerings WHERE id=NEW.course_offering_id;
 SELECT COALESCE(SUM(CASE
   WHEN p.component_type='summer_training' OR COALESCE(d.excluded_from_standard_workload,false)
     OR p.counts_toward_regular_load=false THEN 0
   WHEN t.delivery_group_id IS NULL THEN COALESCE(t.assigned_component_hours,t.weekly_hours,0)
   WHEN (SELECT count(*) FROM public.teaching_assignments peer
         WHERE peer.delivery_group_id=t.delivery_group_id AND peer.is_active)>1
     THEN COALESCE(t.assigned_component_hours,0)
   ELSE COALESCE(t.assigned_component_hours,p.weekly_contact_hours,0)
 END),0) INTO v_total
 FROM public.teaching_assignments t
 JOIN public.course_offerings o ON o.id=t.course_offering_id
 LEFT JOIN public.delivery_groups d ON d.id=t.delivery_group_id
 LEFT JOIN public.plan_course_components p ON p.id=COALESCE(t.plan_course_component_id,d.component_id)
 WHERE t.instructor_id=NEW.instructor_id AND t.college_id=NEW.college_id
 AND t.is_active AND o.term_id=v_term;
 IF v_total>v_limit THEN
  RAISE EXCEPTION 'INSTRUCTOR_EXTRA_HOURS_LIMIT_EXCEEDED: الساعات الزائدة لا يجوز أن تتجاوز 12 ساعة أسبوعيًا'
    USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS enforce_instructor_extra_hours_limit ON public.teaching_assignments;
CREATE TRIGGER enforce_instructor_extra_hours_limit
AFTER INSERT OR UPDATE OF instructor_id,course_offering_id,delivery_group_id,plan_course_component_id,assigned_component_hours,weekly_hours,is_active
ON public.teaching_assignments FOR EACH ROW EXECUTE FUNCTION public.enforce_instructor_extra_hours_limit();

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

  IF NOT public.can_view_college(v_uid, v_instructor.college_id)
     OR NOT public.can_view_college(v_uid, v_dg.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF v_instructor.college_id <> v_dg.college_id THEN
    v_conflicts := v_conflicts || jsonb_build_array('ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN');
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

  v_current := public.compute_instructor_standard_workload(p_instructor_id, v_term_id);
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
$function$

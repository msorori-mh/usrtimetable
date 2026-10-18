-- Emergency behavior rollback. Retains decision/request/audit records. Review before use.
BEGIN;
SET LOCAL lock_timeout='3s';
DROP TRIGGER IF EXISTS zz_faculty_home_guard ON public.instructors;
DROP TRIGGER IF EXISTS zz_faculty_assignment_request ON public.teaching_assignments;
CREATE OR REPLACE FUNCTION public.create_teaching_assignment_v2(p_delivery_group_id uuid, p_instructor_id uuid, p_assigned_component_hours numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text)
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
  v_row public.teaching_assignments%ROWTYPE;
  v_action text;
  v_audit_action text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_group_id IS NULL OR p_instructor_id IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_AND_INSTRUCTOR_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  -- Lock order: delivery_group → active assignment rows
  v_dg := public.lock_delivery_group_for_assignment(p_delivery_group_id);

  IF NOT public.can_manage_college(v_uid, v_dg.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  PERFORM public.assert_delivery_group_assignable(v_dg.is_obsolete, v_dg.active);

  SELECT * INTO v_instructor FROM public.instructors WHERE id = p_instructor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  -- CROSS-COLLEGE-01: assigning an instructor from another college is allowed;
  -- the assignment row stays in the delivery group's college and the instructor profile is never modified.

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ASSIGNMENT_COMPONENT_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pcc.component_type = 'summer_training' THEN
    RAISE EXCEPTION 'SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;

  IF p_assigned_component_hours IS NOT NULL AND p_assigned_component_hours <= 0 THEN
    RAISE EXCEPTION 'ASSIGNED_HOURS_MUST_BE_POSITIVE' USING ERRCODE = 'check_violation';
  END IF;

  -- Reactivate inactive natural key if present (target row lock)
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
    CASE WHEN v_existing.id IS NOT NULL AND NOT v_existing.is_active THEN v_existing.id ELSE NULL END,
    p_assigned_component_hours,
    v_pcc.weekly_contact_hours,
    true
  );

  IF v_existing.id IS NOT NULL AND NOT v_existing.is_active THEN
    UPDATE public.teaching_assignments SET
      is_active = TRUE,
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
      college_id,
      course_offering_id,
      instructor_id,
      section_number,
      session_type,
      weekly_hours,
      notes,
      expected_students,
      cohort_id,
      plan_course_component_id,
      delivery_group_id,
      assigned_component_hours,
      is_active
    ) VALUES (
      v_dg.college_id,
      v_offering_id,
      p_instructor_id,
      COALESCE(v_dg.group_code, v_dg.group_number::text),
      v_session_type,
      v_effective_hours,
      p_notes,
      COALESCE(v_dg.expected_students, 0),
      v_dg.cohort_id,
      v_dg.component_id,
      p_delivery_group_id,
      p_assigned_component_hours,
      TRUE
    )
    RETURNING * INTO v_row;
    v_action := 'created';
    v_audit_action := 'teaching_assignment_created';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    v_audit_action,
    'teaching_assignments',
    v_row.id,
    v_dg.college_id,
    jsonb_build_object(
      'assignment_id', v_row.id,
      'delivery_group_id', p_delivery_group_id,
      'instructor_id', p_instructor_id,
      'component_type', v_pcc.component_type,
      'old_assigned_hours', NULL,
      'new_assigned_hours', p_assigned_component_hours,
      'lifecycle_action', v_action
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
CREATE OR REPLACE FUNCTION public.update_teaching_assignment_v2(p_assignment_id uuid, p_expected_updated_at timestamp with time zone, p_assigned_component_hours numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text)
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
  IF NOT public.can_manage_college(v_uid, v_college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
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
      i.college_id AS home_college_id,
      c.name AS college_name,
      (i.college_id = v_dg.college_id) AS is_home_college,
      CASE WHEN i.college_id = v_dg.college_id THEN i.employee_number ELSE NULL END AS employee_number,
      EXISTS (
        SELECT 1 FROM public.teaching_assignments ta
        WHERE ta.delivery_group_id = p_delivery_group_id
          AND ta.instructor_id = i.id
          AND ta.is_active = TRUE
      ) AS already_assigned
    FROM public.instructors i
    JOIN public.colleges c ON c.id = i.college_id
    WHERE i.is_active = TRUE
  ) x;

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
      'college_id', c.id,
      'college_name', c.name,
      'is_home_college', (c.id = v_dg.college_id)
    )), '[]'::jsonb)
  INTO v_colleges
  FROM public.colleges c
  WHERE EXISTS (SELECT 1 FROM public.instructors i WHERE i.college_id = c.id AND i.is_active = TRUE);

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
$function$
;
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
  v_by_college jsonb := '[]'::jsonb;
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

  -- CROSS-COLLEGE-INSTRUCTOR-01: an instructor is registered once in the home
  -- college but may teach delivery groups of other colleges. The applied weekly
  -- load must therefore aggregate every college's hours, not only the home one.
  SELECT
    COALESCE(SUM(w.standard_assigned_hours), 0),
    COALESCE(SUM(w.project_supervision_hours), 0)
  INTO v_standard, v_project
  FROM public.v_instructor_delivery_workload w
  WHERE w.instructor_id = p_instructor_id
    AND (p_term_id IS NULL OR w.term_id = p_term_id);

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'college_id'), '[]'::jsonb)
  INTO v_by_college
  FROM (
    SELECT jsonb_build_object(
             'college_id', w.college_id,
             'is_home_college', (w.college_id = v_instructor.college_id),
             'standard_assigned_hours', COALESCE(SUM(w.standard_assigned_hours), 0),
             'project_supervision_hours', COALESCE(SUM(w.project_supervision_hours), 0)
           ) AS x
    FROM public.v_instructor_delivery_workload w
    WHERE w.instructor_id = p_instructor_id
      AND (p_term_id IS NULL OR w.term_id = p_term_id)
    GROUP BY w.college_id
  ) s;

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
    'hours_by_college', v_by_college,
    'deficit_hours', v_deficit,
    'overload_hours', v_overload,
    'status', v_status
  );
END;
$function$
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
  IF v_instructor.college_id <> v_dg.college_id THEN
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
;
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
END $function$
;
CREATE OR REPLACE FUNCTION public.leadership_overview(p_academic_year text DEFAULT NULL::text, p_term_type text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_year text := p_academic_year;
  v_type text := p_term_type;
  v_periods jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_workspace jsonb;
  v_colleges jsonb;
  v_result jsonb;
  v_college record;
BEGIN
  IF v_actor IS NULL OR NOT (
    public.is_super_admin(v_actor)
    OR public.has_role(v_actor, 'university_leadership'::public.app_role)
  ) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;

  -- An explicit year in the term name may fill missing metadata for reporting
  -- only. It is flagged, never written back, and ambiguous matches are withheld.
  WITH terms AS (
    SELECT t.*,
      coalesce(nullif(btrim(t.academic_year), ''), substring(t.name from '[0-9]{4}-[0-9]{4}')) AS year_key
    FROM public.academic_terms t
    JOIN public.colleges cl ON cl.id=t.college_id
    WHERE NOT (
      upper(btrim(coalesce(cl.code,''))) LIKE 'TEST%'
      OR cl.name ILIKE '%اختبار تبسيط الجداول%'
    )
  )
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'year' DESC, x->>'type'), '[]'::jsonb)
  INTO v_periods FROM (
    SELECT DISTINCT jsonb_build_object('year',year_key,'type',term_type) AS x
    FROM terms WHERE year_key IS NOT NULL AND term_type IS NOT NULL
  ) q;

  IF v_year IS NULL AND v_type IS NULL THEN
    SELECT coalesce(nullif(btrim(t.academic_year), ''), substring(t.name from '[0-9]{4}-[0-9]{4}')), t.term_type
    INTO v_year,v_type
    FROM public.academic_terms t
    JOIN public.colleges cl ON cl.id=t.college_id
    WHERE coalesce(nullif(btrim(t.academic_year), ''), substring(t.name from '[0-9]{4}-[0-9]{4}')) IS NOT NULL
      AND t.term_type IS NOT NULL
      AND NOT (
        upper(btrim(coalesce(cl.code,''))) LIKE 'TEST%'
        OR cl.name ILIKE '%اختبار تبسيط الجداول%'
      )
    ORDER BY (t.start_date <= current_date) DESC NULLS LAST,t.start_date DESC NULLS LAST,t.id LIMIT 1;
  ELSIF v_year IS NULL OR v_type IS NULL THEN
    RAISE EXCEPTION 'ACADEMIC_PERIOD_REQUIRED';
  END IF;
  IF v_year IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_periods) p WHERE p->>'year'=v_year AND p->>'type'=v_type
  ) THEN RAISE EXCEPTION 'ACADEMIC_PERIOD_NOT_FOUND'; END IF;

  WITH matches AS (
    SELECT t.*,count(*) OVER (PARTITION BY t.college_id) AS matches
    FROM public.academic_terms t
    JOIN public.colleges source_college ON source_college.id=t.college_id
    WHERE coalesce(nullif(btrim(t.academic_year), ''), substring(t.name from '[0-9]{4}-[0-9]{4}'))=v_year
      AND t.term_type=v_type
      AND NOT (
        upper(btrim(coalesce(source_college.code,''))) LIKE 'TEST%'
        OR source_college.name ILIKE '%اختبار تبسيط الجداول%'
      )
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id',cl.id,'name',cl.name,
    'term_id',m.id,'term_name',m.name,
    'term_state',CASE WHEN m.id IS NOT NULL THEN 'ready'
      WHEN EXISTS(SELECT 1 FROM matches a WHERE a.college_id=cl.id) THEN 'ambiguous' ELSE 'missing' END,
    'year_inferred',m.academic_year IS NULL OR btrim(m.academic_year)=''
  ) ORDER BY cl.name) INTO v_colleges
  FROM public.colleges cl
  LEFT JOIN matches m ON m.college_id=cl.id AND m.matches=1
  WHERE NOT (
    upper(btrim(coalesce(cl.code,''))) LIKE 'TEST%'
    OR cl.name ILIKE '%اختبار تبسيط الجداول%'
  );

  FOR v_college IN SELECT * FROM jsonb_to_recordset(coalesce(v_colleges,'[]')) AS x(id uuid,term_id uuid) LOOP
    IF v_college.term_id IS NOT NULL THEN
      v_workspace := public.list_teaching_assignment_workspace(p_college_id=>v_college.id,p_term_id=>v_college.term_id);
      IF coalesce((v_workspace->>'ok')::boolean,false)=false THEN RAISE EXCEPTION 'WORKSPACE_UNAVAILABLE'; END IF;
      v_groups := v_groups || coalesce(v_workspace->'rows','[]');
    END IF;
  END LOOP;

  WITH colleges AS (
    SELECT * FROM jsonb_to_recordset(coalesce(v_colleges,'[]')) AS x(
      id uuid,name text,term_id uuid,term_name text,term_state text,year_inferred boolean)
  ), groups AS MATERIALIZED (
    SELECT g.*, p.counts_toward_regular_load,
      EXISTS(SELECT 1 FROM jsonb_array_elements(g.instructors) a
        WHERE coalesce((a->>'is_active')::boolean,true) AND a->>'assigned_component_hours' IS NULL)
        AND jsonb_array_length(g.instructors)>1 AS pending
    FROM jsonb_to_recordset(v_groups) AS g(
      delivery_group_id uuid,college_id uuid,component_type text,component_hours numeric,
      assigned_hours_total numeric,remaining_hours numeric,active boolean,is_obsolete boolean,
      excluded_from_standard_workload boolean,plan_course_component_id uuid,instructors jsonb)
    JOIN public.plan_course_components p ON p.id=g.plan_course_component_id
    WHERE g.active AND NOT g.is_obsolete
  ), coverage AS (
    SELECT college_id,count(*) AS groups_count,
      count(*) FILTER(WHERE remaining_hours=0 AND NOT pending) AS covered_groups,
      sum(component_hours) AS required_hours,
      sum(least(component_hours,assigned_hours_total)) FILTER(WHERE NOT pending) AS covered_hours,
      sum(assigned_hours_total) AS assigned_hours,
      sum(remaining_hours) FILTER(WHERE NOT pending) AS uncovered_hours,
      count(*) FILTER(WHERE pending) AS pending_groups,
      sum(component_hours) FILTER(WHERE pending) AS pending_group_hours,
      count(*) FILTER(WHERE assigned_hours_total>component_hours) AS overallocated_groups
    FROM groups GROUP BY college_id
  ), directory_members AS MATERIALIZED (
    SELECT i.id,i.college_id,coalesce(l.identity_id,i.id) AS identity_id,
      coalesce(f.issuing_college_id,i.college_id) AS home_id,
      coalesce(nullif(btrim(i.academic_rank),''),'غير محدد') AS academic_rank,
      coalesce(nullif(btrim(i.employment_type),''),'unknown') AS employment_type,
      i.is_active,
      nullif(btrim(CASE
        WHEN position('الحالة الوظيفية: ' in coalesce(i.notes,''))>0
          THEN split_part(split_part(i.notes,'الحالة الوظيفية: ',2),E'\n',1)
        WHEN position('الحالة في الكشف: ' in coalesce(i.notes,''))>0
          THEN split_part(
            split_part(split_part(i.notes,'الحالة في الكشف: ',2),E'\n',1),
            '—',
            1
          )
        ELSE ''
      END),'') AS status_reason,
      i.updated_at
    FROM public.instructors i
    LEFT JOIN public.faculty_identity_links l ON l.instructor_id=i.id
    LEFT JOIN public.faculty_identities f ON f.id=l.identity_id
  ), directory_profiles AS MATERIALIZED (
    SELECT id,college_id,identity_id,home_id,academic_rank,employment_type,is_active,status_reason
    FROM (
      SELECT dm.*,
        row_number() OVER (
          PARTITION BY dm.identity_id,dm.home_id
          ORDER BY (dm.college_id=dm.home_id) DESC,dm.updated_at DESC,dm.id
        ) AS rn
      FROM directory_members dm
    ) ranked
    WHERE rn=1
  ), directory_totals AS (
    SELECT home_id,count(*)::int AS faculty_directory_count
    FROM directory_profiles GROUP BY home_id
  ), rank_totals AS (
    SELECT home_id,jsonb_object_agg(academic_rank,cnt ORDER BY academic_rank) AS rank_counts
    FROM (
      SELECT home_id,academic_rank,count(*)::int AS cnt
      FROM directory_profiles
      GROUP BY home_id,academic_rank
    ) q
    GROUP BY home_id
  ), availability_totals AS (
    SELECT home_id,jsonb_object_agg(status_label,cnt ORDER BY status_label) AS availability_counts
    FROM (
      SELECT home_id,status_label,count(*)::int AS cnt
      FROM (
        SELECT home_id,
          CASE
            WHEN status_reason IS NOT NULL THEN status_reason
            WHEN is_active THEN 'متاح'
            ELSE 'غير متاح'
          END AS status_label
        FROM directory_profiles
      ) labelled
      GROUP BY home_id,status_label
    ) q
    GROUP BY home_id
  ), employment_totals AS (
    SELECT home_id,jsonb_object_agg(employment_type,cnt ORDER BY employment_type) AS employment_counts
    FROM (
      SELECT home_id,employment_type,count(*)::int AS cnt
      FROM directory_profiles
      GROUP BY home_id,employment_type
    ) q
    GROUP BY home_id
  ), members AS MATERIALIZED (
    SELECT i.id,i.college_id,coalesce(l.identity_id,i.id) AS identity_id,
      coalesce(f.issuing_college_id,i.college_id) AS home_id,
      greatest(0,coalesce(i.max_weekly_hours,policy.required_load_hours)-coalesce(i.administrative_release_hours,0)) AS quota,
      (i.max_weekly_hours IS NULL AND policy.required_load_hours IS NULL) AS missing_quota
    FROM public.instructors i
    LEFT JOIN public.faculty_identity_links l ON l.instructor_id=i.id
    LEFT JOIN public.faculty_identities f ON f.id=l.identity_id
    LEFT JOIN LATERAL (
      SELECT required_load_hours FROM public.faculty_workload_policies p
      WHERE p.college_id=i.college_id AND p.active AND (
        lower(p.rank_code)=lower(coalesce(i.academic_rank,'')) OR EXISTS(
          SELECT 1 FROM unnest(p.rank_aliases) a WHERE lower(a)=lower(coalesce(i.academic_rank,''))))
      ORDER BY p.rank_code LIMIT 1
    ) policy ON true WHERE i.is_active
  ), staff_load AS (
    SELECT coalesce(l.identity_id,(a->>'instructor_id')::uuid) AS identity_id,
      sum(CASE WHEN g.excluded_from_standard_workload OR NOT coalesce(g.counts_toward_regular_load,true)
        OR g.component_type='summer_training' THEN 0
        ELSE coalesce((a->>'assigned_component_hours')::numeric,
          CASE WHEN jsonb_array_length(g.instructors)=1 THEN g.component_hours ELSE 0 END) END) AS hours,
      bool_or(g.pending AND a->>'assigned_component_hours' IS NULL) AS pending
    FROM groups g CROSS JOIN LATERAL jsonb_array_elements(g.instructors) a
    LEFT JOIN public.faculty_identity_links l ON l.instructor_id=(a->>'instructor_id')::uuid
    WHERE coalesce((a->>'is_active')::boolean,true) GROUP BY 1
  ), unique_staff AS (
    SELECT m.identity_id,m.home_id,
      max(m.quota) AS quota,
      bool_or(m.missing_quota) OR count(DISTINCT m.quota)>1 AS uncertain
    FROM members m GROUP BY m.identity_id,m.home_id
  ), staff AS (
    SELECT s.home_id,count(*) AS faculty_count,
      count(*) FILTER(WHERE s.uncertain OR coalesce(w.pending,false)) AS incomplete_faculty,
      sum(s.quota) FILTER(WHERE NOT s.uncertain AND NOT coalesce(w.pending,false)) AS net_quota,
      sum(coalesce(w.hours,0)) FILTER(WHERE NOT s.uncertain AND NOT coalesce(w.pending,false)) AS faculty_assigned_hours,
      sum(greatest(0,coalesce(w.hours,0)-s.quota)) FILTER(WHERE NOT s.uncertain AND NOT coalesce(w.pending,false)) AS overload,
      sum(greatest(0,s.quota-coalesce(w.hours,0))) FILTER(WHERE NOT s.uncertain AND NOT coalesce(w.pending,false)) AS deficit
    FROM unique_staff s LEFT JOIN staff_load w ON w.identity_id=s.identity_id GROUP BY s.home_id
  ), versions AS (
    SELECT DISTINCT ON (v.college_id) v.id,v.college_id,v.name,v.updated_at
    FROM public.schedule_versions v JOIN colleges c ON c.id=v.college_id AND c.term_id=v.academic_term_id
    WHERE v.status='published' AND NOT v.disposable_test
    ORDER BY v.college_id,v.created_at DESC,v.id
  ), sessions AS (
    SELECT s.*,coalesce(p.component_type,s.session_type) AS component,
      extract(epoch FROM (s.end_time-s.start_time))/3600 AS hours
    FROM public.schedule_sessions s JOIN versions v ON v.id=s.schedule_version_id
    LEFT JOIN public.plan_course_components p ON p.id=s.plan_course_component_id
    WHERE NOT s.replaced_by_split AND s.college_id=v.college_id
  ), teaching AS (
    SELECT college_id,count(*) AS sessions_count,sum(hours) AS teaching_hours,
      sum(hours) FILTER(WHERE component='theory') AS theory_hours,
      sum(hours) FILTER(WHERE component IN ('practical','lab','clinical','field_training')) AS practical_hours,
      sum(hours) FILTER(WHERE component NOT IN ('theory','practical','lab','clinical','field_training') OR component IS NULL) AS other_hours
    FROM sessions GROUP BY college_id
  ), resources AS (
    SELECT r.college_id,count(*) AS room_count,
      count(*) FILTER(WHERE coalesce(rt.code,r.room_type)='lecture_hall') AS halls,
      count(*) FILTER(WHERE coalesce(rt.code,r.room_type) IN ('computer_lab','lab','laboratory')) AS labs,
      sum(r.capacity) AS seats
    FROM public.rooms r LEFT JOIN public.room_types rt ON rt.id=r.room_type_id
    WHERE r.is_active GROUP BY r.college_id
  ), counts AS (
    SELECT c.id,
      (SELECT count(*) FROM public.departments d WHERE d.college_id=c.id) AS departments,
      (SELECT count(*) FROM public.academic_programs p WHERE p.college_id=c.id) AS programs
    FROM colleges c
  )
  SELECT jsonb_agg(jsonb_build_object(
    'college_id',c.id,'college',c.name,'term_id',c.term_id,'term',c.term_name,'term_state',c.term_state,'year_inferred',c.year_inferred,
    'departments',ct.departments,'programs',ct.programs,
    'faculty_directory_count',coalesce(dt.faculty_directory_count,0),
    'rank_counts',coalesce(ranks.rank_counts,'{}'::jsonb),
    'availability_counts',coalesce(avail.availability_counts,'{}'::jsonb),
    'employment_counts',coalesce(emp.employment_counts,'{}'::jsonb),
    'faculty_count',coalesce(st.faculty_count,0),'incomplete_faculty',CASE WHEN c.term_id IS NOT NULL THEN coalesce(st.incomplete_faculty,0) END,
    'net_quota',CASE WHEN c.term_id IS NOT NULL THEN coalesce(st.net_quota,0) END,
    'faculty_assigned_hours',CASE WHEN c.term_id IS NOT NULL THEN coalesce(st.faculty_assigned_hours,0) END,
    'overload',CASE WHEN c.term_id IS NOT NULL THEN coalesce(st.overload,0) END,
    'deficit',CASE WHEN c.term_id IS NOT NULL THEN coalesce(st.deficit,0) END,
    'groups_count',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.groups_count,0) END,
    'covered_groups',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.covered_groups,0) END,
    'required_hours',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.required_hours,0) END,
    'covered_hours',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.covered_hours,0) END,
    'assigned_hours',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.assigned_hours,0) END,
    'uncovered_hours',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.uncovered_hours,0) END,
    'pending_groups',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.pending_groups,0) END,
    'pending_group_hours',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.pending_group_hours,0) END,
    'overallocated_groups',CASE WHEN c.term_id IS NOT NULL THEN coalesce(cv.overallocated_groups,0) END,
    'version_id',v.id,'version',v.name,'version_updated_at',v.updated_at,
    'sessions_count',CASE WHEN v.id IS NOT NULL THEN coalesce(t.sessions_count,0) END,
    'teaching_hours',CASE WHEN v.id IS NOT NULL THEN coalesce(t.teaching_hours,0) END,
    'theory_hours',CASE WHEN v.id IS NOT NULL THEN coalesce(t.theory_hours,0) END,
    'practical_hours',CASE WHEN v.id IS NOT NULL THEN coalesce(t.practical_hours,0) END,
    'other_hours',CASE WHEN v.id IS NOT NULL THEN coalesce(t.other_hours,0) END,
    'room_count',coalesce(r.room_count,0),'halls',coalesce(r.halls,0),'labs',coalesce(r.labs,0),'seats',coalesce(r.seats,0),
    'used_rooms',CASE WHEN v.id IS NOT NULL THEN (SELECT count(*) FROM public.rooms room
      WHERE room.college_id=c.id AND room.is_active AND EXISTS(SELECT 1 FROM sessions ss WHERE ss.room_id=room.id)) END
  ) ORDER BY c.name) INTO v_result
  FROM colleges c LEFT JOIN coverage cv ON cv.college_id=c.id
  LEFT JOIN directory_totals dt ON dt.home_id=c.id
  LEFT JOIN rank_totals ranks ON ranks.home_id=c.id
  LEFT JOIN availability_totals avail ON avail.home_id=c.id
  LEFT JOIN employment_totals emp ON emp.home_id=c.id
  LEFT JOIN staff st ON st.home_id=c.id LEFT JOIN versions v ON v.college_id=c.id
  LEFT JOIN teaching t ON t.college_id=c.id LEFT JOIN resources r ON r.college_id=c.id
  JOIN counts ct ON ct.id=c.id;

  RETURN jsonb_build_object('year',v_year,'term_type',v_type,'periods',v_periods,
    'generated_at',now(),'colleges',coalesce(v_result,'[]'));
END;
$function$
;
CREATE OR REPLACE FUNCTION schedule_coordination_private.busy(p_version uuid)
 RETURNS TABLE(instructor_id uuid, day_of_week integer, start_time time without time zone, end_time time without time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT DISTINCT s.instructor_id,s.day_of_week::integer,s.start_time,s.end_time
 FROM public.schedule_versions target
 JOIN public.academic_terms tt ON tt.id=target.academic_term_id
 JOIN public.schedule_versions other ON other.college_id<>target.college_id
   AND (other.status='published' OR (other.is_coordination AND other.status IN ('draft','review','approved')))
 JOIN public.academic_terms ot ON ot.id=other.academic_term_id
 JOIN public.schedule_sessions s ON s.schedule_version_id=other.id
 WHERE target.id=p_version AND NOT coalesce(s.replaced_by_split,false)
   AND tt.start_date<=ot.end_date AND ot.start_date<=tt.end_date
   -- A weekly slot only conflicts when that weekday occurs in the intersection.
   AND greatest(tt.start_date,ot.start_date)
     + ((s.day_of_week-extract(dow FROM greatest(tt.start_date,ot.start_date))::integer+7)%7)
     <=least(tt.end_date,ot.end_date)
$function$
;
CREATE OR REPLACE FUNCTION schedule_coordination_private.check_version(p_version uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.schedule_versions%ROWTYPE;
BEGIN
 SELECT * INTO v FROM public.schedule_versions WHERE id=p_version;
 IF NOT FOUND OR v.status='archived' THEN RETURN; END IF;
 IF (v.is_coordination OR v.status='published' OR EXISTS(
   SELECT 1 FROM public.schedule_sessions WHERE schedule_version_id=v.id AND NOT coalesce(replaced_by_split,false)))
 AND EXISTS(SELECT 1 FROM public.academic_terms t WHERE t.id=v.academic_term_id
   AND (t.start_date IS NULL OR t.end_date IS NULL OR t.end_date<t.start_date)) THEN
   RAISE EXCEPTION 'COORDINATION_TERM_DATES_REQUIRED' USING ERRCODE='23514';
 END IF;
 -- Incomplete dates of an external reference must never silently hide a conflict.
 IF EXISTS(SELECT 1 FROM public.schedule_versions o JOIN public.academic_terms t ON t.id=o.academic_term_id
   WHERE o.college_id<>v.college_id AND (o.status='published' OR (o.is_coordination AND o.status IN ('draft','review','approved')))
   AND (t.start_date IS NULL OR t.end_date IS NULL OR t.end_date<t.start_date)
   AND EXISTS(SELECT 1 FROM public.schedule_sessions s JOIN public.schedule_sessions own
     ON own.instructor_id=s.instructor_id WHERE s.schedule_version_id=o.id AND own.schedule_version_id=v.id
     AND NOT coalesce(s.replaced_by_split,false) AND NOT coalesce(own.replaced_by_split,false))) THEN
   RAISE EXCEPTION 'COORDINATION_TERM_DATES_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_sessions s
   JOIN schedule_coordination_private.busy(v.id) b ON b.instructor_id=s.instructor_id
     AND b.day_of_week=s.day_of_week AND b.start_time<s.end_time AND s.start_time<b.end_time
   WHERE s.schedule_version_id=v.id AND NOT coalesce(s.replaced_by_split,false)) THEN
   RAISE EXCEPTION 'CROSS_COLLEGE_INSTRUCTOR_CONFLICT' USING ERRCODE='23514';
 END IF;
END $function$
;
CREATE OR REPLACE FUNCTION public.enforce_instructor_extra_hours_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
 v_base numeric; v_release numeric; v_rank text; v_term uuid; v_total numeric; v_limit numeric;
BEGIN
 IF NOT COALESCE(NEW.is_active,false) THEN RETURN NEW; END IF;
 SELECT term_id INTO v_term FROM public.course_offerings WHERE id=NEW.course_offering_id;
 IF public.existing_schedule_intake_enabled(NEW.college_id, v_term) THEN RETURN NEW; END IF;
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
$function$
;
CREATE OR REPLACE FUNCTION public.update_faculty_employment_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_kind text; v_identity uuid; v_old text; v_new text; v_serial bigint;
BEGIN
  IF NEW.instructor_type_id IS NOT DISTINCT FROM OLD.instructor_type_id THEN RETURN NEW; END IF;
  SELECT CASE lower(code) WHEN 'permanent' THEN 'P' WHEN 'annual_contract' THEN 'C'
    WHEN 'con' THEN 'H' END INTO v_kind FROM public.instructor_types WHERE id=NEW.instructor_type_id;
  -- Unresolved/legacy categories never imply permanent employment.
  IF v_kind IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(180600,1);
  SELECT l.identity_id,f.university_number INTO v_identity,v_old
    FROM public.faculty_identity_links l JOIN public.faculty_identities f ON f.id=l.identity_id
    WHERE l.instructor_id=NEW.id FOR UPDATE OF f;
  IF v_identity IS NULL THEN RETURN NEW; END IF;
  -- A secondary college must not change the university-wide employment classification.
  IF NEW.college_id<>NEW.affiliation_college_id AND EXISTS (
    SELECT 1 FROM public.faculty_identity_links l JOIN public.instructors i ON i.id=l.instructor_id
    WHERE l.identity_id=v_identity AND i.id<>NEW.id
  ) THEN
    RAISE EXCEPTION 'غيّر الفئة الوظيفية من سجل الكلية الأصلية';
  END IF;
  IF split_part(v_old,'-',2)=v_kind THEN RETURN NEW; END IF;
  v_serial:=nextval('public.faculty_number_seq');
  v_new:=split_part(v_old,'-',1)||'-'||v_kind||'-'||lpad(v_serial::text,greatest(6,length(v_serial::text)),'0');
  INSERT INTO public.faculty_number_history(university_number,identity_id,replaced_by)
    VALUES(v_old,v_identity,auth.uid());
  UPDATE public.faculty_identities SET university_number=v_new WHERE id=v_identity;
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
    VALUES(auth.uid(),'faculty_employment_number_changed','instructors',NEW.id,NEW.college_id,
      jsonb_build_object('identity_id',v_identity,'previous_number',v_old,'university_number',v_new));
  RETURN NEW;
END $function$
;
REVOKE EXECUTE ON FUNCTION public.reconcile_faculty_home(uuid,uuid,uuid,boolean,text,timestamptz), public.decide_faculty_teaching_request(uuid,text,text) FROM PUBLIC,anon,authenticated;
COMMIT;

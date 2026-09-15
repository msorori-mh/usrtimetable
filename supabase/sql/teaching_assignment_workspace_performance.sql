CREATE OR REPLACE FUNCTION public.list_teaching_assignment_workspace(p_college_id uuid, p_program_id uuid DEFAULT NULL::uuid, p_level_id uuid DEFAULT NULL::uuid, p_term_id uuid DEFAULT NULL::uuid, p_study_system text DEFAULT NULL::text, p_cohort_id uuid DEFAULT NULL::uuid, p_component_type text DEFAULT NULL::text, p_assignment_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_college_id IS NULL THEN
    RAISE EXCEPTION 'COLLEGE_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.can_view_college(v_uid, p_college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- summer_training excluded (not weekly assignable)
  WITH group_records AS MATERIALIZED (
    SELECT public.operational_delivery_group(g.id) AS item
    FROM public.delivery_groups g WHERE g.college_id = p_college_id
  ), workspace_groups AS MATERIALIZED (
    SELECT (item).* FROM group_records
  )
  SELECT COALESCE(jsonb_agg(x.row_obj ORDER BY x.course_code, x.component_type, x.group_number), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      c.code AS course_code,
      pcc.component_type,
      dg.group_number,
      jsonb_build_object(
        'delivery_group_id', dg.id,
        'college_id', dg.college_id,
        'cohort_id', dg.cohort_id,
        'cohort_code', CASE WHEN EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=dg.id) THEN ac.code || ' + موازي' ELSE ac.code END,
        'program_id', ac.program_id,
        'level_id', ac.level_id,
        'term_id', ac.term_id,
        'study_system', ac.study_system,
        'plan_course_id', dg.plan_course_id,
        'plan_course_component_id', dg.component_id,
        'component_type', pcc.component_type,
        'course_id', c.id,
        'course_code', c.code,
        'course_name', c.name,
        'group_number', dg.group_number,
        'group_code', dg.group_code,
        'expected_students', dg.expected_students,
        'capacity_limit', dg.capacity_limit,
        'is_obsolete', COALESCE(dg.is_obsolete, false),
        'active', COALESCE(dg.active, true),
        'excluded_from_standard_workload', COALESCE(dg.excluded_from_standard_workload, false),
        'component_hours', pcc.weekly_contact_hours,
        'assigned_hours_total', alloc.assigned_hours_total,
        'remaining_hours', alloc.remaining_hours,
        'assignment_count', alloc.assignment_count,
        'is_co_taught', alloc.is_co_taught,
        'allocation_status', alloc.allocation_status,
        'instructors', COALESCE(instr.instructors, '[]'::jsonb),
        'conflicts', COALESCE(conf.conflicts, '[]'::jsonb)
      ) AS row_obj
    FROM workspace_groups dg
    JOIN public.academic_cohorts ac ON ac.id = dg.cohort_id AND ac.college_id = dg.college_id
    JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
    JOIN public.plan_courses pc ON pc.id = dg.plan_course_id
    JOIN public.courses c ON c.id = pc.course_id
    -- Compute allocation directly once per group; the enclosing RPC checks college access.
    CROSS JOIN LATERAL (
      SELECT COUNT(*)::integer AS assignment_count,
        CASE WHEN COUNT(*) = 1
          THEN COALESCE(MAX(ta.assigned_component_hours), pcc.weekly_contact_hours, 0)
          ELSE COALESCE(SUM(ta.assigned_component_hours), 0)
        END AS assigned_hours_total
      FROM public.teaching_assignments ta
      WHERE ta.delivery_group_id = dg.id AND ta.is_active = TRUE
    ) totals
    CROSS JOIN LATERAL (
      SELECT totals.assignment_count, totals.assigned_hours_total,
        GREATEST(0, COALESCE(pcc.weekly_contact_hours, 0) - totals.assigned_hours_total) AS remaining_hours,
        totals.assignment_count > 1 AS is_co_taught,
        CASE WHEN totals.assignment_count = 0 THEN 'unassigned'
          WHEN totals.assigned_hours_total > COALESCE(pcc.weekly_contact_hours, 0) THEN 'over_allocated'
          WHEN totals.assigned_hours_total < COALESCE(pcc.weekly_contact_hours, 0) THEN 'under_allocated'
          ELSE 'fully_allocated'
        END AS allocation_status
    ) alloc
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'assignment_id', ta.id,
          'instructor_id', ta.instructor_id,
          'instructor_name', i.full_name,
          'employee_number', i.employee_number,
          'assigned_component_hours', ta.assigned_component_hours,
          'is_active', ta.is_active,
          'updated_at', ta.updated_at
        )
        ORDER BY i.full_name
      ) AS instructors
      FROM public.teaching_assignments ta
      JOIN public.instructors i ON i.id = ta.instructor_id
      WHERE ta.delivery_group_id = dg.id
        AND ta.is_active = TRUE
    ) instr ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(c_code) AS conflicts
      FROM (
        SELECT 'OBSOLETE_DELIVERY_GROUP' AS c_code
        WHERE COALESCE(dg.is_obsolete, false)
        UNION ALL
        SELECT 'INACTIVE_DELIVERY_GROUP' AS c_code
        WHERE COALESCE(dg.active, true) = false
        UNION ALL
        SELECT 'UNDER_ALLOCATED'
        WHERE alloc.allocation_status = 'under_allocated' AND alloc.assignment_count > 0
        UNION ALL
        SELECT 'OVER_ALLOCATED'
        WHERE alloc.allocation_status = 'over_allocated'
        UNION ALL
        SELECT 'UNASSIGNED'
        WHERE alloc.allocation_status = 'unassigned'
      ) z
    ) conf ON TRUE
    WHERE dg.college_id = p_college_id
      AND pcc.component_type IS DISTINCT FROM 'summer_training'
      AND public.shared_lecture_matches(dg.id,p_cohort_id,p_study_system)
      AND (p_program_id IS NULL OR ac.program_id = p_program_id)
      AND (p_level_id IS NULL OR ac.level_id = p_level_id)
      AND (p_term_id IS NULL OR ac.term_id = p_term_id)
      AND NOT EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE member_group_id=dg.id)
      AND (p_component_type IS NULL OR pcc.component_type = p_component_type)
      AND (
        p_assignment_status IS NULL
        OR p_assignment_status = 'all'
        OR (p_assignment_status = 'assigned' AND alloc.assignment_count > 0)
        OR (p_assignment_status = 'unassigned' AND alloc.assignment_count = 0)
        OR (p_assignment_status = 'under_allocated' AND alloc.allocation_status = 'under_allocated')
        OR (p_assignment_status = 'fully_allocated' AND alloc.allocation_status = 'fully_allocated')
        OR (p_assignment_status = 'obsolete' AND COALESCE(dg.is_obsolete, false))
        OR (p_assignment_status = 'inactive' AND COALESCE(dg.active, true) = false)
      )
  ) x;

  RETURN jsonb_build_object(
    'ok', true,
    'college_id', p_college_id,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'can_manage', public.can_manage_college(v_uid, p_college_id)
  );
END;
$function$

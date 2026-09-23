-- Keep the teaching-assignment workspace contract byte-for-byte compatible while
-- replacing per-group allocation RPCs with one set-based assignment rollup.
-- This keeps leadership_overview below the authenticated PostgREST timeout as
-- colleges and delivery groups grow.
CREATE OR REPLACE FUNCTION public.list_teaching_assignment_workspace(
  p_college_id uuid,
  p_program_id uuid DEFAULT NULL,
  p_level_id uuid DEFAULT NULL,
  p_term_id uuid DEFAULT NULL,
  p_study_system text DEFAULT NULL,
  p_cohort_id uuid DEFAULT NULL,
  p_component_type text DEFAULT NULL,
  p_assignment_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
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

  WITH base AS MATERIALIZED (
    SELECT
      dg.id AS delivery_group_id,
      dg.college_id,
      dg.cohort_id,
      ac.code AS base_cohort_code,
      ac.program_id,
      ac.level_id,
      ac.term_id,
      ac.study_system,
      dg.plan_course_id,
      dg.component_id AS plan_course_component_id,
      pcc.component_type,
      pcc.weekly_contact_hours AS component_hours,
      pc.course_id,
      c.code AS course_code,
      c.name AS course_name,
      dg.group_number,
      dg.group_code,
      dg.expected_students,
      dg.capacity_limit,
      COALESCE(dg.is_obsolete, false) AS is_obsolete,
      COALESCE(dg.active, true) AS active,
      COALESCE(dg.excluded_from_standard_workload, false) AS excluded_from_standard_workload,
      EXISTS (
        SELECT 1 FROM public.shared_lecture_links sl
        WHERE sl.anchor_group_id = dg.id
      ) AS has_shared_members
    FROM public.delivery_groups dg
    JOIN public.academic_cohorts ac
      ON ac.id = dg.cohort_id AND ac.college_id = dg.college_id
    JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
    JOIN public.plan_courses pc ON pc.id = dg.plan_course_id
    JOIN public.courses c ON c.id = pc.course_id
    WHERE dg.college_id = p_college_id
      AND pcc.component_type IS DISTINCT FROM 'summer_training'
      AND (
        p_program_id IS NULL OR EXISTS (
          SELECT 1
          FROM public.shared_lecture_group_ids(dg.id) ids
          JOIN public.delivery_groups shared_group ON shared_group.id = ids.group_id
          JOIN public.academic_cohorts shared_cohort ON shared_cohort.id = shared_group.cohort_id
          WHERE shared_cohort.program_id = p_program_id
        )
      )
      AND (
        p_level_id IS NULL OR EXISTS (
          SELECT 1
          FROM public.shared_lecture_group_ids(dg.id) ids
          JOIN public.delivery_groups shared_group ON shared_group.id = ids.group_id
          JOIN public.academic_cohorts shared_cohort ON shared_cohort.id = shared_group.cohort_id
          WHERE shared_cohort.level_id = p_level_id
        )
      )
      AND (p_term_id IS NULL OR ac.term_id = p_term_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.shared_lecture_links sl
        WHERE sl.member_group_id = dg.id
      )
      AND (p_component_type IS NULL OR pcc.component_type = p_component_type)
      AND (
        (p_cohort_id IS NULL AND p_study_system IS NULL)
        OR public.shared_lecture_matches(dg.id, p_cohort_id, p_study_system)
      )
  ), assignment_rollup AS MATERIALIZED (
    SELECT
      ta.delivery_group_id,
      count(*)::integer AS assignment_count,
      sum(COALESCE(ta.assigned_component_hours, 0)) AS raw_assigned_hours,
      max(ta.assigned_component_hours) AS single_assigned_hours,
      jsonb_agg(
        jsonb_build_object(
          'assignment_id', ta.id,
          'instructor_id', ta.instructor_id,
          'instructor_name', i.full_name,
          'employee_number', i.employee_number,
          'assigned_component_hours', ta.assigned_component_hours,
          'is_active', ta.is_active,
          'updated_at', ta.updated_at
        ) ORDER BY i.full_name
      ) AS instructors
    FROM public.teaching_assignments ta
    JOIN base b ON b.delivery_group_id = ta.delivery_group_id
    JOIN public.instructors i ON i.id = ta.instructor_id
    WHERE ta.is_active = true
    GROUP BY ta.delivery_group_id
  ), calculated AS MATERIALIZED (
    SELECT
      b.*,
      COALESCE(a.assignment_count, 0) AS assignment_count,
      CASE
        WHEN COALESCE(a.assignment_count, 0) = 1
          THEN COALESCE(a.single_assigned_hours, b.component_hours, 0)
        ELSE COALESCE(a.raw_assigned_hours, 0)
      END AS assigned_hours_total,
      COALESCE(a.instructors, '[]'::jsonb) AS instructors
    FROM base b
    LEFT JOIN assignment_rollup a ON a.delivery_group_id = b.delivery_group_id
  ), finalized AS MATERIALIZED (
    SELECT
      x.*,
      GREATEST(0, COALESCE(x.component_hours, 0) - COALESCE(x.assigned_hours_total, 0)) AS remaining_hours,
      CASE
        WHEN x.assignment_count = 0 THEN 'unassigned'
        WHEN COALESCE(x.assigned_hours_total, 0) > COALESCE(x.component_hours, 0) THEN 'over_allocated'
        WHEN COALESCE(x.assigned_hours_total, 0) < COALESCE(x.component_hours, 0) THEN 'under_allocated'
        ELSE 'fully_allocated'
      END AS allocation_status
    FROM calculated x
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'delivery_group_id', f.delivery_group_id,
        'college_id', f.college_id,
        'cohort_id', f.cohort_id,
        'cohort_code', (
          SELECT string_agg(shared_cohort.code, ' + ' ORDER BY shared_cohort.code)
          FROM public.shared_lecture_group_ids(f.delivery_group_id) ids
          JOIN public.delivery_groups shared_group ON shared_group.id = ids.group_id
          JOIN public.academic_cohorts shared_cohort ON shared_cohort.id = shared_group.cohort_id
        ),
        'program_id', f.program_id,
        'level_id', f.level_id,
        'term_id', f.term_id,
        'study_system', f.study_system,
        'plan_course_id', f.plan_course_id,
        'plan_course_component_id', f.plan_course_component_id,
        'component_type', f.component_type,
        'course_id', f.course_id,
        'course_code', f.course_code,
        'course_name', f.course_name,
        'group_number', f.group_number,
        'group_code', CASE
          WHEN f.has_shared_members THEN f.group_code || ' — مدمج ضمن النظام نفسه'
          ELSE f.group_code
        END,
        'expected_students', CASE
          WHEN f.has_shared_members THEN (
            SELECT sum(d.expected_students)::integer
            FROM public.delivery_groups d
            JOIN public.shared_lecture_group_ids(f.delivery_group_id) m ON m.group_id = d.id
          )
          ELSE f.expected_students
        END,
        'capacity_limit', f.capacity_limit,
        'is_obsolete', f.is_obsolete,
        'active', f.active,
        'excluded_from_standard_workload', f.excluded_from_standard_workload,
        'component_hours', f.component_hours,
        'assigned_hours_total', f.assigned_hours_total,
        'remaining_hours', f.remaining_hours,
        'assignment_count', f.assignment_count,
        'is_co_taught', f.assignment_count > 1,
        'allocation_status', f.allocation_status,
        'instructors', f.instructors,
        'conflicts', to_jsonb(array_remove(ARRAY[
          CASE WHEN f.is_obsolete THEN 'OBSOLETE_DELIVERY_GROUP' END,
          CASE WHEN NOT f.active THEN 'INACTIVE_DELIVERY_GROUP' END,
          CASE WHEN f.allocation_status = 'under_allocated' AND f.assignment_count > 0 THEN 'UNDER_ALLOCATED' END,
          CASE WHEN f.allocation_status = 'over_allocated' THEN 'OVER_ALLOCATED' END,
          CASE WHEN f.allocation_status = 'unassigned' THEN 'UNASSIGNED' END
        ], NULL))
      ) ORDER BY f.course_code, f.component_type, f.group_number
    ),
    '[]'::jsonb
  ) INTO v_rows
  FROM finalized f
  WHERE p_assignment_status IS NULL
    OR p_assignment_status = 'all'
    OR (p_assignment_status = 'assigned' AND f.assignment_count > 0)
    OR (p_assignment_status = 'unassigned' AND f.assignment_count = 0)
    OR (p_assignment_status = 'under_allocated' AND f.allocation_status = 'under_allocated')
    OR (p_assignment_status = 'fully_allocated' AND f.allocation_status = 'fully_allocated')
    OR (p_assignment_status = 'obsolete' AND f.is_obsolete)
    OR (p_assignment_status = 'inactive' AND NOT f.active);

  RETURN jsonb_build_object(
    'ok', true,
    'college_id', p_college_id,
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'can_manage', public.can_manage_college(v_uid, p_college_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.list_teaching_assignment_workspace(
  uuid, uuid, uuid, uuid, text, uuid, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_teaching_assignment_workspace(
  uuid, uuid, uuid, uuid, text, uuid, text, text
) TO authenticated;

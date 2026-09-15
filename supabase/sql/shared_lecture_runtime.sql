-- Runtime integration for shared lectures. Apply after shared_lectures.sql.

BEGIN;

SET LOCAL lock_timeout='5s';

CREATE OR REPLACE FUNCTION public.ensure_ta_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  oc uuid;
  ic uuid;
  dg_college uuid;
  dg_cohort uuid;
  dg_component uuid;
  dg_plan_course uuid;
  dg_obsolete boolean;
  dg_active boolean;
  co_plan_course uuid;
  co_term uuid;
  co_program uuid;
  co_level uuid;
  co_study_system text;
  co_college uuid;
  pcc_type text;
  pcc_plan_course uuid;
  pcc_hours numeric;
  pcc_college uuid;
  v_co_count integer;
  v_null_split_count integer;
  v_sum_assigned numeric;
  v_cohort_term uuid;
  v_cohort_program uuid;
  v_cohort_level uuid;
  v_cohort_study text;
  v_cohort_college uuid;
BEGIN
  SELECT college_id, plan_course_id, term_id, program_id, level_id, study_system
    INTO oc, co_plan_course, co_term, co_program, co_level, co_study_system
  FROM public.course_offerings WHERE id = NEW.course_offering_id;
  co_college := oc;

  SELECT college_id INTO ic FROM public.instructors WHERE id = NEW.instructor_id;
  IF oc IS NULL OR ic IS NULL OR oc <> NEW.college_id OR ic <> NEW.college_id THEN
    RAISE EXCEPTION 'offering/instructor/college mismatch' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.is_active IS NULL THEN
    NEW.is_active := TRUE;
  END IF;

  -- Session-linked: do not silently change instructor or delivery_group
  IF TG_OP = 'UPDATE'
     AND (
       OLD.instructor_id IS DISTINCT FROM NEW.instructor_id
       OR OLD.delivery_group_id IS DISTINCT FROM NEW.delivery_group_id
     )
     AND EXISTS (
       SELECT 1 FROM public.schedule_sessions ss
       WHERE ss.teaching_assignment_id = NEW.id
     ) THEN
    RAISE EXCEPTION 'ASSIGNMENT_LINKED_TO_SESSION_MUTATION_FORBIDDEN'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.delivery_group_id IS NOT NULL THEN
    SELECT dg.college_id, dg.cohort_id, dg.component_id, dg.plan_course_id, dg.is_obsolete, dg.active
      INTO dg_college, dg_cohort, dg_component, dg_plan_course, dg_obsolete, dg_active
    FROM public.operational_delivery_groups dg
    WHERE dg.id = NEW.delivery_group_id;

    IF dg_college IS NULL THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF dg_college <> NEW.college_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    -- Obsolete / inactive groups reject active assignments only (deactivate remains allowed)
    IF COALESCE(dg_obsolete, false) AND COALESCE(NEW.is_active, true) THEN
      RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(dg_active, true) = false AND COALESCE(NEW.is_active, true) THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.cohort_id IS NOT NULL AND NEW.cohort_id IS DISTINCT FROM dg_cohort THEN
      RAISE EXCEPTION 'ASSIGNMENT_COHORT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.plan_course_component_id IS NOT NULL
       AND NEW.plan_course_component_id IS DISTINCT FROM dg_component THEN
      RAISE EXCEPTION 'ASSIGNMENT_COMPONENT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.cohort_id IS NULL THEN
      NEW.cohort_id := dg_cohort;
    END IF;
    IF NEW.plan_course_component_id IS NULL THEN
      NEW.plan_course_component_id := dg_component;
    END IF;

    IF co_plan_course IS NULL OR co_plan_course IS DISTINCT FROM dg_plan_course THEN
      RAISE EXCEPTION 'OFFERING_PLAN_COURSE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;

    SELECT ac.college_id, ac.term_id, ac.program_id, ac.level_id, ac.study_system
      INTO v_cohort_college, v_cohort_term, v_cohort_program, v_cohort_level, v_cohort_study
    FROM public.academic_cohorts ac
    WHERE ac.id = dg_cohort;

    IF v_cohort_college IS NULL OR v_cohort_college <> NEW.college_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_COHORT_COLLEGE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF co_college <> v_cohort_college
       OR co_term IS DISTINCT FROM v_cohort_term
       OR COALESCE(co_program, v_cohort_program) IS DISTINCT FROM v_cohort_program
       OR COALESCE(co_level, v_cohort_level) IS DISTINCT FROM v_cohort_level
       OR co_study_system IS DISTINCT FROM v_cohort_study THEN
      RAISE EXCEPTION 'OFFERING_COHORT_CONTEXT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.plan_course_component_id IS NOT NULL THEN
    SELECT pcc.component_type, pcc.plan_course_id, pcc.weekly_contact_hours, pcc.college_id
      INTO pcc_type, pcc_plan_course, pcc_hours, pcc_college
    FROM public.plan_course_components pcc
    WHERE pcc.id = NEW.plan_course_component_id
      AND pcc.college_id = NEW.college_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ASSIGNMENT_COMPONENT_COLLEGE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF pcc_type = 'summer_training' THEN
      RAISE EXCEPTION 'SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.delivery_group_id IS NOT NULL AND COALESCE(NEW.is_active, true) THEN
      IF pcc_plan_course IS DISTINCT FROM dg_plan_course THEN
        RAISE EXCEPTION 'COMPONENT_PLAN_COURSE_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;

      IF NEW.assigned_component_hours IS NOT NULL AND NEW.assigned_component_hours <= 0 THEN
        RAISE EXCEPTION 'ASSIGNED_HOURS_MUST_BE_POSITIVE' USING ERRCODE = 'check_violation';
      END IF;

      IF NEW.assigned_component_hours IS NOT NULL
         AND pcc_hours IS NOT NULL
         AND NEW.assigned_component_hours > pcc_hours THEN
        RAISE EXCEPTION 'CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
      END IF;

      SELECT COUNT(*)::integer,
             COUNT(*) FILTER (WHERE ta.assigned_component_hours IS NULL
                               AND ta.id IS DISTINCT FROM NEW.id)::integer
               + CASE WHEN NEW.assigned_component_hours IS NULL THEN 1 ELSE 0 END,
             COALESCE(SUM(ta.assigned_component_hours) FILTER (WHERE ta.id IS DISTINCT FROM NEW.id), 0)
               + COALESCE(NEW.assigned_component_hours, 0)
        INTO v_co_count, v_null_split_count, v_sum_assigned
      FROM public.teaching_assignments ta
      WHERE ta.delivery_group_id = NEW.delivery_group_id
        AND ta.is_active = TRUE;

      IF TG_OP = 'INSERT' THEN
        v_co_count := v_co_count + 1;
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.delivery_group_id IS DISTINCT FROM NEW.delivery_group_id
           OR COALESCE(OLD.is_active, true) IS DISTINCT FROM TRUE THEN
          v_co_count := v_co_count + 1;
        END IF;
      END IF;

      IF v_co_count > 1 AND v_null_split_count > 0 THEN
        RAISE EXCEPTION 'CO_TEACHING_HOURS_SPLIT_REQUIRED' USING ERRCODE = 'check_violation';
      END IF;

      IF pcc_hours IS NOT NULL AND v_sum_assigned > pcc_hours THEN
        RAISE EXCEPTION 'CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.cohort_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.academic_cohorts ac
      WHERE ac.id = NEW.cohort_id AND ac.college_id = NEW.college_id
    ) THEN
      RAISE EXCEPTION 'ASSIGNMENT_COHORT_COLLEGE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.is_active AND EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=NEW.delivery_group_id) THEN
    NEW.expected_students := (public.operational_delivery_group(NEW.delivery_group_id)).expected_students;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_ss_college()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  vc uuid;
  oc uuid;
  ic uuid;
  rc uuid;
  sc uuid;
  gc uuid;
  tac uuid;
  ta_active boolean;
  ta_dg uuid;
  ta_instructor uuid;
  ta_offering uuid;
  ta_component uuid;
  ta_cohort uuid;
  dg_college uuid;
  dg_obsolete boolean;
  dg_active boolean;
  dg_cohort uuid;
  dg_component uuid;
  pcc_type text;
  pcc_regular boolean;
  v_ta_link_changing boolean;
  v_dg_link_changing boolean;
BEGIN
  SELECT college_id INTO vc FROM public.schedule_versions WHERE id = NEW.schedule_version_id;
  IF vc IS NULL OR vc <> NEW.college_id THEN RAISE EXCEPTION 'version/college mismatch'; END IF;

  SELECT college_id INTO oc FROM public.course_offerings WHERE id = NEW.course_offering_id;
  IF oc IS NULL OR oc <> NEW.college_id THEN RAISE EXCEPTION 'offering/college mismatch'; END IF;

  SELECT college_id INTO ic FROM public.instructors WHERE id = NEW.instructor_id;
  IF ic IS NULL OR ic <> NEW.college_id THEN RAISE EXCEPTION 'instructor/college mismatch'; END IF;

  IF NEW.room_id IS NOT NULL THEN
    SELECT college_id INTO rc FROM public.rooms WHERE id = NEW.room_id;
    IF rc IS NULL OR rc <> NEW.college_id THEN RAISE EXCEPTION 'room/college mismatch'; END IF;
  END IF;

  IF NEW.section_id IS NOT NULL THEN
    SELECT college_id INTO sc FROM public.sections WHERE id = NEW.section_id;
    IF sc IS NULL OR sc <> NEW.college_id THEN RAISE EXCEPTION 'section/college mismatch'; END IF;
  END IF;

  IF NEW.section_group_id IS NOT NULL THEN
    SELECT college_id INTO gc FROM public.section_groups WHERE id = NEW.section_group_id;
    IF gc IS NULL OR gc <> NEW.college_id THEN RAISE EXCEPTION 'section_group/college mismatch'; END IF;
  END IF;

  v_ta_link_changing := (
    TG_OP = 'INSERT'
    OR OLD.teaching_assignment_id IS DISTINCT FROM NEW.teaching_assignment_id
  );
  v_dg_link_changing := (
    TG_OP = 'INSERT'
    OR OLD.delivery_group_id IS DISTINCT FROM NEW.delivery_group_id
  );

  IF NEW.teaching_assignment_id IS NOT NULL THEN
    SELECT ta.college_id, ta.is_active, ta.delivery_group_id,
           ta.instructor_id, ta.course_offering_id, ta.plan_course_component_id, ta.cohort_id
      INTO tac, ta_active, ta_dg, ta_instructor, ta_offering, ta_component, ta_cohort
    FROM public.teaching_assignments ta
    WHERE ta.id = NEW.teaching_assignment_id;
    IF tac IS NULL OR tac <> NEW.college_id THEN
      RAISE EXCEPTION 'teaching_assignment/college mismatch';
    END IF;
    IF v_ta_link_changing AND COALESCE(ta_active, true) = false THEN
      RAISE EXCEPTION 'INACTIVE_ASSIGNMENT_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_instructor IS DISTINCT FROM NEW.instructor_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_INSTRUCTOR_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_offering IS DISTINCT FROM NEW.course_offering_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_OFFERING_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_dg IS NOT NULL THEN
      SELECT dg.college_id, dg.is_obsolete, dg.active, dg.cohort_id, dg.component_id
        INTO dg_college, dg_obsolete, dg_active, dg_cohort, dg_component
      FROM public.operational_delivery_groups dg
      WHERE dg.id = ta_dg;
      IF dg_college IS NULL THEN
        RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
      END IF;
      IF dg_college <> NEW.college_id THEN
        RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF COALESCE(dg_obsolete, false) THEN
        RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF COALESCE(dg_active, true) = false THEN
        RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      SELECT pcc.component_type, COALESCE(pcc.counts_toward_regular_load, true)
        INTO pcc_type, pcc_regular
      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;
      IF pcc_type = 'summer_training' THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF pcc_type = 'project' AND COALESCE(pcc_regular, true) = false THEN
        RAISE EXCEPTION 'PROJECT_STANDARD_WEEKLY_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.delivery_group_id IS NOT NULL AND NEW.delivery_group_id IS DISTINCT FROM ta_dg THEN
        RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_ASSIGNMENT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.cohort_id IS NOT NULL AND NEW.cohort_id IS DISTINCT FROM dg_cohort THEN
        RAISE EXCEPTION 'SESSION_COHORT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.plan_course_component_id IS NOT NULL
         AND NEW.plan_course_component_id IS DISTINCT FROM dg_component THEN
        RAISE EXCEPTION 'SESSION_COMPONENT_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.delivery_group_id IS NOT NULL THEN
    SELECT dg.college_id, dg.is_obsolete, dg.active, dg.cohort_id, dg.component_id
      INTO dg_college, dg_obsolete, dg_active, dg_cohort, dg_component
    FROM public.operational_delivery_groups dg
    WHERE dg.id = NEW.delivery_group_id;
    IF dg_college IS NULL THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF dg_college <> NEW.college_id THEN
      RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing AND COALESCE(dg_obsolete, false) THEN
      RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing AND COALESCE(dg_active, true) = false THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_dg_link_changing THEN
      SELECT pcc.component_type, COALESCE(pcc.counts_toward_regular_load, true)
        INTO pcc_type, pcc_regular
      FROM public.plan_course_components pcc WHERE pcc.id = dg_component;
      IF pcc_type = 'summer_training' THEN
        RAISE EXCEPTION 'SUMMER_TRAINING_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
      IF pcc_type = 'project' AND COALESCE(pcc_regular, true) = false THEN
        RAISE EXCEPTION 'PROJECT_STANDARD_WEEKLY_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=NEW.delivery_group_id) THEN
    NEW.study_system := 'both';
    NEW.expected_students := (public.operational_delivery_group(NEW.delivery_group_id)).expected_students;
  END IF;
  RETURN NEW;
END;
$function$;

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
    FROM public.operational_delivery_groups dg
    JOIN public.academic_cohorts ac ON ac.id = dg.cohort_id AND ac.college_id = dg.college_id
    JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
    JOIN public.plan_courses pc ON pc.id = dg.plan_course_id
    JOIN public.courses c ON c.id = pc.course_id
    -- ASSERT: allocation_json is jsonb scalar; never apply ->> to a record alias
    CROSS JOIN LATERAL (
      SELECT public.compute_delivery_group_allocation(dg.id) AS allocation_json
    ) alloc_src
    CROSS JOIN LATERAL (
      SELECT
        COALESCE((alloc_src.allocation_json->>'assigned_hours_total')::numeric, 0) AS assigned_hours_total,
        COALESCE((alloc_src.allocation_json->>'remaining_hours')::numeric, 0) AS remaining_hours,
        COALESCE((alloc_src.allocation_json->>'assignment_count')::integer, 0) AS assignment_count,
        COALESCE((alloc_src.allocation_json->>'is_co_taught')::boolean, false) AS is_co_taught,
        COALESCE(alloc_src.allocation_json->>'allocation_status', 'unassigned') AS allocation_status
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
$function$;

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

  SELECT pcc.weekly_contact_hours, pcc.component_type
    INTO v_hours, v_type
  FROM public.plan_course_components pcc
  WHERE pcc.id = v_dg.component_id;

  SELECT COALESCE(SUM(ta.assigned_component_hours), 0), COUNT(*)::integer
    INTO v_sum, v_count
  FROM public.teaching_assignments ta
  WHERE ta.delivery_group_id = p_delivery_group_id
    AND ta.is_active = TRUE;

  -- Sole instructor without explicit hours still "uses" component hours once for display
  IF v_count = 1 THEN
    SELECT COALESCE(ta.assigned_component_hours, v_hours, 0)
      INTO v_sum
    FROM public.teaching_assignments ta
    WHERE ta.delivery_group_id = p_delivery_group_id
      AND ta.is_active = TRUE
    LIMIT 1;
  END IF;

  v_remaining := GREATEST(0, COALESCE(v_hours, 0) - COALESCE(v_sum, 0));
  IF v_count = 0 THEN
    v_status := 'unassigned';
  ELSIF COALESCE(v_sum, 0) > COALESCE(v_hours, 0) THEN
    v_status := 'over_allocated';
  ELSIF COALESCE(v_sum, 0) < COALESCE(v_hours, 0) THEN
    v_status := 'under_allocated';
  ELSE
    v_status := 'fully_allocated';
  END IF;

  RETURN jsonb_build_object(
    'delivery_group_id', p_delivery_group_id,
    'component_type', v_type,
    'component_hours', v_hours,
    'assigned_hours_total', v_sum,
    'remaining_hours', v_remaining,
    'assignment_count', v_count,
    'is_co_taught', v_count > 1,
    'allocation_status', v_status
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_teaching_assignments_v2_import(p_rows jsonb, p_mode text DEFAULT 'upsert'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_mode text := lower(COALESCE(NULLIF(btrim(p_mode), ''), 'upsert'));
  v_batch_id uuid := gen_random_uuid();
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_rows_received integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_reactivated integer := 0;
  v_unchanged integer := 0;
  v_elem jsonb;
  v_row_number integer;
  v_dg_id uuid;
  v_instructor_id uuid;
  v_hours numeric;
  v_notes text;
  v_is_active boolean;
  v_offering_id uuid;
  v_expected_students integer;
  v_required_room_type text;
  v_session_type text;
  v_natural_key text;
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_instructor public.instructors%ROWTYPE;
  v_existing public.teaching_assignments%ROWTYPE;
  v_row public.teaching_assignments%ROWTYPE;
  v_effective numeric;
  v_college_ids uuid[];
  v_dg_ids uuid[];
  v_id uuid;
  v_idx integer;
  v_same_hours boolean;
  v_same_notes boolean;
  v_batch_instructors integer;
  v_null_hours integer;
  v_comp_hours numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'IMPORT_ROWS_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;
  IF v_mode NOT IN ('insert_only', 'update_existing', 'upsert') THEN
    RAISE EXCEPTION 'IMPORT_MODE_INVALID' USING ERRCODE = 'check_violation';
  END IF;

  v_rows_received := jsonb_array_length(p_rows);

  -- -------- Phase 1: pre-validate all rows (no DML) --------
  FOR v_idx IN 0 .. GREATEST(v_rows_received - 1, -1) LOOP
    v_elem := p_rows -> v_idx;
    v_row_number := COALESCE((v_elem->>'row_number')::integer, v_idx + 1);
    BEGIN
      v_dg_id := NULLIF(v_elem->>'delivery_group_id', '')::uuid;
      v_instructor_id := NULLIF(v_elem->>'instructor_id', '')::uuid;
    EXCEPTION WHEN others THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number,
        'natural_key', NULL,
        'error_code', 'INVALID_UUID',
        'error_message', 'delivery_group_id/instructor_id invalid uuid',
        'blocking', true
      ));
      CONTINUE;
    END;

    v_natural_key := COALESCE(v_dg_id::text, '') || '|' || COALESCE(v_instructor_id::text, '');
    IF v_dg_id IS NULL OR v_instructor_id IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number,
        'natural_key', v_natural_key,
        'error_code', 'DELIVERY_GROUP_AND_INSTRUCTOR_REQUIRED',
        'error_message', 'delivery_group_id and instructor_id required',
        'blocking', true
      ));
      CONTINUE;
    END IF;

    SELECT * INTO v_dg FROM public.operational_delivery_groups WHERE id = v_dg_id;
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'DELIVERY_GROUP_NOT_FOUND',
        'error_message', 'delivery group not found', 'blocking', true
      ));
      CONTINUE;
    END IF;
    IF NOT public.can_manage_college(v_uid, v_dg.college_id) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'insufficient_privilege',
        'error_message', 'cannot manage college for delivery group', 'blocking', true
      ));
      CONTINUE;
    END IF;
    IF COALESCE(v_dg.is_obsolete, false) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN',
        'error_message', 'obsolete delivery group', 'blocking', true
      ));
      CONTINUE;
    END IF;
    IF COALESCE(v_dg.active, true) = false THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN',
        'error_message', 'inactive delivery group', 'blocking', true
      ));
      CONTINUE;
    END IF;

    SELECT * INTO v_instructor FROM public.instructors WHERE id = v_instructor_id;
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'INSTRUCTOR_NOT_FOUND',
        'error_message', 'instructor not found', 'blocking', true
      ));
      CONTINUE;
    END IF;
    IF v_instructor.college_id <> v_dg.college_id THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN',
        'error_message', 'cross-college assignment', 'blocking', true
      ));
      CONTINUE;
    END IF;

    SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'ASSIGNMENT_COMPONENT_MISMATCH',
        'error_message', 'component missing', 'blocking', true
      ));
      CONTINUE;
    END IF;
    IF v_pcc.component_type = 'summer_training' THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN',
        'error_message', 'summer training forbidden', 'blocking', true
      ));
      CONTINUE;
    END IF;

    IF v_elem ? 'assigned_component_hours'
       AND v_elem->>'assigned_component_hours' IS NOT NULL
       AND btrim(v_elem->>'assigned_component_hours') <> '' THEN
      v_hours := (v_elem->>'assigned_component_hours')::numeric;
      IF v_hours <= 0 THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'row_number', v_row_number, 'natural_key', v_natural_key,
          'error_code', 'ASSIGNED_HOURS_MUST_BE_POSITIVE',
          'error_message', 'hours must be positive', 'blocking', true
        ));
        CONTINUE;
      END IF;
    END IF;

    v_offering_id := NULLIF(v_elem->>'course_offering_id', '')::uuid;
    IF v_offering_id IS NULL THEN
      v_offering_id := public.resolve_offering_for_delivery_group(v_dg_id);
    END IF;
    IF v_offering_id IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', v_row_number, 'natural_key', v_natural_key,
        'error_code', 'NO_COMPATIBILITY_OFFERING',
        'error_message', 'no compatibility offering', 'blocking', true
      ));
      CONTINUE;
    END IF;
  END LOOP;

  -- Batch co-teaching split check (pre-DML, pre-lock)
  SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::uuid[])
    INTO v_dg_ids
  FROM (
    SELECT DISTINCT NULLIF(e->>'delivery_group_id', '')::uuid AS x
    FROM jsonb_array_elements(p_rows) e
    WHERE NULLIF(e->>'delivery_group_id', '') IS NOT NULL
  ) s;

  FOREACH v_id IN ARRAY COALESCE(v_dg_ids, ARRAY[]::uuid[]) LOOP
    SELECT COUNT(DISTINCT NULLIF(e->>'instructor_id', '')::uuid)::integer,
           COUNT(*) FILTER (
             WHERE e->>'assigned_component_hours' IS NULL
                OR btrim(COALESCE(e->>'assigned_component_hours', '')) = ''
           )::integer
      INTO v_batch_instructors, v_null_hours
    FROM jsonb_array_elements(p_rows) e
    WHERE NULLIF(e->>'delivery_group_id', '')::uuid = v_id
      AND COALESCE((e->>'is_active')::boolean, true) = true;

    IF v_batch_instructors > 1 AND v_null_hours > 0 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row_number', NULL,
        'natural_key', v_id::text,
        'error_code', 'CO_TEACHING_HOURS_SPLIT_REQUIRED',
        'error_message', 'co-teaching rows require explicit assigned_component_hours',
        'blocking', true
      ));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_errors) > 0 THEN
    RETURN jsonb_build_object(
      'status', 'failed',
      'rows_received', v_rows_received,
      'rows_created', 0,
      'rows_updated', 0,
      'rows_reactivated', 0,
      'rows_unchanged', 0,
      'validation_errors', v_errors,
      'warnings', v_warnings,
      'import_batch_id', v_batch_id
    );
  END IF;

  -- -------- Phase 2: lock delivery groups in deterministic ASC order --------
  IF v_dg_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY v_dg_ids LOOP
      PERFORM public.lock_delivery_group_for_assignment(v_id);
    END LOOP;
  END IF;

  -- -------- Phase 3: apply rows atomically --------
  FOR v_idx IN 0 .. GREATEST(v_rows_received - 1, -1) LOOP
    v_elem := p_rows -> v_idx;
    v_row_number := COALESCE((v_elem->>'row_number')::integer, v_idx + 1);
    v_dg_id := (v_elem->>'delivery_group_id')::uuid;
    v_instructor_id := (v_elem->>'instructor_id')::uuid;
    v_natural_key := v_dg_id::text || '|' || v_instructor_id::text;
    v_notes := v_elem->>'notes';
    v_is_active := COALESCE((v_elem->>'is_active')::boolean, true);
    IF v_elem ? 'assigned_component_hours'
       AND v_elem->>'assigned_component_hours' IS NOT NULL
       AND btrim(v_elem->>'assigned_component_hours') <> '' THEN
      v_hours := (v_elem->>'assigned_component_hours')::numeric;
    ELSE
      v_hours := NULL;
    END IF;
    v_expected_students := COALESCE((v_elem->>'expected_students')::integer, 0);
    v_required_room_type := NULLIF(v_elem->>'required_room_type', '');
    v_offering_id := NULLIF(v_elem->>'course_offering_id', '')::uuid;
    IF v_offering_id IS NULL THEN
      v_offering_id := public.resolve_offering_for_delivery_group(v_dg_id);
    END IF;

    SELECT * INTO v_dg FROM public.operational_delivery_groups WHERE id = v_dg_id;
    PERFORM public.assert_delivery_group_assignable(v_dg.is_obsolete, v_dg.active);
    SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;

    v_session_type := COALESCE(
      NULLIF(v_elem->>'session_type', ''),
      CASE v_pcc.component_type
        WHEN 'theory' THEN 'lecture'
        WHEN 'practical' THEN 'lab'
        WHEN 'tutorial' THEN 'tutorial'
        WHEN 'project' THEN 'seminar'
        ELSE 'lecture'
      END
    );
    v_effective := COALESCE(v_hours, v_pcc.weekly_contact_hours, 0);

    SELECT * INTO v_existing
    FROM public.teaching_assignments ta
    WHERE ta.college_id = v_dg.college_id
      AND ta.delivery_group_id = v_dg_id
      AND ta.instructor_id = v_instructor_id
    ORDER BY ta.is_active DESC, ta.updated_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_existing.id IS NOT NULL AND v_existing.is_active AND NOT v_is_active THEN
      UPDATE public.teaching_assignments SET is_active = FALSE
      WHERE id = v_existing.id
      RETURNING * INTO v_row;
      INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
      VALUES (
        v_uid, 'teaching_assignment_deactivated', 'teaching_assignments', v_row.id, v_dg.college_id,
        jsonb_build_object(
          'assignment_id', v_row.id,
          'delivery_group_id', v_dg_id,
          'instructor_id', v_instructor_id,
          'import_batch_id', v_batch_id,
          'lifecycle_action', 'deactivated'
        )
      );
      v_updated := v_updated + 1;
      CONTINUE;
    END IF;

    IF NOT v_is_active THEN
      v_unchanged := v_unchanged + 1;
      CONTINUE;
    END IF;

    IF v_existing.id IS NOT NULL AND v_existing.is_active THEN
      IF v_mode = 'insert_only' THEN
        v_unchanged := v_unchanged + 1;
        CONTINUE;
      END IF;
      v_same_hours := v_existing.assigned_component_hours IS NOT DISTINCT FROM v_hours;
      v_same_notes := v_existing.notes IS NOT DISTINCT FROM v_notes;
      IF v_same_hours AND v_same_notes
         AND v_existing.course_offering_id IS NOT DISTINCT FROM v_offering_id THEN
        v_unchanged := v_unchanged + 1;
        CONTINUE;
      END IF;

      PERFORM public.validate_assignment_allocation_locked(
        v_dg_id, v_existing.id, v_hours, v_pcc.weekly_contact_hours, true
      );

      UPDATE public.teaching_assignments SET
        assigned_component_hours = v_hours,
        weekly_hours = v_effective,
        notes = COALESCE(v_notes, notes),
        course_offering_id = v_offering_id,
        expected_students = COALESCE(v_expected_students, expected_students),
        required_room_type = COALESCE(v_required_room_type, required_room_type),
        session_type = v_session_type,
        cohort_id = v_dg.cohort_id,
        plan_course_component_id = v_dg.component_id
      WHERE id = v_existing.id
      RETURNING * INTO v_row;

      INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
      VALUES (
        v_uid, 'teaching_assignment_hours_updated', 'teaching_assignments', v_row.id, v_dg.college_id,
        jsonb_build_object(
          'assignment_id', v_row.id,
          'delivery_group_id', v_dg_id,
          'instructor_id', v_instructor_id,
          'old_assigned_hours', v_existing.assigned_component_hours,
          'new_assigned_hours', v_row.assigned_component_hours,
          'import_batch_id', v_batch_id
        )
      );
      v_updated := v_updated + 1;
      CONTINUE;
    END IF;

    IF v_existing.id IS NOT NULL AND NOT v_existing.is_active THEN
      IF v_mode = 'insert_only' THEN
        v_unchanged := v_unchanged + 1;
        CONTINUE;
      END IF;

      PERFORM public.validate_assignment_allocation_locked(
        v_dg_id, v_existing.id, v_hours, v_pcc.weekly_contact_hours, true
      );

      UPDATE public.teaching_assignments SET
        is_active = TRUE,
        assigned_component_hours = v_hours,
        weekly_hours = v_effective,
        notes = COALESCE(v_notes, notes),
        course_offering_id = v_offering_id,
        cohort_id = v_dg.cohort_id,
        plan_course_component_id = v_dg.component_id,
        session_type = v_session_type,
        expected_students = COALESCE(v_expected_students, v_dg.expected_students, expected_students),
        required_room_type = COALESCE(v_required_room_type, required_room_type)
      WHERE id = v_existing.id
      RETURNING * INTO v_row;

      INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
      VALUES (
        v_uid, 'teaching_assignment_reactivated', 'teaching_assignments', v_row.id, v_dg.college_id,
        jsonb_build_object(
          'assignment_id', v_row.id,
          'delivery_group_id', v_dg_id,
          'instructor_id', v_instructor_id,
          'new_assigned_hours', v_hours,
          'import_batch_id', v_batch_id,
          'lifecycle_action', 'reactivated'
        )
      );
      v_reactivated := v_reactivated + 1;
      CONTINUE;
    END IF;

    -- no existing row
    IF v_mode = 'update_existing' THEN
      v_unchanged := v_unchanged + 1;
      CONTINUE;
    END IF;

    PERFORM public.validate_assignment_allocation_locked(
      v_dg_id, NULL, v_hours, v_pcc.weekly_contact_hours, true
    );

    INSERT INTO public.teaching_assignments (
      college_id, course_offering_id, instructor_id, section_number, session_type,
      weekly_hours, notes, expected_students, required_room_type, cohort_id,
      plan_course_component_id, delivery_group_id, assigned_component_hours, is_active
    ) VALUES (
      v_dg.college_id, v_offering_id, v_instructor_id,
      COALESCE(v_dg.group_code, v_dg.group_number::text), v_session_type,
      v_effective, v_notes, COALESCE(v_expected_students, v_dg.expected_students, 0),
      v_required_room_type, v_dg.cohort_id, v_dg.component_id, v_dg_id, v_hours, TRUE
    )
    RETURNING * INTO v_row;

    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (
      v_uid, 'teaching_assignment_created', 'teaching_assignments', v_row.id, v_dg.college_id,
      jsonb_build_object(
        'assignment_id', v_row.id,
        'delivery_group_id', v_dg_id,
        'instructor_id', v_instructor_id,
        'new_assigned_hours', v_hours,
        'import_batch_id', v_batch_id,
        'lifecycle_action', 'created'
      )
    );
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ok',
    'rows_received', v_rows_received,
    'rows_created', v_created,
    'rows_updated', v_updated,
    'rows_reactivated', v_reactivated,
    'rows_unchanged', v_unchanged,
    'validation_errors', '[]'::jsonb,
    'warnings', v_warnings,
    'import_batch_id', v_batch_id
  );
EXCEPTION WHEN OTHERS THEN
  -- Any mid-apply failure rolls back the whole transaction (atomic)
  RAISE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_schedule_builder_v2_work_items(p_schedule_version_id uuid, p_program_id uuid DEFAULT NULL::uuid, p_level_id uuid DEFAULT NULL::uuid, p_cohort_id uuid DEFAULT NULL::uuid, p_study_system text DEFAULT NULL::text, p_component_type text DEFAULT NULL::text, p_instructor_id uuid DEFAULT NULL::uuid, p_scheduling_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_schedule_version_id IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_version
  FROM public.schedule_versions
  WHERE id = p_schedule_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_view_college(v_uid, v_version.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(x.row_obj ORDER BY x.course_code, x.component_type, x.group_number, x.instructor_name), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      c.code AS course_code,
      pcc.component_type,
      dg.group_number,
      i.full_name AS instructor_name,
      jsonb_build_object(
        'teaching_assignment_id', ta.id,
        'delivery_group_id', dg.id,
        'cohort_id', ac.id,
        'cohort_code', CASE WHEN EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=dg.id) THEN ac.code || ' + موازي' ELSE ac.code END,
        'program_id', ac.program_id,
        'level_id', ac.level_id,
        'semester_term_id', ac.term_id,
        'study_system', CASE WHEN EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE anchor_group_id=dg.id) THEN 'both' ELSE ac.study_system END,
        'course_id', c.id,
        'course_code', c.code,
        'course_name', c.name,
        'component_id', pcc.id,
        'component_type', pcc.component_type,
        'group_number', dg.group_number,
        'group_code', dg.group_code,
        'instructor_id', i.id,
        'instructor_name', i.full_name,
        'assigned_component_hours', COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0),
        'component_hours', pcc.weekly_contact_hours,
        'time_unit', 'component_hours_wallclock_equivalent',
        'currently_scheduled_hours', sched.scheduled_hours,
        'remaining_schedule_hours', GREATEST(
          0,
          COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) - sched.scheduled_hours
        ),
        'session_count', sched.session_count,
        'scheduling_status', status.scheduling_status,
        'blocking_reason', status.blocking_reason,
        'can_create_session', status.can_create_session,
        'is_project', (pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false),
        'is_summer_training', (pcc.component_type = 'summer_training'),
        'assignment_active', COALESCE(ta.is_active, true),
        'delivery_group_active', COALESCE(dg.active, true),
        'delivery_group_obsolete', COALESCE(dg.is_obsolete, false),
        'allocation_status', COALESCE(alloc.allocation_json->>'allocation_status', 'unassigned'),
        'course_offering_id', ta.course_offering_id,
        'plan_course_component_id', ta.plan_course_component_id,
        'session_type', ta.session_type,
        'expected_students', COALESCE(ta.expected_students, dg.expected_students, 0),
        'assignment_updated_at', ta.updated_at
      ) AS row_obj
    FROM public.teaching_assignments ta
    JOIN public.operational_delivery_groups dg
      ON dg.id = ta.delivery_group_id
     AND dg.college_id = ta.college_id
    JOIN public.academic_cohorts ac
      ON ac.id = dg.cohort_id
     AND ac.college_id = dg.college_id
    JOIN public.plan_course_components pcc
      ON pcc.id = dg.component_id
     AND pcc.college_id = ta.college_id
    JOIN public.plan_courses pc
      ON pc.id = dg.plan_course_id
     AND pc.college_id = ta.college_id
    JOIN public.courses c
      ON c.id = pc.course_id
     AND c.college_id = ta.college_id
    JOIN public.instructors i
      ON i.id = ta.instructor_id
     AND i.college_id = ta.college_id
    CROSS JOIN LATERAL (
      SELECT public.compute_delivery_group_allocation(dg.id) AS allocation_json
    ) alloc
    CROSS JOIN LATERAL (
      SELECT
        COALESCE(SUM(public._sb_v2_wall_hours(ss.start_time, ss.end_time)), 0) AS scheduled_hours,
        COUNT(*)::integer AS session_count
      FROM public.schedule_sessions ss
      WHERE ss.schedule_version_id = p_schedule_version_id
        AND ss.teaching_assignment_id = ta.id
    ) sched
    CROSS JOIN LATERAL (
      SELECT
        CASE
          WHEN COALESCE(ta.is_active, true) = false THEN 'blocked'
          WHEN COALESCE(dg.active, true) = false THEN 'blocked'
          WHEN COALESCE(dg.is_obsolete, false) THEN 'blocked'
          WHEN pcc.component_type = 'summer_training' THEN 'blocked'
          WHEN pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN 'blocked'
          WHEN sched.scheduled_hours > COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN 'over_scheduled'
          WHEN sched.scheduled_hours <= 0 THEN 'unscheduled'
          WHEN sched.scheduled_hours < COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN 'partially_scheduled'
          ELSE 'scheduled'
        END AS scheduling_status,
        CASE
          WHEN COALESCE(ta.is_active, true) = false THEN 'INACTIVE_ASSIGNMENT'
          WHEN COALESCE(dg.active, true) = false THEN 'INACTIVE_DELIVERY_GROUP'
          WHEN COALESCE(dg.is_obsolete, false) THEN 'OBSOLETE_DELIVERY_GROUP'
          WHEN pcc.component_type = 'summer_training' THEN 'SUMMER_TRAINING_BLOCKED'
          WHEN pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN 'PROJECT_NON_WEEKLY'
          WHEN sched.scheduled_hours > COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN 'OVER_SCHEDULED'
          ELSE NULL
        END AS blocking_reason,
        CASE
          WHEN COALESCE(ta.is_active, true) = false THEN false
          WHEN COALESCE(dg.active, true) = false THEN false
          WHEN COALESCE(dg.is_obsolete, false) THEN false
          WHEN pcc.component_type = 'summer_training' THEN false
          WHEN pcc.component_type = 'project' AND COALESCE(pcc.counts_toward_regular_load, true) = false THEN false
          WHEN sched.scheduled_hours >= COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN false
          ELSE true
        END AS can_create_session
    ) status
    WHERE ta.college_id = v_version.college_id
      AND ta.delivery_group_id IS NOT NULL
      AND ac.term_id = v_version.academic_term_id
      AND public.shared_lecture_matches(dg.id,p_cohort_id,p_study_system)
      AND (p_program_id IS NULL OR ac.program_id = p_program_id)
      AND (p_level_id IS NULL OR ac.level_id = p_level_id)
      AND NOT EXISTS(SELECT 1 FROM public.shared_lecture_links WHERE member_group_id=dg.id)
      AND (p_component_type IS NULL OR pcc.component_type = p_component_type)
      AND (p_instructor_id IS NULL OR ta.instructor_id = p_instructor_id)
      AND (
        p_scheduling_status IS NULL
        OR p_scheduling_status = 'all'
        OR status.scheduling_status = p_scheduling_status
      )
  ) x;

  RETURN jsonb_build_object(
    'ok', true,
    'schedule_version_id', p_schedule_version_id,
    'college_id', v_version.college_id,
    'academic_term_id', v_version.academic_term_id,
    'version_status', v_version.status,
    'version_updated_at', v_version.updated_at,
    'time_unit', 'component_hours_wallclock_equivalent',
    'time_unit_note', 'No formal academic-hour→minutes contract; remaining uses assigned_component_hours vs wall-clock session hours.',
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'can_manage', public.can_manage_college(v_uid, v_version.college_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._sb_v2_assignment_guard(p_teaching_assignment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ta public.teaching_assignments%ROWTYPE;
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
BEGIN
  IF p_teaching_assignment_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'is_v2', false);
  END IF;

  SELECT * INTO v_ta
  FROM public.teaching_assignments
  WHERE id = p_teaching_assignment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ASSIGNMENT_NOT_FOUND');
  END IF;

  IF v_ta.delivery_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'is_v2', false, 'teaching_assignment_id', v_ta.id);
  END IF;

  IF COALESCE(v_ta.is_active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INACTIVE_ASSIGNMENT', 'is_v2', true);
  END IF;

  SELECT * INTO v_dg FROM public.operational_delivery_groups WHERE id = v_ta.delivery_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DELIVERY_GROUP_NOT_FOUND', 'is_v2', true);
  END IF;
  IF COALESCE(v_dg.is_obsolete, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OBSOLETE_DELIVERY_GROUP', 'is_v2', true);
  END IF;
  IF COALESCE(v_dg.active, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INACTIVE_DELIVERY_GROUP', 'is_v2', true);
  END IF;

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'COMPONENT_NOT_FOUND', 'is_v2', true);
  END IF;
  IF v_pcc.component_type = 'summer_training' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SUMMER_TRAINING_BLOCKED', 'is_v2', true);
  END IF;
  -- Only supervision projects are non-weekly; regular weekly project hours schedule normally.
  IF v_pcc.component_type = 'project'
     AND COALESCE(v_pcc.counts_toward_regular_load, true) = false THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PROJECT_NON_WEEKLY', 'is_v2', true);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'is_v2', true,
    'teaching_assignment_id', v_ta.id,
    'delivery_group_id', v_dg.id,
    'component_type', v_pcc.component_type
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

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'instructor_id', i.id,
      'full_name', i.full_name,
      'employee_number', i.employee_number,
      'academic_rank', i.academic_rank,
      'already_assigned', EXISTS (
        SELECT 1 FROM public.teaching_assignments ta
        WHERE ta.delivery_group_id = p_delivery_group_id
          AND ta.instructor_id = i.id
          AND ta.is_active = TRUE
      )
    ) ORDER BY i.full_name
  ), '[]'::jsonb)
  INTO v_candidates
  FROM public.instructors i
  WHERE i.college_id = v_dg.college_id
    AND i.is_active = TRUE;

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
    'assignable', NOT COALESCE(v_dg.is_obsolete, false)
      AND COALESCE(v_dg.active, true)
      AND COALESCE(v_pcc.component_type, '') IS DISTINCT FROM 'summer_training'
      AND public.can_manage_college(v_uid, v_dg.college_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.schedule_version_delivery_coverage(p_college_id uuid, p_schedule_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_term_id uuid;
  v_result jsonb;
BEGIN
  SELECT academic_term_id INTO v_term_id
  FROM public.schedule_versions
  WHERE id = p_schedule_version_id AND college_id = p_college_id;

  IF v_term_id IS NULL THEN
    RAISE EXCEPTION 'SCHEDULE_VERSION_NOT_FOUND' USING ERRCODE='P0002';
  END IF;

  WITH expected AS (
    SELECT dg.id AS delivery_group_id,
           pcc.weekly_contact_hours::numeric AS required_hours
    FROM public.operational_delivery_groups dg
    JOIN public.academic_cohorts ac ON ac.id = dg.cohort_id
    JOIN public.plan_course_components pcc ON pcc.id = dg.component_id
    WHERE dg.college_id = p_college_id
      AND ac.term_id = v_term_id
      AND ac.active = true
      AND dg.active = true
      AND COALESCE(dg.is_obsolete,false) = false
      AND COALESCE(pcc.is_timetabled,true) = true
  ), assignments AS (
    SELECT ta.delivery_group_id,
           count(*) FILTER (WHERE ta.is_active=true)::integer AS active_assignments
    FROM public.teaching_assignments ta
    WHERE ta.college_id = p_college_id
    GROUP BY ta.delivery_group_id
  ), sessions AS (
    SELECT ss.delivery_group_id,
           count(*)::integer AS session_count,
           sum(extract(epoch FROM (ss.end_time-ss.start_time))/3600.0)::numeric AS scheduled_hours
    FROM public.schedule_sessions ss
    WHERE ss.college_id = p_college_id
      AND ss.schedule_version_id = p_schedule_version_id
      AND COALESCE(ss.replaced_by_split,false)=false
      AND ss.delivery_group_id IS NOT NULL
    GROUP BY ss.delivery_group_id
  ), a AS (
    SELECT e.delivery_group_id,
           e.required_hours,
           COALESCE(x.active_assignments,0) AS active_assignments,
           COALESCE(s.session_count,0) AS session_count,
           COALESCE(s.scheduled_hours,0)::numeric AS scheduled_hours
    FROM expected e
    LEFT JOIN assignments x ON x.delivery_group_id=e.delivery_group_id
    LEFT JOIN sessions s ON s.delivery_group_id=e.delivery_group_id
  ), totals AS (
    SELECT count(*)::integer AS total_groups,
           count(*) FILTER (WHERE active_assignments=1)::integer AS assigned_exactly_once,
           count(*) FILTER (WHERE active_assignments=0)::integer AS unassigned_groups,
           count(*) FILTER (WHERE active_assignments>1)::integer AS multi_assigned_groups,
           count(*) FILTER (WHERE session_count>0)::integer AS groups_with_sessions,
           count(*) FILTER (WHERE session_count=0)::integer AS groups_without_sessions,
           count(*) FILTER (WHERE abs(scheduled_hours-required_hours)<0.001)::integer AS exact_hours_groups,
           count(*) FILTER (WHERE scheduled_hours<required_hours)::integer AS short_hours_groups,
           count(*) FILTER (WHERE scheduled_hours>required_hours)::integer AS over_hours_groups,
           COALESCE(sum(required_hours),0)::numeric AS required_hours,
           COALESCE(sum(scheduled_hours),0)::numeric AS scheduled_hours,
           COALESCE(sum(greatest(required_hours-scheduled_hours,0)),0)::numeric AS missing_hours,
           COALESCE(sum(greatest(scheduled_hours-required_hours,0)),0)::numeric AS extra_hours
    FROM a
  )
  SELECT jsonb_build_object(
    'total_groups', total_groups,
    'assigned_exactly_once', assigned_exactly_once,
    'unassigned_groups', unassigned_groups,
    'multi_assigned_groups', multi_assigned_groups,
    'groups_with_sessions', groups_with_sessions,
    'groups_without_sessions', groups_without_sessions,
    'exact_hours_groups', exact_hours_groups,
    'short_hours_groups', short_hours_groups,
    'over_hours_groups', over_hours_groups,
    'required_hours', required_hours,
    'scheduled_hours', scheduled_hours,
    'missing_hours', missing_hours,
    'extra_hours', extra_hours,
    'complete', (total_groups > 0
                 AND unassigned_groups=0
                 AND multi_assigned_groups=0
                 AND short_hours_groups=0
                 AND over_hours_groups=0)
  ) INTO v_result
  FROM totals;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_schedule_version_delivery_gaps(p_college_id uuid, p_schedule_version_id uuid)
 RETURNS TABLE(delivery_group_id uuid, cohort_id uuid, cohort_code text, program_id uuid, program_name text, program_code text, study_system text, level_id uuid, level_number integer, level_name text, course_code text, course_name text, component_type text, group_code text, group_number integer, expected_students integer, active_assignment_count integer, instructor_names text, required_hours numeric, scheduled_hours numeric, missing_hours numeric, scheduling_state text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH version_ctx AS (
  SELECT academic_term_id AS term_id
  FROM public.schedule_versions
  WHERE id=p_schedule_version_id AND college_id=p_college_id
), expected AS (
  SELECT dg.id delivery_group_id, ac.id cohort_id, ac.code cohort_code,
         ap.id program_id, ap.name program_name, ap.code program_code,
         ac.study_system, al.id level_id, al.level_number, al.name level_name,
         c.code course_code, c.name course_name,
         pcc.component_type, dg.group_code, dg.group_number, dg.expected_students,
         pcc.weekly_contact_hours::numeric required_hours
  FROM public.operational_delivery_groups dg
  JOIN public.academic_cohorts ac ON ac.id=dg.cohort_id
  JOIN public.academic_programs ap ON ap.id=ac.program_id
  JOIN public.academic_levels al ON al.id=ac.level_id
  JOIN public.plan_courses pc ON pc.id=dg.plan_course_id
  JOIN public.courses c ON c.id=pc.course_id
  JOIN public.plan_course_components pcc ON pcc.id=dg.component_id
  CROSS JOIN version_ctx v
  WHERE dg.college_id=p_college_id
    AND ac.term_id=v.term_id
    AND ac.active=true
    AND dg.active=true
    AND COALESCE(dg.is_obsolete,false)=false
    AND COALESCE(pcc.is_timetabled,true)=true
), ta AS (
  SELECT x.delivery_group_id,
         count(*) FILTER(WHERE x.is_active=true)::integer active_assignment_count,
         string_agg(DISTINCT i.full_name,'، ' ORDER BY i.full_name) FILTER(WHERE x.is_active=true) instructor_names
  FROM public.teaching_assignments x
  LEFT JOIN public.instructors i ON i.id=x.instructor_id
  WHERE x.college_id=p_college_id
  GROUP BY x.delivery_group_id
), ss AS (
  SELECT x.delivery_group_id,
         sum(extract(epoch FROM (x.end_time-x.start_time))/3600.0)::numeric scheduled_hours
  FROM public.schedule_sessions x
  WHERE x.college_id=p_college_id
    AND x.schedule_version_id=p_schedule_version_id
    AND COALESCE(x.replaced_by_split,false)=false
    AND x.delivery_group_id IS NOT NULL
  GROUP BY x.delivery_group_id
)
SELECT e.delivery_group_id,e.cohort_id,e.cohort_code,e.program_id,e.program_name,e.program_code,
       e.study_system,e.level_id,e.level_number,e.level_name,e.course_code,e.course_name,
       e.component_type,e.group_code,e.group_number,e.expected_students,
       COALESCE(ta.active_assignment_count,0),ta.instructor_names,e.required_hours,
       COALESCE(ss.scheduled_hours,0)::numeric,
       greatest(e.required_hours-COALESCE(ss.scheduled_hours,0),0)::numeric,
       CASE
         WHEN COALESCE(ta.active_assignment_count,0)=0 THEN 'unassigned'
         WHEN COALESCE(ta.active_assignment_count,0)>1 THEN 'multi_assigned'
         WHEN COALESCE(ss.scheduled_hours,0)=0 THEN 'unscheduled'
         WHEN COALESCE(ss.scheduled_hours,0)<e.required_hours THEN 'short_hours'
         WHEN COALESCE(ss.scheduled_hours,0)>e.required_hours THEN 'over_hours'
         ELSE 'complete'
       END scheduling_state
FROM expected e
LEFT JOIN ta ON ta.delivery_group_id=e.delivery_group_id
LEFT JOIN ss ON ss.delivery_group_id=e.delivery_group_id
WHERE COALESCE(ta.active_assignment_count,0)<>1
   OR abs(COALESCE(ss.scheduled_hours,0)-e.required_hours)>=0.001
ORDER BY e.program_name,e.study_system,e.level_number,e.course_code,e.component_type,e.group_number;
$function$;

CREATE OR REPLACE FUNCTION public.schedule_version_room_type_capacity(p_college_id uuid, p_schedule_version_id uuid)
 RETURNS TABLE(room_type_id uuid, room_type_code text, room_type_name text, active_rooms integer, working_days integer, daily_window_hours numeric, theoretical_available_hours numeric, required_group_hours numeric, balance_hours numeric, feasible boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with v as (
  select academic_term_id term_id
  from public.schedule_versions
  where id=p_schedule_version_id and college_id=p_college_id
), settings as (
  select working_days, day_start_time, day_end_time,
         cardinality(working_days)::integer working_days_count
  from public.scheduling_settings
  where college_id=p_college_id
  limit 1
), room_day_supply as (
  select r.id room_id, rt.id room_type_id, rt.code, rt.name_ar,
         d.day_of_week,
         coalesce(
           (
             select sum(extract(epoch from (ra.end_time-ra.start_time))/3600.0)
             from public.room_availability ra
             where ra.college_id=p_college_id
               and ra.room_id=r.id
               and ra.day_of_week=d.day_of_week
           ),
           extract(epoch from (s.day_end_time-s.day_start_time))/3600.0
         )::numeric as hours
  from public.rooms r
  join public.room_types rt on rt.id=r.room_type_id
  cross join settings s
  cross join lateral (
    select unnest(s.working_days)::smallint as day_of_week
  ) d
  where r.college_id=p_college_id
    and r.is_active=true
), supply as (
  select room_type_id, code, name_ar,
         count(distinct room_id)::integer active_rooms,
         max((select working_days_count from settings))::integer working_days,
         case when count(distinct room_id)>0 and max((select working_days_count from settings))>0
              then sum(hours)/(count(distinct room_id)*max((select working_days_count from settings)))
              else 0 end::numeric as daily_window_hours,
         sum(hours)::numeric as theoretical_available_hours
  from room_day_supply
  group by room_type_id, code, name_ar
), demand as (
  select pcc.required_room_type_id room_type_id,
         sum(pcc.weekly_contact_hours)::numeric required_group_hours
  from public.operational_delivery_groups dg
  join public.academic_cohorts ac on ac.id=dg.cohort_id
  join public.plan_course_components pcc on pcc.id=dg.component_id
  cross join v
  where dg.college_id=p_college_id
    and ac.term_id=v.term_id
    and ac.active=true
    and dg.active=true
    and coalesce(dg.is_obsolete,false)=false
    and coalesce(pcc.is_timetabled,true)=true
  group by pcc.required_room_type_id
)
select sp.room_type_id, sp.code, sp.name_ar, sp.active_rooms, sp.working_days,
       sp.daily_window_hours,
       sp.theoretical_available_hours,
       coalesce(d.required_group_hours,0)::numeric required_group_hours,
       (sp.theoretical_available_hours-coalesce(d.required_group_hours,0))::numeric balance_hours,
       (sp.theoretical_available_hours >= coalesce(d.required_group_hours,0)) feasible
from supply sp
left join demand d on d.room_type_id=sp.room_type_id
order by sp.code;
$function$;

CREATE OR REPLACE FUNCTION public.lock_delivery_group_for_assignment(p_delivery_group_id uuid)
 RETURNS delivery_groups
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dg public.delivery_groups%ROWTYPE;
BEGIN
  IF p_delivery_group_id IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_dg
  FROM public.delivery_groups dg
  WHERE dg.id = p_delivery_group_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  -- Deterministic lock of active assignment rows for this group
  PERFORM 1
  FROM public.teaching_assignments ta
  WHERE ta.delivery_group_id = p_delivery_group_id
    AND ta.is_active = TRUE
  ORDER BY ta.id
  FOR UPDATE;

  RETURN public.operational_delivery_group(p_delivery_group_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_schedule_session_from_assignment_v2(p_schedule_version_id uuid, p_teaching_assignment_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_room_id uuid, p_expected_version_updated_at timestamp with time zone, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_ta public.teaching_assignments%ROWTYPE;
  v_dg public.delivery_groups%ROWTYPE;
  v_pcc public.plan_course_components%ROWTYPE;
  v_guard jsonb;
  v_bundle jsonb;
  v_dg_conflicts jsonb;
  v_session public.schedule_sessions%ROWTYPE;
  v_probe_id uuid := gen_random_uuid();
  v_assigned numeric;
  v_scheduled numeric;
  v_proposed numeric;
  v_blocking_len integer;
  v_warning_len integer;
  v_offering_id uuid;
  v_offering_term_id uuid;
  v_cohort_term_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHORIZED', 'stale', false,
      'message_ar', 'يجب تسجيل الدخول.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_schedule_version_id IS NULL OR p_teaching_assignment_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_ARGS', 'stale', false,
      'message_ar', 'معرّف النسخة والتكليف مطلوبان.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_day_of_week IS NULL OR p_day_of_week < 0 OR p_day_of_week > 6 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_DAY', 'stale', false,
      'message_ar', 'يوم غير صالح.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_start_time IS NULL OR p_end_time IS NULL OR p_end_time <= p_start_time THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TIME_RANGE', 'stale', false,
      'message_ar', 'نطاق الوقت غير صالح.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_room_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROOM_REQUIRED', 'stale', false,
      'message_ar', 'القاعة مطلوبة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT * INTO v_version
  FROM public.schedule_versions
  WHERE id = p_schedule_version_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'stale', false,
      'message_ar', 'نسخة الجدول غير موجودة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF NOT public.can_manage_college(v_uid, v_version.college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN_COLLEGE', 'stale', false,
      'message_ar', 'لا تملك صلاحية إدارة هذه الكلية.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_version.status IS DISTINCT FROM 'draft' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', CASE
        WHEN v_version.status = 'published' THEN 'VERSION_PUBLISHED'
        WHEN v_version.status = 'archived' THEN 'VERSION_ARCHIVED'
        ELSE 'VERSION_LOCKED'
      END,
      'stale', false,
      'message_ar', 'الإنشاء اليدوي مسموح لنسخ المسودة فقط.',
      'blocking_conflicts', '[]'::jsonb,
      'warnings', '[]'::jsonb
    );
  END IF;

  IF p_expected_version_updated_at IS NULL
     OR v_version.updated_at IS DISTINCT FROM p_expected_version_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_VERSION', 'stale', true,
      'message_ar', 'تغيّرت نسخة الجدول. أعد التحميل ثم حاول مجددًا.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT * INTO v_ta
  FROM public.teaching_assignments
  WHERE id = p_teaching_assignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ASSIGNMENT_NOT_FOUND', 'stale', false,
      'message_ar', 'التكليف غير موجود.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_ta.college_id <> v_version.college_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CROSS_COLLEGE_FORBIDDEN', 'stale', false,
      'message_ar', 'التكليف لا ينتمي لنفس كلية النسخة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_ta.delivery_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_V2_ASSIGNMENT', 'stale', false,
      'message_ar', 'هذا المسار مخصص لتكليفات V2 المرتبطة بمجموعة تدريس.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  v_guard := public._sb_v2_assignment_guard(v_ta.id);
  IF COALESCE((v_guard->>'ok')::boolean, false) = false THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', COALESCE(v_guard->>'code', 'ASSIGNMENT_BLOCKED'),
      'stale', false,
      'message_ar', 'التكليف غير قابل للجدولة حاليًا.',
      'blocking_conflicts', '[]'::jsonb,
      'warnings', '[]'::jsonb,
      'guard', v_guard
    );
  END IF;

  SELECT * INTO v_dg
  FROM public.delivery_groups
  WHERE id = v_ta.delivery_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'DELIVERY_GROUP_NOT_FOUND', 'stale', false,
      'message_ar', 'مجموعة التدريس غير موجودة.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;
  v_dg := public.operational_delivery_group(v_dg.id);

  SELECT * INTO v_pcc FROM public.plan_course_components WHERE id = v_dg.component_id;

  v_offering_id := public.resolve_offering_for_delivery_group(v_dg.id);
  IF v_offering_id IS NULL OR v_offering_id IS DISTINCT FROM v_ta.course_offering_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OFFERING_COMPATIBILITY', 'stale', false,
      'message_ar', 'عرض المقرر غير متوافق مع مجموعة التدريس.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  SELECT co.term_id INTO v_offering_term_id
  FROM public.course_offerings co
  WHERE co.id = v_offering_id
    AND co.college_id = v_version.college_id;

  SELECT ac.term_id INTO v_cohort_term_id
  FROM public.academic_cohorts ac
  WHERE ac.id = v_dg.cohort_id
    AND ac.college_id = v_version.college_id;

  IF v_offering_term_id IS DISTINCT FROM v_version.academic_term_id
     OR v_cohort_term_id IS DISTINCT FROM v_version.academic_term_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CROSS_TERM_FORBIDDEN', 'stale', false,
      'message_ar', 'التكليف لا ينتمي إلى الفصل الأكاديمي لنسخة الجدول.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF v_ta.instructor_id IS NULL
     OR v_ta.cohort_id IS DISTINCT FROM v_dg.cohort_id
     OR v_ta.plan_course_component_id IS DISTINCT FROM v_dg.component_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ASSIGNMENT_IDENTITY_MISMATCH', 'stale', false,
      'message_ar', 'عدم تطابق بيانات التكليف مع مجموعة التدريس.',
      'blocking_conflicts', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  v_assigned := COALESCE(v_ta.assigned_component_hours, v_pcc.weekly_contact_hours, 0);
  v_proposed := public._sb_v2_wall_hours(p_start_time, p_end_time);
  v_scheduled := public._sb_v2_scheduled_hours_for_assignment(
    p_schedule_version_id, v_ta.id, NULL
  );

  IF v_scheduled + v_proposed > v_assigned THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'OVER_SCHEDULED',
      'stale', false,
      'message_ar', 'تجاوز الساعات المكلف بها لهذا المدرس.',
      'blocking_conflicts', jsonb_build_array(jsonb_build_object(
        'code', 'over_scheduled',
        'severity', 'hard',
        'message_ar', 'تجاوز الساعات المكلف بها.',
        'metadata', jsonb_build_object(
          'assigned_component_hours', v_assigned,
          'currently_scheduled_hours', v_scheduled,
          'proposed_hours', v_proposed
        )
      )),
      'warnings', '[]'::jsonb
    );
  END IF;

  v_bundle := public._collect_schedule_session_move_conflicts(
    v_probe_id,
    v_version.college_id,
    p_schedule_version_id,
    v_ta.instructor_id,
    v_ta.section_id,
    v_ta.course_offering_id,
    v_ta.id,
    COALESCE(
      (SELECT ac.study_system FROM public.academic_cohorts ac WHERE ac.id = v_dg.cohort_id),
      'regular'
    ),
    COALESCE(v_ta.expected_students, v_dg.expected_students, 0),
    p_day_of_week,
    p_start_time,
    p_end_time,
    p_room_id
  );

  v_dg_conflicts := public._sb_v2_delivery_group_overlap(
    p_schedule_version_id,
    v_dg.id,
    v_dg.cohort_id,
    p_day_of_week,
    p_start_time,
    p_end_time,
    NULL
  );

  IF jsonb_array_length(v_dg_conflicts) > 0 THEN
    v_bundle := jsonb_set(
      v_bundle,
      '{blocking_conflicts}',
      COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb) || v_dg_conflicts
    );
  END IF;

  v_blocking_len := jsonb_array_length(COALESCE(v_bundle->'blocking_conflicts', '[]'::jsonb));
  v_warning_len := jsonb_array_length(COALESCE(v_bundle->'warnings', '[]'::jsonb));

  IF v_blocking_len > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'BLOCKED_CONFLICTS',
      'stale', false,
      'message_ar', 'توجد تعارضات مانعة.',
      'blocking_conflicts', v_bundle->'blocking_conflicts',
      'warnings', v_bundle->'warnings',
      'approved_exceptions', v_bundle->'approved_exceptions'
    );
  END IF;

  IF v_warning_len > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'BLOCKED_WARNINGS',
      'stale', false,
      'message_ar', 'توجد تحذيرات غير محلولة. الحفظ غير مسموح حاليًا.',
      'blocking_conflicts', v_bundle->'blocking_conflicts',
      'warnings', v_bundle->'warnings',
      'approved_exceptions', v_bundle->'approved_exceptions'
    );
  END IF;

  INSERT INTO public.schedule_sessions (
    college_id,
    schedule_version_id,
    course_offering_id,
    teaching_assignment_id,
    delivery_group_id,
    cohort_id,
    plan_course_component_id,
    instructor_id,
    section_id,
    room_id,
    day_of_week,
    start_time,
    end_time,
    session_type,
    study_system,
    expected_students,
    source_type
  ) VALUES (
    v_version.college_id,
    p_schedule_version_id,
    v_ta.course_offering_id,
    v_ta.id,
    v_dg.id,
    v_dg.cohort_id,
    v_dg.component_id,
    v_ta.instructor_id,
    v_ta.section_id,
    p_room_id,
    p_day_of_week,
    p_start_time,
    p_end_time,
    COALESCE(v_ta.session_type, 'lecture'),
    COALESCE(
      (SELECT ac.study_system FROM public.academic_cohorts ac WHERE ac.id = v_dg.cohort_id),
      'regular'
    ),
    COALESCE(v_ta.expected_students, v_dg.expected_students, 0),
    'manual'
  )
  RETURNING * INTO v_session;

  UPDATE public.schedule_versions
  SET updated_at = now()
  WHERE id = p_schedule_version_id
  RETURNING * INTO v_version;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    'schedule_session_created_from_assignment',
    'schedule_sessions',
    v_session.id,
    v_version.college_id,
    jsonb_build_object(
      'schedule_session_id', v_session.id,
      'schedule_version_id', p_schedule_version_id,
      'teaching_assignment_id', v_ta.id,
      'delivery_group_id', v_dg.id,
      'instructor_id', v_ta.instructor_id,
      'room_id', p_room_id,
      'day_of_week', p_day_of_week,
      'start_time', p_start_time,
      'end_time', p_end_time,
      'note', NULLIF(btrim(COALESCE(p_note, '')), ''),
      'proposed_hours', v_proposed,
      'assigned_component_hours', v_assigned
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'code', 'CREATED',
    'stale', false,
    'session', jsonb_build_object(
      'id', v_session.id,
      'day_of_week', v_session.day_of_week,
      'start_time', v_session.start_time,
      'end_time', v_session.end_time,
      'room_id', v_session.room_id,
      'teaching_assignment_id', v_session.teaching_assignment_id,
      'delivery_group_id', v_session.delivery_group_id,
      'updated_at', v_session.updated_at
    ),
    'schedule_version_updated_at', v_version.updated_at,
    'scheduling_summary', jsonb_build_object(
      'assigned_component_hours', v_assigned,
      'currently_scheduled_hours', v_scheduled + v_proposed,
      'remaining_schedule_hours', GREATEST(0, v_assigned - (v_scheduled + v_proposed)),
      'session_count', (
        SELECT COUNT(*)::integer FROM public.schedule_sessions ss
        WHERE ss.schedule_version_id = p_schedule_version_id
          AND ss.teaching_assignment_id = v_ta.id
      )
    ),
    'blocking_conflicts', '[]'::jsonb,
    'warnings', '[]'::jsonb
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._sb_v2_delivery_group_overlap(p_schedule_version_id uuid, p_delivery_group_id uuid, p_cohort_id uuid, p_day_of_week integer, p_start_time time without time zone, p_end_time time without time zone, p_exclude_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_peer record;
  v_conflicts jsonb := '[]'::jsonb;
  v_shared boolean;
BEGIN
  IF p_delivery_group_id IS NULL AND p_cohort_id IS NULL THEN
    RETURN v_conflicts;
  END IF;

  FOR v_peer IN
    SELECT ss.id, ss.delivery_group_id, ss.cohort_id
    FROM public.schedule_sessions ss
    WHERE ss.schedule_version_id = p_schedule_version_id
      AND ss.day_of_week = p_day_of_week
      AND ss.start_time < p_end_time
      AND p_start_time < ss.end_time
      AND (p_exclude_session_id IS NULL OR ss.id <> p_exclude_session_id)
      AND (
        (p_delivery_group_id IS NOT NULL AND ss.delivery_group_id IS NOT NULL)
        OR (p_cohort_id IS NOT NULL AND ss.cohort_id = p_cohort_id)
      )
  LOOP
    v_shared := true;
    IF p_delivery_group_id IS NOT NULL
       AND v_peer.delivery_group_id IS NOT NULL
       AND v_peer.delivery_group_id <> p_delivery_group_id THEN
      v_shared := public.delivery_groups_share_students(
        p_delivery_group_id, v_peer.delivery_group_id
      );
    END IF;

    IF v_shared THEN
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'code', 'delivery_group_conflict',
        'severity', 'hard',
        'message_ar', 'تعارض مجموعة التدريس / الدفعة: توجد جلسة متداخلة لنفس المجموعة أو لطلاب مشتركين.',
        'message_en', 'Delivery group / cohort conflict: overlapping session sharing students.',
        'related_session_id', v_peer.id,
        'metadata', jsonb_build_object(
          'delivery_group_id', v_peer.delivery_group_id,
          'cohort_id', v_peer.cohort_id,
          'shared_students', true
        )
      ));
    END IF;
  END LOOP;

  RETURN v_conflicts;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delivery_groups_share_students(p_a uuid, p_b uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a_cohort uuid; b_cohort uuid;
  a_expected integer; b_expected integer;
  a_count integer; b_count integer;
  a_cover integer; b_cover integer;
  v_shared integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN true; END IF;
  IF p_a IS NULL OR p_b IS NULL THEN RETURN true; END IF;
  IF p_a = p_b THEN RETURN true; END IF;

  SELECT cohort_id, expected_students INTO a_cohort, a_expected
  FROM public.operational_delivery_groups WHERE id = p_a AND active AND NOT coalesce(is_obsolete,false) AND public.can_view_college(auth.uid(),college_id);
  SELECT cohort_id, expected_students INTO b_cohort, b_expected
  FROM public.operational_delivery_groups WHERE id = p_b AND active AND NOT coalesce(is_obsolete,false) AND public.can_view_college(auth.uid(),college_id);
  IF a_cohort IS NULL OR b_cohort IS NULL THEN RETURN true; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.shared_lecture_group_ids(p_a) ma
    JOIN public.delivery_groups ga ON ga.id=ma.group_id
    JOIN public.delivery_groups gb ON gb.cohort_id=ga.cohort_id
    JOIN public.shared_lecture_group_ids(p_b) mb ON mb.group_id=gb.id) THEN RETURN false; END IF;

  SELECT count(*), COALESCE(sum(p.headcount), 0) INTO a_count, a_cover
  FROM public.operational_group_members m
  JOIN public.cohort_student_partitions p ON p.id = m.partition_id AND p.active
  WHERE m.delivery_group_id = p_a;

  SELECT count(*), COALESCE(sum(p.headcount), 0) INTO b_count, b_cover
  FROM public.operational_group_members m
  JOIN public.cohort_student_partitions p ON p.id = m.partition_id AND p.active
  WHERE m.delivery_group_id = p_b;

  -- unmapped or incomplete coverage → conservative conflict
  IF a_count = 0 OR b_count = 0 THEN RETURN true; END IF;
  IF coalesce(a_expected,0)<=0 OR coalesce(b_expected,0)<=0 OR a_cover <> a_expected OR b_cover <> b_expected THEN
    RETURN true;
  END IF;

  SELECT count(*) INTO v_shared
  FROM public.operational_group_members ma
  JOIN public.operational_group_members mb
    ON mb.partition_id = ma.partition_id
  WHERE ma.delivery_group_id = p_a AND mb.delivery_group_id = p_b;

  RETURN v_shared > 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.schedule_extended_day_counts(p_college uuid, p_version uuid, p_omit uuid DEFAULT NULL::uuid, p_extra jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(student_key text, days bigint)
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  WITH source AS (
    SELECT s.id,s.cohort_id,s.delivery_group_id,s.day_of_week,s.end_time
    FROM public.schedule_sessions s
    WHERE s.college_id=p_college AND s.schedule_version_id=p_version
      AND NOT coalesce(s.replaced_by_split,false) AND s.id IS DISTINCT FROM p_omit
    UNION ALL
    SELECT e.id,e.cohort_id,e.delivery_group_id,e.day_of_week,e.end_time
    FROM jsonb_to_record(p_extra) e(id uuid,cohort_id uuid,delivery_group_id uuid,day_of_week integer,end_time time)
    WHERE p_extra IS NOT NULL
  ), coverage AS (
    SELECT g.id,g.cohort_id,g.active,g.is_obsolete,
      g.expected_students > 0 AND count(p.id)>0 AND sum(p.headcount)=g.expected_students AS complete,
      array_agg(DISTINCT p.id::text) FILTER(WHERE p.id IS NOT NULL) AS keys
    FROM public.operational_delivery_groups g
    LEFT JOIN public.operational_group_members m ON m.delivery_group_id=g.id AND m.college_id=p_college
    LEFT JOIN public.cohort_student_partitions p ON p.id=m.partition_id AND p.college_id=p_college AND p.cohort_id=m.cohort_id AND p.active
    WHERE g.college_id=p_college GROUP BY g.id,g.cohort_id,g.active,g.is_obsolete,g.expected_students
  ), fallback AS (
    SELECT c.cohort_id FROM coverage c WHERE c.active IS DISTINCT FROM false AND NOT coalesce(c.is_obsolete,false) AND c.complete IS DISTINCT FROM true
    UNION
    SELECT s.cohort_id FROM source s LEFT JOIN coverage c ON c.id=s.delivery_group_id AND c.cohort_id=s.cohort_id WHERE c.complete IS DISTINCT FROM true
  ), expanded AS (
    SELECT s.day_of_week,unnest(CASE WHEN f.cohort_id IS NOT NULL OR c.complete IS DISTINCT FROM true
      THEN ARRAY['cohort:'||coalesce(s.cohort_id::text,'unknown')] ELSE c.keys END) AS key
    FROM source s
    LEFT JOIN coverage c ON c.id=s.delivery_group_id AND c.cohort_id=s.cohort_id
    LEFT JOIN fallback f ON f.cohort_id=s.cohort_id
    JOIN public.scheduling_settings settings ON settings.college_id=p_college
    WHERE s.end_time>settings.standard_day_end_time
  ) SELECT key,count(DISTINCT day_of_week) FROM expanded GROUP BY key;
$function$;

CREATE OR REPLACE FUNCTION public.schedule_extended_counts_for_rows(p_college uuid, p_rows jsonb)
 RETURNS TABLE(student_key text, days bigint)
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 WITH source AS (
 SELECT e.id,e.cohort_id,e.delivery_group_id,e.day_of_week,e.end_time
 FROM jsonb_to_recordset(p_rows) e(id uuid,cohort_id uuid,delivery_group_id uuid,day_of_week integer,end_time time,replaced_by_split boolean)
 WHERE NOT coalesce(e.replaced_by_split,false)
  ), coverage AS (
    SELECT g.id,g.cohort_id,g.active,g.is_obsolete,
      g.expected_students > 0 AND count(p.id)>0 AND sum(p.headcount)=g.expected_students AS complete,
      array_agg(DISTINCT p.id::text) FILTER(WHERE p.id IS NOT NULL) AS keys
    FROM public.operational_delivery_groups g
    LEFT JOIN public.operational_group_members m ON m.delivery_group_id=g.id AND m.college_id=p_college
    LEFT JOIN public.cohort_student_partitions p ON p.id=m.partition_id AND p.college_id=p_college AND p.cohort_id=m.cohort_id AND p.active
    WHERE g.college_id=p_college GROUP BY g.id,g.cohort_id,g.active,g.is_obsolete,g.expected_students
  ), fallback AS (
    SELECT c.cohort_id FROM coverage c WHERE c.active IS DISTINCT FROM false AND NOT coalesce(c.is_obsolete,false) AND c.complete IS DISTINCT FROM true
    UNION
    SELECT s.cohort_id FROM source s LEFT JOIN coverage c ON c.id=s.delivery_group_id AND c.cohort_id=s.cohort_id WHERE c.complete IS DISTINCT FROM true
  ), expanded AS (
    SELECT s.day_of_week,unnest(CASE WHEN f.cohort_id IS NOT NULL OR c.complete IS DISTINCT FROM true
      THEN ARRAY['cohort:'||coalesce(s.cohort_id::text,'unknown')] ELSE c.keys END) AS key
    FROM source s
    LEFT JOIN coverage c ON c.id=s.delivery_group_id AND c.cohort_id=s.cohort_id
    LEFT JOIN fallback f ON f.cohort_id=s.cohort_id
    JOIN public.scheduling_settings settings ON settings.college_id=p_college
    WHERE s.end_time>settings.standard_day_end_time
  ) SELECT key,count(DISTINCT day_of_week) FROM expanded GROUP BY key;
$function$;

CREATE OR REPLACE FUNCTION public.apply_schedule_relayout(p_college_id uuid, p_version_id uuid, p_operation_id uuid, p_expected_revision bigint, p_expected_version_updated_at timestamp with time zone, p_moves jsonb, p_day_cap integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_version public.schedule_versions%ROWTYPE;
  v_session public.schedule_sessions%ROWTYPE;
  v_receipt public.schedule_compaction_receipts%ROWTYPE;
  v_move jsonb;
  v_result jsonb;
  v_hash text;
  v_id uuid;
  v_before_rows jsonb;
  v_guard jsonb;
  v_assigned numeric;
  v_bundle jsonb;
  v_index integer := 0;
  v_count integer;
  v_term record;
  v_closure record;
  v_first_date date;
  v_last_date date;
BEGIN
  IF v_uid IS NULL OR NOT public.can_manage_college(v_uid, p_college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'applied', 0);
  END IF;
  IF p_operation_id IS NULL OR p_version_id IS NULL OR p_college_id IS NULL
     OR p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_expected_version_updated_at IS NULL
     OR p_day_cap IS NULL OR p_day_cap NOT BETWEEN 3 AND 5
     OR jsonb_typeof(p_moves) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST', 'applied', 0);
  END IF;
  v_count := jsonb_array_length(p_moves);
  IF v_count < 1 OR v_count > 512 OR octet_length(p_moves::text) > 1048576 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_BATCH_SIZE', 'applied', 0);
  END IF;
  IF (SELECT count(DISTINCT m->>'id') FROM jsonb_array_elements(p_moves) m) <> v_count THEN
    RETURN jsonb_build_object('ok',false,'code','DUPLICATE_SESSION','applied',0);
  END IF;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'mode','simultaneous','day_cap',p_day_cap,'college', p_college_id, 'version', p_version_id, 'revision', p_expected_revision,
    'updated_at', p_expected_version_updated_at, 'moves', p_moves
  )::text, 'UTF8')), 'hex');

  -- Existing writers can acquire a session/assignment before the version lock.
  -- Every potentially inverted lock here is nonblocking: reject instead of deadlocking.
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_version_id::text, 9174)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_BUSY', 'applied', 0);
  END IF;
  SELECT * INTO v_version FROM public.schedule_versions
  WHERE id = p_version_id AND college_id = p_college_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_NOT_FOUND', 'applied', 0);
  END IF;

  -- Check the receipt before staleness/status: a successful retry must not run twice.
  SELECT * INTO v_receipt FROM public.schedule_compaction_receipts
  WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF v_receipt.college_id = p_college_id AND v_receipt.schedule_version_id = p_version_id
       AND v_receipt.actor_id = v_uid AND v_receipt.request_hash = v_hash THEN
      RETURN v_receipt.result;
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'OPERATION_ID_CONFLICT', 'applied', 0);
  END IF;
  IF v_version.status IS DISTINCT FROM 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_LOCKED', 'applied', 0);
  END IF;
  IF v_version.eligibility_revision IS DISTINCT FROM p_expected_revision
     OR v_version.updated_at IS DISTINCT FROM p_expected_version_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STALE_SNAPSHOT', 'applied', 0);
  END IF;
  SELECT start_date,end_date INTO v_term FROM public.academic_terms
  WHERE id = v_version.academic_term_id AND college_id = p_college_id;

  -- Lock all affected sessions and assignments in a stable order before any mutation.
  FOR v_id IN SELECT DISTINCT (m->>'id')::uuid FROM jsonb_array_elements(p_moves) m
    ORDER BY 1 LOOP
    SELECT * INTO v_session FROM public.schedule_sessions
    WHERE id = v_id AND college_id = p_college_id AND schedule_version_id = p_version_id
    FOR UPDATE NOWAIT;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'SESSION_SCOPE_MISMATCH', 'applied', 0);
    END IF;
    IF COALESCE(v_session.is_locked, false) OR COALESCE(v_session.replaced_by_split, false) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'SESSION_LOCKED', 'applied', 0);
    END IF;
  END LOOP;
  FOR v_id IN SELECT DISTINCT s.teaching_assignment_id FROM public.schedule_sessions s
    WHERE s.id IN (SELECT (m->>'id')::uuid FROM jsonb_array_elements(p_moves) m)
      AND s.teaching_assignment_id IS NOT NULL ORDER BY 1 LOOP
    PERFORM 1 FROM public.teaching_assignments WHERE id = v_id FOR UPDATE NOWAIT;
  END LOOP;

  -- Every occurrence carries the timestamp from the original preview, even repeated moves.
  FOR v_move IN SELECT value FROM jsonb_array_elements(p_moves) LOOP
    SELECT * INTO v_session FROM public.schedule_sessions WHERE id = (v_move->>'id')::uuid;
    IF jsonb_typeof(v_move) IS DISTINCT FROM 'object'
       OR v_move->>'expected_updated_at' IS NULL
       OR v_session.updated_at IS DISTINCT FROM (v_move->>'expected_updated_at')::timestamptz THEN
      RETURN jsonb_build_object('ok', false, 'code', 'STALE_SESSION', 'applied', 0);
    END IF;
    IF (v_move->>'day_of_week')::integer NOT BETWEEN 0 AND 6
       OR (v_move->>'end_time')::time <= (v_move->>'start_time')::time
       OR v_move->>'start_time' IS NULL OR v_move->>'end_time' IS NULL
       OR v_move->>'room_id' IS NULL OR v_move->>'day_of_week' IS NULL
       OR (v_move->>'end_time')::time - (v_move->>'start_time')::time
          IS DISTINCT FROM v_session.end_time - v_session.start_time THEN
      RETURN jsonb_build_object('ok', false, 'code', 'DURATION_OR_TARGET_INVALID', 'applied', 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rooms r
      WHERE r.id = (v_move->>'room_id')::uuid AND r.college_id = p_college_id AND r.is_active) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'ROOM_SCOPE_MISMATCH', 'applied', 0);
    END IF;
    -- The legacy move collector does not inspect room_unavailability. Validate both
    -- weekly and date-bounded closures here before the ordered transaction starts.
    FOR v_closure IN SELECT * FROM public.room_unavailability ru
      WHERE ru.college_id = p_college_id AND ru.room_id = (v_move->>'room_id')::uuid
        AND (ru.day_of_week IS NULL OR ru.day_of_week = (v_move->>'day_of_week')::integer)
        AND COALESCE(ru.start_time,'00:00'::time) < (v_move->>'end_time')::time
        AND COALESCE(ru.end_time,'24:00'::time) > (v_move->>'start_time')::time
    LOOP
      IF v_closure.start_date IS NULL AND v_closure.end_date IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ROOM_CLOSED', 'applied', 0);
      END IF;
      IF v_term.start_date IS NULL OR v_term.end_date IS NULL OR v_term.end_date < v_term.start_date THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ROOM_CLOSURE_REQUIRES_TERM_DATES', 'applied', 0);
      END IF;
      v_first_date := greatest(v_term.start_date,COALESCE(v_closure.start_date,v_term.start_date));
      v_last_date := least(v_term.end_date,COALESCE(v_closure.end_date,v_term.end_date));
      IF v_first_date + (((v_move->>'day_of_week')::integer - extract(dow FROM v_first_date)::integer + 7) % 7)
         <= v_last_date THEN
        RETURN jsonb_build_object('ok', false, 'code', 'ROOM_CLOSED', 'applied', 0);
      END IF;
    END LOOP;
  END LOOP;

  SELECT jsonb_agg(to_jsonb(s)) INTO v_before_rows FROM public.schedule_sessions s
   WHERE s.id IN (SELECT (m->>'id')::uuid FROM jsonb_array_elements(p_moves) m);

  -- One UPDATE, retaining all lifecycle, scope and lock triggers. The extended-day
  -- statement guard sees the final state; every final placement is then revalidated.
  UPDATE public.schedule_sessions s SET day_of_week=m.day_of_week,start_time=m.start_time,end_time=m.end_time,room_id=m.room_id
  FROM jsonb_to_recordset(p_moves) m(id uuid,day_of_week integer,start_time time,end_time time,room_id uuid)
  WHERE s.id=m.id AND s.college_id=p_college_id AND s.schedule_version_id=p_version_id;
  GET DIAGNOSTICS v_index = ROW_COUNT;
  IF v_index <> v_count THEN RAISE EXCEPTION 'INCOMPLETE_BATCH' USING ERRCODE='P7501'; END IF;

  FOR v_session IN SELECT * FROM public.schedule_sessions WHERE college_id=p_college_id
    AND schedule_version_id=p_version_id AND NOT coalesce(replaced_by_split,false) LOOP
    IF v_session.teaching_assignment_id IS NOT NULL THEN
      v_guard := public._sb_v2_assignment_guard(v_session.teaching_assignment_id);
      IF coalesce((v_guard->>'is_v2')::boolean,false) THEN
        IF NOT coalesce((v_guard->>'ok')::boolean,false) THEN
          v_result:=jsonb_build_object('code','ASSIGNMENT_BLOCKED'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
        END IF;
        SELECT coalesce(a.assigned_component_hours,c.weekly_contact_hours,0) INTO v_assigned
         FROM public.teaching_assignments a LEFT JOIN public.plan_course_components c ON c.id=a.plan_course_component_id WHERE a.id=v_session.teaching_assignment_id;
        IF public._sb_v2_scheduled_hours_for_assignment(p_version_id,v_session.teaching_assignment_id,NULL)>v_assigned THEN
          v_result:=jsonb_build_object('code','OVER_SCHEDULED'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
        END IF;
      END IF;
    END IF;
    v_bundle:=public._collect_schedule_session_move_conflicts(v_session.id,p_college_id,p_version_id,v_session.instructor_id,
     v_session.section_id,v_session.course_offering_id,v_session.teaching_assignment_id,v_session.study_system,v_session.expected_students,
     v_session.day_of_week,v_session.start_time,v_session.end_time,v_session.room_id);
    IF coalesce(jsonb_array_length(v_bundle->'blocking_conflicts'),0)>0 OR coalesce(jsonb_array_length(v_bundle->'warnings'),0)>0
      OR jsonb_array_length(public._sb_v2_delivery_group_overlap(p_version_id,v_session.delivery_group_id,v_session.cohort_id,
       v_session.day_of_week,v_session.start_time,v_session.end_time,v_session.id))>0 THEN
      v_result:=jsonb_build_object('code','FINAL_STATE_CONFLICT'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.schedule_sessions s LEFT JOIN public.shared_lecture_group_ids(s.delivery_group_id) shared ON true
     LEFT JOIN public.delivery_groups source_group ON source_group.id=shared.group_id
     JOIN public.academic_cohorts c ON c.id=COALESCE(source_group.cohort_id,s.cohort_id)
    WHERE s.college_id=p_college_id AND s.schedule_version_id=p_version_id AND NOT coalesce(s.replaced_by_split,false)
    GROUP BY c.program_id,c.level_id,c.study_system,c.term_id HAVING count(DISTINCT s.day_of_week)>p_day_cap) THEN
    v_result:=jsonb_build_object('code','ATTENDANCE_DAY_LIMIT'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.schedule_extended_day_counts(p_college_id,p_version_id) e
    JOIN public.scheduling_settings cfg ON cfg.college_id=p_college_id
    WHERE cfg.extended_day_policy_enabled AND e.days>cfg.max_extended_days_per_partition) THEN
    v_result:=jsonb_build_object('code','PARTITION_EXTENDED_DAY_LIMIT'); RAISE EXCEPTION 'RELAYOUT_REJECTED' USING ERRCODE='P7501';
  END IF;
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
   SELECT v_uid,'simultaneous_reschedule','schedule_sessions',s.id,p_college_id,
    jsonb_build_object('operation_id',p_operation_id,'before',b,'after',to_jsonb(s))
   FROM jsonb_array_elements(v_before_rows) b JOIN public.schedule_sessions s ON s.id=(b->>'id')::uuid;

  v_result := jsonb_build_object('ok', true, 'code', 'SAVED', 'applied', v_count,
    'operation_id', p_operation_id);
  INSERT INTO public.schedule_compaction_receipts
    (operation_id,college_id,schedule_version_id,actor_id,request_hash,result)
  VALUES (p_operation_id,p_college_id,p_version_id,v_uid,v_hash,v_result);
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
  VALUES (v_uid,'simultaneous_relayout','schedule_versions',p_version_id,p_college_id,
    jsonb_build_object('operation_id',p_operation_id,'moves',v_count,'request_hash',v_hash));
  RETURN v_result;
EXCEPTION
  -- This handler covers the entire write block. PostgreSQL rolls back moves, revision
  -- increments, per-move audits and the receipt before returning applied=0.
  WHEN SQLSTATE 'P7501' THEN
    RETURN jsonb_build_object('ok', false, 'code', COALESCE(v_result->>'code','MOVE_REJECTED'),
      'applied', 0, 'failed_move', v_index);
  WHEN lock_not_available OR deadlock_detected OR serialization_failure THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VERSION_BUSY', 'applied', 0);
  WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST', 'applied', 0);
  WHEN OTHERS THEN
    -- Do not expose table names, identifiers from other tenants, or raw SQL errors.
    RETURN jsonb_build_object('ok', false, 'code', 'BATCH_FAILED', 'applied', 0);
END;
$function$;

NOTIFY pgrst,'reload schema';

COMMIT;

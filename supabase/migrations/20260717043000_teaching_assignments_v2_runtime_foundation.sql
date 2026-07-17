-- PHASE-9.4: Teaching Assignments V2 runtime foundation
-- SOURCE ONLY — CREATED / NOT APPLIED. Do not auto-apply.
-- Additive lifecycle + RPCs + indexes only. No backfill. No generator invoke. No session creation. No seed.
-- Auth: SECURITY DEFINER with auth.uid + can_view/manage_college (college derived from delivery_group/cohort).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Lifecycle: soft active flag (no hard status machine)
-- ---------------------------------------------------------------------------
ALTER TABLE public.teaching_assignments
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.teaching_assignments.is_active IS
  'PHASE-9.4 V2 lifecycle. true = active assignment (workload + new sessions). false = soft-deactivated history. No hard delete when linked.';

CREATE INDEX IF NOT EXISTS ta_v2_active_delivery_group_idx
  ON public.teaching_assignments (delivery_group_id)
  WHERE delivery_group_id IS NOT NULL AND is_active = TRUE;

-- Active-only natural uniqueness for V2 (allows reactivation of same group+instructor)
DROP INDEX IF EXISTS ta_v2_delivery_group_instructor_uniq;
CREATE UNIQUE INDEX ta_v2_delivery_group_instructor_uniq
  ON public.teaching_assignments (college_id, delivery_group_id, instructor_id)
  WHERE delivery_group_id IS NOT NULL AND is_active = TRUE;

-- ---------------------------------------------------------------------------
-- 2) Block hard delete when linked to schedule sessions
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_ta_hard_delete_when_linked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.schedule_sessions ss
    WHERE ss.teaching_assignment_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'ASSIGNMENT_HARD_DELETE_FORBIDDEN_LINKED_SESSION'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_ta_prevent_hard_delete ON public.teaching_assignments;
CREATE TRIGGER trg_ta_prevent_hard_delete
  BEFORE DELETE ON public.teaching_assignments
  FOR EACH ROW EXECUTE FUNCTION public.prevent_ta_hard_delete_when_linked();

-- ---------------------------------------------------------------------------
-- 3) Extend ensure_ta_college: active-only co-teach math; obsolete only blocks active;
--    session-linked instructor/group change forbidden
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_ta_college()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
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
    FROM public.delivery_groups dg
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

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4) Workload view: active V2 assignments only
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_instructor_delivery_workload;

CREATE VIEW public.v_instructor_delivery_workload
WITH (security_invoker = true)
AS
SELECT
  ta.college_id,
  ta.instructor_id,
  i.academic_rank,
  ta.cohort_id,
  ac.term_id,
  SUM(
    CASE
      WHEN pcc.component_type = 'summer_training' THEN 0
      WHEN pcc.component_type = 'project' OR COALESCE(dg.excluded_from_standard_workload, false)
           OR COALESCE(pcc.counts_toward_regular_load, true) = false THEN 0
      WHEN (
        SELECT COUNT(*)::integer FROM public.teaching_assignments ta2
        WHERE ta2.delivery_group_id = ta.delivery_group_id
          AND ta2.delivery_group_id IS NOT NULL
          AND ta2.is_active = TRUE
      ) > 1
      THEN COALESCE(ta.assigned_component_hours, 0)
      ELSE COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0)
    END
  )::numeric AS standard_assigned_hours,
  SUM(
    CASE
      WHEN pcc.component_type = 'project' THEN
        CASE
          WHEN (
            SELECT COUNT(*)::integer FROM public.teaching_assignments ta2
            WHERE ta2.delivery_group_id = ta.delivery_group_id
              AND ta2.delivery_group_id IS NOT NULL
              AND ta2.is_active = TRUE
          ) > 1 THEN COALESCE(ta.assigned_component_hours, 0)
          ELSE COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0)
        END
      ELSE 0
    END
  )::numeric AS project_supervision_hours
FROM public.teaching_assignments ta
JOIN public.instructors i ON i.id = ta.instructor_id
LEFT JOIN public.delivery_groups dg ON dg.id = ta.delivery_group_id
LEFT JOIN public.plan_course_components pcc
  ON pcc.id = COALESCE(ta.plan_course_component_id, dg.component_id)
LEFT JOIN public.academic_cohorts ac ON ac.id = COALESCE(ta.cohort_id, dg.cohort_id)
WHERE ta.delivery_group_id IS NOT NULL
  AND ta.is_active = TRUE
GROUP BY ta.college_id, ta.instructor_id, i.academic_rank, ta.cohort_id, ac.term_id;

REVOKE ALL ON public.v_instructor_delivery_workload FROM PUBLIC, anon;
GRANT SELECT ON public.v_instructor_delivery_workload TO authenticated, service_role;

COMMENT ON VIEW public.v_instructor_delivery_workload IS
  'PHASE-9.4: active delivery-group assignments only. security_invoker=true. Ignores legacy weekly_hours DEFAULT 3.';

-- ---------------------------------------------------------------------------
-- 5) Allocation helper (pure JSON for workspace rows)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_delivery_group_allocation(p_delivery_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = p_delivery_group_id;
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
$$;

REVOKE ALL ON FUNCTION public.compute_delivery_group_allocation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_delivery_group_allocation(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6) list_teaching_assignment_workspace
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_teaching_assignment_workspace(
  p_college_id uuid,
  p_program_id uuid DEFAULT NULL,
  p_level_id uuid DEFAULT NULL,
  p_term_id uuid DEFAULT NULL,
  p_study_system text DEFAULT NULL,
  p_cohort_id uuid DEFAULT NULL,
  p_component_type text DEFAULT NULL,
  p_assignment_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
        'cohort_code', ac.code,
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
    FROM public.delivery_groups dg
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
      AND (p_cohort_id IS NULL OR dg.cohort_id = p_cohort_id)
      AND (p_program_id IS NULL OR ac.program_id = p_program_id)
      AND (p_level_id IS NULL OR ac.level_id = p_level_id)
      AND (p_term_id IS NULL OR ac.term_id = p_term_id)
      AND (p_study_system IS NULL OR ac.study_system = p_study_system)
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
$$;

REVOKE ALL ON FUNCTION public.list_teaching_assignment_workspace(uuid, uuid, uuid, uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_teaching_assignment_workspace(uuid, uuid, uuid, uuid, text, uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_teaching_assignment_workspace(uuid, uuid, uuid, uuid, text, uuid, text, text) IS
  'PHASE-9.4 read workspace for delivery-group assignments. can_view_college. Excludes summer_training. Minimal PII.';

-- ---------------------------------------------------------------------------
-- 7) get_delivery_group_assignment_candidates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_delivery_group_assignment_candidates(
  p_delivery_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = p_delivery_group_id;
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
$$;

REVOKE ALL ON FUNCTION public.get_delivery_group_assignment_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_delivery_group_assignment_candidates(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8) preview_instructor_workload_after_assignment (read-only, no DML)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.preview_instructor_workload_after_assignment(
  p_instructor_id uuid,
  p_delivery_group_id uuid,
  p_assigned_component_hours numeric DEFAULT NULL,
  p_assignment_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = p_delivery_group_id;
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

  v_is_project := v_pcc.component_type = 'project'
    OR COALESCE(v_dg.excluded_from_standard_workload, false)
    OR COALESCE(v_pcc.counts_toward_regular_load, true) = false;

  IF p_assignment_id IS NOT NULL THEN
    SELECT
      CASE
        WHEN pcc.component_type = 'summer_training' THEN 0
        WHEN pcc.component_type = 'project' OR COALESCE(dg.excluded_from_standard_workload, false)
          OR COALESCE(pcc.counts_toward_regular_load, true) = false THEN 0
        WHEN (
          SELECT COUNT(*) FROM public.teaching_assignments ta2
          WHERE ta2.delivery_group_id = ta.delivery_group_id AND ta2.is_active = TRUE
        ) > 1 THEN COALESCE(ta.assigned_component_hours, 0)
        ELSE COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0)
      END,
      CASE
        WHEN pcc.component_type = 'project' THEN
          CASE WHEN (
            SELECT COUNT(*) FROM public.teaching_assignments ta2
            WHERE ta2.delivery_group_id = ta.delivery_group_id AND ta2.is_active = TRUE
          ) > 1 THEN COALESCE(ta.assigned_component_hours, 0)
          ELSE COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) END
        ELSE 0
      END
    INTO v_old_std, v_old_proj
    FROM public.teaching_assignments ta
    JOIN public.delivery_groups dg ON dg.id = ta.delivery_group_id
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
$$;

REVOKE ALL ON FUNCTION public.preview_instructor_workload_after_assignment(uuid, uuid, numeric, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_instructor_workload_after_assignment(uuid, uuid, numeric, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.preview_instructor_workload_after_assignment(uuid, uuid, numeric, uuid) IS
  'PHASE-9.4 read-only workload impact preview. No DML. Uses compute_instructor_standard_workload. Overload = warning only.';

-- ---------------------------------------------------------------------------
-- 9) Resolve compatibility offering for a delivery group (internal-only)
-- SECURITY INVOKER + revoke client EXECUTE. Called only from gated DEFINER RPCs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_offering_for_delivery_group(p_delivery_group_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_dg public.delivery_groups%ROWTYPE;
  v_cohort public.academic_cohorts%ROWTYPE;
  v_offering_id uuid;
BEGIN
  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = p_delivery_group_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_cohort FROM public.academic_cohorts WHERE id = v_dg.cohort_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT co.id INTO v_offering_id
  FROM public.course_offerings co
  WHERE co.college_id = v_dg.college_id
    AND co.plan_course_id = v_dg.plan_course_id
    AND co.term_id = v_cohort.term_id
    AND COALESCE(co.program_id, v_cohort.program_id) = v_cohort.program_id
    AND COALESCE(co.level_id, v_cohort.level_id) = v_cohort.level_id
    AND co.study_system = v_cohort.study_system
    AND COALESCE(co.is_active, true) = true
  ORDER BY co.created_at DESC NULLS LAST, co.id ASC
  LIMIT 1;

  RETURN v_offering_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_offering_for_delivery_group(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_offering_for_delivery_group(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_offering_for_delivery_group(uuid) FROM authenticated;
-- Intentionally no GRANT to authenticated — internal helper for DEFINER RPCs only.

-- ---------------------------------------------------------------------------
-- 9b) Internal validation / locking helpers (not client-executable)
-- Lock order (all write RPCs):
--   1) delivery_group FOR UPDATE
--   2) active teaching_assignments for that group ORDER BY id FOR UPDATE
--   3) target assignment row FOR UPDATE (update/deactivate)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_delivery_group_assignable(
  p_is_obsolete boolean,
  p_active boolean
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(p_is_obsolete, false) THEN
    RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;
  IF COALESCE(p_active, true) = false THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_delivery_group_assignable(boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_delivery_group_assignable(boolean, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.assert_delivery_group_assignable(boolean, boolean) FROM authenticated;

CREATE OR REPLACE FUNCTION public.lock_delivery_group_for_assignment(p_delivery_group_id uuid)
RETURNS public.delivery_groups
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
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

  RETURN v_dg;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_delivery_group_for_assignment(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lock_delivery_group_for_assignment(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.lock_delivery_group_for_assignment(uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.validate_assignment_allocation_locked(
  p_delivery_group_id uuid,
  p_exclude_assignment_id uuid,
  p_new_hours numeric,
  p_component_hours numeric,
  p_include_new_row boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_co_count integer;
  v_null_split_count integer;
  v_sum_assigned numeric;
BEGIN
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
    AND ta.is_active = TRUE;

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
$$;

REVOKE ALL ON FUNCTION public.validate_assignment_allocation_locked(uuid, uuid, numeric, numeric, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_assignment_allocation_locked(uuid, uuid, numeric, numeric, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.validate_assignment_allocation_locked(uuid, uuid, numeric, numeric, boolean) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 10) create_teaching_assignment_v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_teaching_assignment_v2(
  p_delivery_group_id uuid,
  p_instructor_id uuid,
  p_assigned_component_hours numeric DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF v_instructor.college_id <> v_dg.college_id THEN
    RAISE EXCEPTION 'ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;

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
$$;

REVOKE ALL ON FUNCTION public.create_teaching_assignment_v2(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_teaching_assignment_v2(uuid, uuid, numeric, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.create_teaching_assignment_v2(uuid, uuid, numeric, text) IS
  'PHASE-9.4 create or reactivate V2 assignment. College from delivery_group. Locks group. Audit. No sessions.';

-- ---------------------------------------------------------------------------
-- 11) update_teaching_assignment_v2 (hours/notes; optimistic concurrency)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_teaching_assignment_v2(
  p_assignment_id uuid,
  p_expected_updated_at timestamptz,
  p_assigned_component_hours numeric DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.update_teaching_assignment_v2(uuid, timestamptz, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_teaching_assignment_v2(uuid, timestamptz, numeric, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12) deactivate_teaching_assignment_v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deactivate_teaching_assignment_v2(
  p_assignment_id uuid,
  p_expected_updated_at timestamptz,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.teaching_assignments%ROWTYPE;
  v_pcc_type text;
  v_old_hours numeric;
  v_dg_id uuid;
  v_college_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;
  IF p_assignment_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'ASSIGNMENT_ID_AND_EXPECTED_UPDATED_AT_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

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

  -- Lock group even for deactivate (consistent order); assignable not required
  PERFORM public.lock_delivery_group_for_assignment(v_dg_id);

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
    RETURN jsonb_build_object(
      'ok', true,
      'action', 'already_inactive',
      'assignment_id', v_row.id,
      'is_active', false,
      'updated_at', v_row.updated_at
    );
  END IF;

  v_old_hours := v_row.assigned_component_hours;
  SELECT pcc.component_type INTO v_pcc_type
  FROM public.plan_course_components pcc
  WHERE pcc.id = v_row.plan_course_component_id;

  UPDATE public.teaching_assignments SET
    is_active = FALSE,
    notes = CASE
      WHEN p_reason IS NULL OR btrim(p_reason) = '' THEN notes
      WHEN notes IS NULL OR btrim(notes) = '' THEN 'deactivate: ' || btrim(p_reason)
      ELSE notes
    END
  WHERE id = p_assignment_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    'teaching_assignment_deactivated',
    'teaching_assignments',
    v_row.id,
    v_row.college_id,
    jsonb_build_object(
      'assignment_id', v_row.id,
      'delivery_group_id', v_row.delivery_group_id,
      'instructor_id', v_row.instructor_id,
      'component_type', v_pcc_type,
      'old_assigned_hours', v_old_hours,
      'new_assigned_hours', v_old_hours,
      'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'deactivated',
    'assignment_id', v_row.id,
    'is_active', false,
    'updated_at', v_row.updated_at,
    'allocation', public.compute_delivery_group_allocation(v_row.delivery_group_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.deactivate_teaching_assignment_v2(uuid, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_teaching_assignment_v2(uuid, timestamptz, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.deactivate_teaching_assignment_v2(uuid, timestamptz, text) IS
  'PHASE-9.4 soft deactivate. Preserves history. Optimistic concurrency. Audit. No hard delete.';

-- ---------------------------------------------------------------------------
-- 13) ensure_ss_college — preserve Phase 9.3 checks + inactive assignment guard
-- Applied only on INSERT or when teaching_assignment_id / delivery_group_id change.
-- Historical sessions with unrelated UPDATEs remain untouched.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_ss_college()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
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
  dg_college uuid;
  dg_obsolete boolean;
  dg_active boolean;
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
    SELECT ta.college_id, ta.is_active, ta.delivery_group_id
      INTO tac, ta_active, ta_dg
    FROM public.teaching_assignments ta
    WHERE ta.id = NEW.teaching_assignment_id;
    IF tac IS NULL OR tac <> NEW.college_id THEN
      RAISE EXCEPTION 'teaching_assignment/college mismatch';
    END IF;
    IF v_ta_link_changing AND COALESCE(ta_active, true) = false THEN
      RAISE EXCEPTION 'INACTIVE_ASSIGNMENT_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF v_ta_link_changing AND ta_dg IS NOT NULL THEN
      SELECT dg.college_id, dg.is_obsolete, dg.active
        INTO dg_college, dg_obsolete, dg_active
      FROM public.delivery_groups dg
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
    END IF;
  END IF;

  IF NEW.delivery_group_id IS NOT NULL THEN
    SELECT dg.college_id, dg.is_obsolete, dg.active
      INTO dg_college, dg_obsolete, dg_active
    FROM public.delivery_groups dg
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
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_ss_college() IS
  'PHASE-9.4: college integrity + obsolete/inactive delivery_group + inactive teaching_assignment guards for new/changed session links. Historical unrelated updates preserved.';

-- ---------------------------------------------------------------------------
-- 14) Atomic import batch RPC (import-only; not a general bulk UI API)
-- Pre-validates all rows before first DML. Locks delivery_groups in id ASC order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_teaching_assignments_v2_import(
  p_rows jsonb,
  p_mode text DEFAULT 'upsert'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    SELECT * INTO v_dg FROM public.delivery_groups WHERE id = v_dg_id;
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

    SELECT * INTO v_dg FROM public.delivery_groups WHERE id = v_dg_id;
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
      -- inactive row with no existing active match → skip (no create of inactive)
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
$$;

REVOKE ALL ON FUNCTION public.commit_teaching_assignments_v2_import(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_teaching_assignments_v2_import(jsonb, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.commit_teaching_assignments_v2_import(jsonb, text) IS
  'PHASE-9.4 atomic teaching_assignments_v2 Excel import. Pre-validate then lock DGs ASC. Per-row audit. No sessions. No client direct DML.';

COMMIT;

-- SOURCE_ONLY_INSTITUTIONAL_VIEWER_RBAC_01 — proposed migration 3 of 3
-- STATUS: NOT APPLIED. File-of-record for review only. When approved, this SQL
-- must be submitted through the platform migration tool (it writes the real
-- supabase/migrations file); do not hand-copy it into supabase/migrations.
--
-- SCOPE CORRECTION (security review): the earlier draft attached a generic
-- BEFORE INSERT/UPDATE/DELETE trigger to every persistent table in `public`.
-- That was broader than necessary. A live catalog audit of all 175 write
-- policies in `public` showed every one of them is already gated by
-- can_manage_college(...) or is_super_admin(...) — except exactly three that a
-- plain authenticated user can satisfy on their own row:
--     profiles.prof_insert  (INSERT, id = auth.uid())
--     profiles.prof_update  (UPDATE, id = auth.uid())
--     audit_logs.al_insert  (INSERT, actor_id = auth.uid())
-- Those three are therefore the ONLY write surfaces this migration touches.
-- No generic trigger, no DO loop, no change to any other write policy.
--
-- Approved decisions implemented here:
--   (1) institutional_viewer reaches ZERO writes. Achieved by excluding the
--       read-only actor from the three self-service write policies above.
--       MULTI-ROLE SAFETY: the exclusion uses
--       is_institutional_read_only_actor(), which is TRUE only for a user who
--       carries institutional_viewer AND carries neither super_admin nor
--       college_admin. Anyone holding an administrative role keeps their exact
--       current behaviour. This predicate mirrors isInstitutionalReadOnlyViewer()
--       in src/lib/unauthorized-access.ts.
--   (2) institutional_viewer may execute ONLY RPCs proven side-effect free.
--       Read-only allowlist (verified against the live catalog: zero
--       INSERT/UPDATE/DELETE/TRUNCATE in the body, authorisation through
--       can_view_college):
--         - public.resolve_scheduling_headcount(uuid, uuid, uuid, uuid, uuid)
--         - public.list_scheduling_headcount_revisions(uuid)
--         - public.compute_instructor_standard_workload(uuid, uuid)
--         - public.get_delivery_group_assignment_candidates(uuid)
--         - public.list_schedule_builder_v2_work_items(uuid, uuid, uuid, uuid, text, text, uuid, text)
--         - public.list_teaching_assignment_workspace(uuid, uuid, uuid, uuid, text, uuid, text, text)
--       The last four are re-created below verbatim from their current live
--       definitions with the SMALLEST possible change: the read gate also
--       accepts is_institutional_read_only_actor(auth.uid()). Write-affordance
--       flags in their returned payloads ('can_manage', 'assignable') keep
--       calling can_manage_college unchanged, so the UI still shows no edit
--       controls. Every other volatile RPC is gated by can_manage_college,
--       is_super_admin, or import_manager_actor (which calls
--       can_manage_college) and stays denied — including
--       validate_schedule_session_move and begin_schedule_quality_snapshot,
--       which stay denied on purpose as preflight steps of a mutating action.
--
-- can_manage_college is NOT modified by this migration.

-- 1. Read-only actor predicate (multi-role safe) ------------------------------
CREATE OR REPLACE FUNCTION public.is_institutional_read_only_actor(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT _user_id IS NOT NULL
     AND public.has_role(_user_id, 'institutional_viewer'::public.app_role)
     AND NOT public.is_super_admin(_user_id)
     AND NOT public.has_role(_user_id, 'college_admin'::public.app_role);
$function$;

REVOKE ALL ON FUNCTION public.is_institutional_read_only_actor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_institutional_read_only_actor(uuid) TO authenticated, service_role;

-- 2. The only three self-service write policies, re-created with the exclusion
--    Existing conditions are preserved verbatim; the new term is additive.
DROP POLICY IF EXISTS prof_insert ON public.profiles;
CREATE POLICY prof_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    ((id = auth.uid()) OR public.is_super_admin(auth.uid()))
    AND NOT public.is_institutional_read_only_actor(auth.uid())
  );

DROP POLICY IF EXISTS prof_update ON public.profiles;
CREATE POLICY prof_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    ((id = auth.uid()) OR public.is_super_admin(auth.uid()))
    AND NOT public.is_institutional_read_only_actor(auth.uid())
  )
  WITH CHECK (
    ((id = auth.uid()) OR public.is_super_admin(auth.uid()))
    AND NOT public.is_institutional_read_only_actor(auth.uid())
  );

DROP POLICY IF EXISTS al_insert ON public.audit_logs;
CREATE POLICY al_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    (actor_id = auth.uid())
    AND (NOT public.is_institutional_viewer(auth.uid()))
    AND NOT public.is_institutional_read_only_actor(auth.uid())
  );

-- al_select and every other SELECT policy are intentionally left untouched.

-- 3. Read-only RPCs: keep anon out, keep authenticated EXECUTE ----------------
REVOKE ALL ON FUNCTION public.resolve_scheduling_headcount(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_scheduling_headcount(uuid, uuid, uuid, uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_scheduling_headcount_revisions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_scheduling_headcount_revisions(uuid) TO authenticated, service_role;

-- 4. Read-only RPCs re-created with the widened READ gate only ----------------
--    Bodies are the current live definitions; the only edit is the gate.

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
    OR public.is_institutional_read_only_actor(v_uid)
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

  SELECT * INTO v_dg FROM public.delivery_groups WHERE id = p_delivery_group_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (
    public.can_view_college(v_uid, v_dg.college_id)
    OR public.can_manage_college(v_uid, v_dg.college_id)
    OR public.is_institutional_read_only_actor(v_uid)
  ) THEN
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
    -- write affordance stays strictly can_manage_college
    'assignable', NOT COALESCE(v_dg.is_obsolete, false)
      AND COALESCE(v_dg.active, true)
      AND COALESCE(v_pcc.component_type, '') IS DISTINCT FROM 'summer_training'
      AND public.can_manage_college(v_uid, v_dg.college_id)
  );
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
  IF NOT (
    public.can_view_college(v_uid, v_version.college_id)
    OR public.can_manage_college(v_uid, v_version.college_id)
    OR public.is_institutional_read_only_actor(v_uid)
  ) THEN
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
        'cohort_code', ac.code,
        'program_id', ac.program_id,
        'level_id', ac.level_id,
        'semester_term_id', ac.term_id,
        'study_system', ac.study_system,
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
        'is_project', (pcc.component_type = 'project'),
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
    JOIN public.delivery_groups dg
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
          WHEN pcc.component_type = 'project' THEN 'blocked'
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
          WHEN pcc.component_type = 'project' THEN 'PROJECT_NON_WEEKLY'
          WHEN sched.scheduled_hours > COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN 'OVER_SCHEDULED'
          ELSE NULL
        END AS blocking_reason,
        CASE
          WHEN COALESCE(ta.is_active, true) = false THEN false
          WHEN COALESCE(dg.active, true) = false THEN false
          WHEN COALESCE(dg.is_obsolete, false) THEN false
          WHEN pcc.component_type IN ('summer_training', 'project') THEN false
          WHEN sched.scheduled_hours >= COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0) THEN false
          ELSE true
        END AS can_create_session
    ) status
    WHERE ta.college_id = v_version.college_id
      AND ta.delivery_group_id IS NOT NULL
      AND ac.term_id = v_version.academic_term_id
      AND (p_cohort_id IS NULL OR ac.id = p_cohort_id)
      AND (p_program_id IS NULL OR ac.program_id = p_program_id)
      AND (p_level_id IS NULL OR ac.level_id = p_level_id)
      AND (p_study_system IS NULL OR ac.study_system = p_study_system)
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
    -- write affordance stays strictly can_manage_college
    'can_manage', public.can_manage_college(v_uid, v_version.college_id)
  );
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
  IF NOT (
    public.can_view_college(v_uid, p_college_id)
    OR public.can_manage_college(v_uid, p_college_id)
    OR public.is_institutional_read_only_actor(v_uid)
  ) THEN
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
    -- write affordance stays strictly can_manage_college
    'can_manage', public.can_manage_college(v_uid, p_college_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.compute_instructor_standard_workload(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_instructor_standard_workload(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_delivery_group_assignment_candidates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_delivery_group_assignment_candidates(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_schedule_builder_v2_work_items(uuid, uuid, uuid, uuid, text, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_schedule_builder_v2_work_items(uuid, uuid, uuid, uuid, text, text, uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_teaching_assignment_workspace(uuid, uuid, uuid, uuid, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_teaching_assignment_workspace(uuid, uuid, uuid, uuid, text, uuid, text, text) TO authenticated, service_role;

-- ROLLBACK ------------------------------------------------------------------
-- -- a) restore the three write policies to their pre-migration definitions
-- DROP POLICY IF EXISTS prof_insert ON public.profiles;
-- CREATE POLICY prof_insert ON public.profiles FOR INSERT TO authenticated
--   WITH CHECK ((id = auth.uid()) OR is_super_admin(auth.uid()));
-- DROP POLICY IF EXISTS prof_update ON public.profiles;
-- CREATE POLICY prof_update ON public.profiles FOR UPDATE TO authenticated
--   USING ((id = auth.uid()) OR is_super_admin(auth.uid()))
--   WITH CHECK ((id = auth.uid()) OR is_super_admin(auth.uid()));
-- DROP POLICY IF EXISTS al_insert ON public.audit_logs;
-- CREATE POLICY al_insert ON public.audit_logs FOR INSERT TO authenticated
--   WITH CHECK ((actor_id = auth.uid()) AND (NOT is_institutional_viewer(auth.uid())));
-- -- b) re-create the four read RPCs above without the
-- --    `OR public.is_institutional_read_only_actor(v_uid)` term in their gate.
-- -- c) only after (a) and (b) no longer reference it, drop the helper:
-- DROP FUNCTION IF EXISTS public.is_institutional_read_only_actor(uuid);

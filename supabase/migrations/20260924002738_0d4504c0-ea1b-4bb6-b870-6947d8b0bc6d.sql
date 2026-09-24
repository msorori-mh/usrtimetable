-- Draft-only orphan assignment repair. Historical (published/archived/review) sessions stay on the old row.
-- Function definitions only; no data is rewritten by this migration.

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
  -- Narrow exception: deactivate (true->false) an orphan whose instructor row is gone.
  -- No other column may change; linked sessions are not touched.
  IF TG_OP = 'UPDATE'
     AND OLD.is_active = true AND NEW.is_active = false
     AND NOT EXISTS (SELECT 1 FROM public.instructors WHERE id = OLD.instructor_id)
     AND (to_jsonb(NEW) - 'is_active' - 'updated_at') = (to_jsonb(OLD) - 'is_active' - 'updated_at') THEN
    RETURN NEW;
  END IF;

  SELECT college_id, plan_course_id, term_id, program_id, level_id, study_system
    INTO oc, co_plan_course, co_term, co_program, co_level, co_study_system
  FROM public.course_offerings WHERE id = NEW.course_offering_id;
  co_college := oc;

  SELECT college_id INTO ic FROM public.instructors WHERE id = NEW.instructor_id;
  IF oc IS NULL OR ic IS NULL OR oc <> NEW.college_id THEN -- CROSS-COLLEGE-01: instructor may belong to another college
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

    IF (co_plan_course IS NULL OR co_plan_course IS DISTINCT FROM dg_plan_course)
 AND NOT (public.existing_schedule_intake_enabled(NEW.college_id,co_term)
 AND EXISTS(SELECT 1 FROM public.plan_courses pc JOIN public.course_offerings o ON o.course_id=pc.course_id
 WHERE pc.id=dg_plan_course AND pc.college_id=NEW.college_id AND o.id=NEW.course_offering_id AND o.college_id=NEW.college_id)) THEN
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

      IF v_co_count > 1 AND v_null_split_count > 0 AND NOT public.existing_schedule_intake_enabled(NEW.college_id,co_term) THEN
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

CREATE OR REPLACE FUNCTION faculty_private.apply_create_assignment(
  p_delivery_group_id uuid,
  p_instructor_id uuid,
  p_assigned_component_hours numeric DEFAULT NULL::numeric,
  p_notes text DEFAULT NULL::text
)
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
$function$;
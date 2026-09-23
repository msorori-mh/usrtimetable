-- Repair an active V2 assignment whose instructor row no longer exists by
-- reusing the assignment row. Reusing the row preserves schedule_sessions
-- that reference teaching_assignments.id.

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
  WHERE ta.delivery_group_id = p_delivery_group_id
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
    WHERE ta.delivery_group_id = p_delivery_group_id
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
    UPDATE public.teaching_assignments SET
      instructor_id = p_instructor_id,
      assigned_component_hours = p_assigned_component_hours,
      weekly_hours = v_effective_hours,
      notes = COALESCE(p_notes, notes),
      course_offering_id = v_offering_id,
      cohort_id = v_dg.cohort_id,
      plan_course_component_id = v_dg.component_id,
      session_type = v_session_type,
      expected_students = COALESCE(v_dg.expected_students, expected_students),
      updated_at = now()
    WHERE id = v_orphan.id
    RETURNING * INTO v_row;
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
$function$;

-- Stop the same invisible-orphan state from being created again.
CREATE OR REPLACE FUNCTION public.prevent_active_assignment_instructor_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.teaching_assignments ta
    WHERE ta.instructor_id = OLD.id
      AND ta.is_active = true
  ) THEN
    RAISE EXCEPTION 'INSTRUCTOR_HAS_ACTIVE_TEACHING_ASSIGNMENTS'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.prevent_active_assignment_instructor_delete()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_prevent_active_assignment_instructor_delete
ON public.instructors;
CREATE TRIGGER zz_prevent_active_assignment_instructor_delete
BEFORE DELETE ON public.instructors
FOR EACH ROW
EXECUTE FUNCTION public.prevent_active_assignment_instructor_delete();
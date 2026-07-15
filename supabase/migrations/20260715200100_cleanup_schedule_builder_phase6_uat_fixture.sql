-- PHASE-6: Cleanup Schedule Builder UAT fixture (SOURCE ONLY — do not auto-apply).
-- Deletes ONLY rows tagged SCHEDULE_BUILDER_PHASE6_UAT / fixed UAT IDs.
-- Restores course_offerings enrollment fields from create-audit previous values.
-- Does NOT delete offerings, assignments, rooms, courses, instructors, colleges.

BEGIN;

DO $$
DECLARE
  c_marker constant text := 'SCHEDULE_BUILDER_PHASE6_UAT';
  c_version_name constant text := 'UAT — Schedule Builder Phase 6';
  c_section_number constant text := 'UAT-SB-P6';

  c_section_id constant uuid := '6a015200-0001-4000-8000-000000000001';
  c_cos_id     constant uuid := '6a015200-0001-4000-8000-000000000002';
  c_version_id constant uuid := '6a015200-0001-4000-8000-000000000003';
  c_session_id constant uuid := '6a015200-0001-4000-8000-000000000004';

  v_details jsonb;
  v_offering_id uuid;
  v_ta_id uuid;
  v_college_id uuid;
  v_prev_expected integer;
  v_prev_status text;
  v_prev_updated timestamptz;
  v_prev_ta_section_id uuid;
  v_prev_ta_section_number text;
  v_executed_at timestamptz := clock_timestamp();
  v_subgroups_deleted integer := 0;
  v_sessions_deleted integer := 0;
  v_versions_deleted integer := 0;
  v_sections_deleted integer := 0;
  v_cos_deleted integer := 0;
BEGIN
  -- Idempotent noop if nothing present
  IF NOT EXISTS (SELECT 1 FROM public.schedule_versions WHERE id = c_version_id)
     AND NOT EXISTS (SELECT 1 FROM public.sections WHERE id = c_section_id)
     AND NOT EXISTS (SELECT 1 FROM public.schedule_sessions WHERE id = c_session_id)
     AND NOT EXISTS (SELECT 1 FROM public.course_offering_sections WHERE id = c_cos_id) THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (
      NULL,
      c_marker || '_CLEANUP',
      'schedule_versions',
      NULL,
      NULL,
      jsonb_build_object(
        'operation', c_marker || '_CLEANUP',
        'phase', 'cleanup',
        'result', 'idempotent_noop',
        'actor', 'migration_executor',
        'executed_at', v_executed_at
      )
    );
    RAISE NOTICE 'UAT fixture absent — cleanup idempotent noop';
    RETURN;
  END IF;

  -- Refuse deleting version/section/session that exist but are not UAT-marked
  IF EXISTS (
    SELECT 1 FROM public.schedule_versions
    WHERE id = c_version_id
      AND (coalesce(notes, '') <> c_marker OR name <> c_version_name)
  ) THEN
    RAISE EXCEPTION 'UAT_CLEANUP_REFUSED_UNMARKED'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.sections
    WHERE id = c_section_id AND section_number <> c_section_number
  ) THEN
    RAISE EXCEPTION 'UAT_CLEANUP_REFUSED_UNMARKED'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.schedule_sessions s
    JOIN public.schedule_versions v ON v.id = s.schedule_version_id
    WHERE s.id = c_session_id
      AND (v.notes IS DISTINCT FROM c_marker OR v.id <> c_version_id)
  ) THEN
    RAISE EXCEPTION 'UAT_CLEANUP_REFUSED_UNMARKED'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT details INTO v_details
  FROM public.audit_logs
  WHERE action = c_marker
    AND details ->> 'phase' = 'create'
    AND details ->> 'result' = 'success'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_details IS NULL THEN
    -- Fallback: still allow cleanup of marked fixed IDs without restore
    v_offering_id := NULL;
    v_ta_id := NULL;
  ELSE
    v_offering_id := (v_details -> 'ids' ->> 'course_offering_id')::uuid;
    v_ta_id := (v_details -> 'ids' ->> 'teaching_assignment_id')::uuid;
    v_college_id := (v_details -> 'ids' ->> 'college_id')::uuid;
    v_prev_expected := (v_details -> 'enrollment_previous' ->> 'expected_students')::integer;
    v_prev_status := v_details -> 'enrollment_previous' ->> 'enrollment_count_status';
    IF (v_details -> 'enrollment_previous' ->> 'enrollment_count_updated_at') IS NOT NULL THEN
      v_prev_updated := (v_details -> 'enrollment_previous' ->> 'enrollment_count_updated_at')::timestamptz;
    ELSE
      v_prev_updated := NULL;
    END IF;
    IF (v_details -> 'teaching_assignment_previous' ->> 'section_id') IS NOT NULL THEN
      v_prev_ta_section_id := (v_details -> 'teaching_assignment_previous' ->> 'section_id')::uuid;
    ELSE
      v_prev_ta_section_id := NULL;
    END IF;
    v_prev_ta_section_number := v_details -> 'teaching_assignment_previous' ->> 'section_number';
  END IF;

  -- Delete UAT subgroups first (if approve RPC was used in a later phase)
  DELETE FROM public.section_subgroups
  WHERE section_id = c_section_id;
  GET DIAGNOSTICS v_subgroups_deleted = ROW_COUNT;

  -- Session (disable lock triggers only if needed; draft should allow delete)
  DELETE FROM public.schedule_sessions
  WHERE id = c_session_id
    AND schedule_version_id = c_version_id;
  GET DIAGNOSTICS v_sessions_deleted = ROW_COUNT;

  DELETE FROM public.schedule_versions
  WHERE id = c_version_id
    AND notes = c_marker
    AND name = c_version_name
    AND status = 'draft';
  GET DIAGNOSTICS v_versions_deleted = ROW_COUNT;

  IF EXISTS (SELECT 1 FROM public.schedule_versions WHERE id = c_version_id) THEN
    RAISE EXCEPTION 'UAT_CLEANUP_REFUSED_UNMARKED'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Restore TA section link if we pointed it at UAT section
  IF v_ta_id IS NOT NULL THEN
    UPDATE public.teaching_assignments
    SET section_id = v_prev_ta_section_id,
        section_number = v_prev_ta_section_number
    WHERE id = v_ta_id
      AND section_id = c_section_id;
  END IF;

  DELETE FROM public.course_offering_sections
  WHERE id = c_cos_id
    AND section_id = c_section_id;
  GET DIAGNOSTICS v_cos_deleted = ROW_COUNT;

  DELETE FROM public.sections
  WHERE id = c_section_id
    AND section_number = c_section_number;
  GET DIAGNOSTICS v_sections_deleted = ROW_COUNT;

  -- Restore offering enrollment previous values
  IF v_offering_id IS NOT NULL AND v_prev_status IS NOT NULL THEN
    UPDATE public.course_offerings
    SET expected_students = coalesce(v_prev_expected, 0),
        enrollment_count_status = v_prev_status,
        enrollment_count_updated_at = v_prev_updated
    WHERE id = v_offering_id;
  END IF;

  -- Refuse if any fixed UAT rows remain
  IF EXISTS (SELECT 1 FROM public.schedule_sessions WHERE id = c_session_id)
     OR EXISTS (SELECT 1 FROM public.schedule_versions WHERE id = c_version_id)
     OR EXISTS (SELECT 1 FROM public.sections WHERE id = c_section_id)
     OR EXISTS (SELECT 1 FROM public.course_offering_sections WHERE id = c_cos_id) THEN
    RAISE EXCEPTION 'UAT_CLEANUP_INCOMPLETE'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    NULL,
    c_marker || '_CLEANUP',
    'schedule_versions',
    c_version_id,
    v_college_id,
    jsonb_build_object(
      'operation', c_marker || '_CLEANUP',
      'phase', 'cleanup',
      'result', 'success',
      'actor', 'migration_executor',
      'deleted_counts', jsonb_build_object(
        'section_subgroups', v_subgroups_deleted,
        'schedule_sessions', v_sessions_deleted,
        'schedule_versions', v_versions_deleted,
        'course_offering_sections', v_cos_deleted,
        'sections', v_sections_deleted
      ),
      'restored_offering_id', v_offering_id,
      'enrollment_restored', jsonb_build_object(
        'expected_students', v_prev_expected,
        'enrollment_count_status', v_prev_status,
        'enrollment_count_updated_at', v_prev_updated
      ),
      'masters_untouched', true,
      'executed_at', v_executed_at
    )
  );

  RAISE NOTICE 'UAT fixture cleanup complete';
END $$;

COMMIT;

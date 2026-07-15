-- PHASE-6: Cleanup isolated Schedule Builder UAT chain (SOURCE ONLY — do not auto-apply).
-- Deletes ONLY SCHEDULE_BUILDER_PHASE6_ISOLATED_UAT fixed IDs.
-- Does NOT touch the 213 legacy course_offerings or any masters.

BEGIN;

DO $$
DECLARE
  c_marker constant text := 'SCHEDULE_BUILDER_PHASE6_ISOLATED_UAT';
  c_version_name constant text := 'UAT — Schedule Builder Phase 6';
  c_section_number constant text := 'UAT-ISO-P6';

  c_offering_id constant uuid := '6a015203-0001-4000-8000-000000000001';
  c_ta_id       constant uuid := '6a015203-0001-4000-8000-000000000002';
  c_section_id  constant uuid := '6a015203-0001-4000-8000-000000000003';
  c_cos_id      constant uuid := '6a015203-0001-4000-8000-000000000004';
  c_version_id  constant uuid := '6a015203-0001-4000-8000-000000000005';
  c_session_id  constant uuid := '6a015203-0001-4000-8000-000000000006';

  v_college_id uuid;
  v_executed_at timestamptz := clock_timestamp();
  v_subgroups integer := 0;
  v_sessions integer := 0;
  v_versions integer := 0;
  v_cos integer := 0;
  v_sections integer := 0;
  v_tas integer := 0;
  v_offerings integer := 0;
  v_legacy_offerings_before integer;
  v_legacy_offerings_after integer;
BEGIN
  SELECT COUNT(*)::integer INTO v_legacy_offerings_before
  FROM public.course_offerings
  WHERE id <> c_offering_id;

  IF NOT EXISTS (SELECT 1 FROM public.course_offerings WHERE id = c_offering_id)
     AND NOT EXISTS (SELECT 1 FROM public.schedule_versions WHERE id = c_version_id)
     AND NOT EXISTS (SELECT 1 FROM public.sections WHERE id = c_section_id)
     AND NOT EXISTS (SELECT 1 FROM public.schedule_sessions WHERE id = c_session_id)
     AND NOT EXISTS (SELECT 1 FROM public.teaching_assignments WHERE id = c_ta_id)
     AND NOT EXISTS (SELECT 1 FROM public.course_offering_sections WHERE id = c_cos_id) THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (
      NULL, c_marker || '_CLEANUP', 'schedule_versions', NULL, NULL,
      jsonb_build_object(
        'operation', c_marker || '_CLEANUP',
        'phase', 'cleanup',
        'result', 'idempotent_noop',
        'actor', 'migration_executor',
        'executed_at', v_executed_at
      )
    );
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.course_offerings
    WHERE id = c_offering_id AND coalesce(notes, '') <> c_marker
  ) THEN
    RAISE EXCEPTION 'UAT_CLEANUP_REFUSED_UNMARKED'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.teaching_assignments
    WHERE id = c_ta_id AND coalesce(notes, '') <> c_marker
  ) THEN
    RAISE EXCEPTION 'UAT_CLEANUP_REFUSED_UNMARKED'
      USING ERRCODE = 'check_violation';
  END IF;

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

  SELECT college_id INTO v_college_id FROM public.course_offerings WHERE id = c_offering_id;

  DELETE FROM public.section_subgroups WHERE section_id = c_section_id;
  GET DIAGNOSTICS v_subgroups = ROW_COUNT;

  DELETE FROM public.schedule_sessions
  WHERE id = c_session_id AND schedule_version_id = c_version_id;
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  DELETE FROM public.schedule_versions
  WHERE id = c_version_id AND notes = c_marker AND name = c_version_name AND status = 'draft';
  GET DIAGNOSTICS v_versions = ROW_COUNT;

  DELETE FROM public.course_offering_sections
  WHERE id = c_cos_id AND section_id = c_section_id AND course_offering_id = c_offering_id;
  GET DIAGNOSTICS v_cos = ROW_COUNT;

  DELETE FROM public.sections
  WHERE id = c_section_id AND section_number = c_section_number;
  GET DIAGNOSTICS v_sections = ROW_COUNT;

  DELETE FROM public.teaching_assignments
  WHERE id = c_ta_id AND notes = c_marker AND course_offering_id = c_offering_id;
  GET DIAGNOSTICS v_tas = ROW_COUNT;

  DELETE FROM public.course_offerings
  WHERE id = c_offering_id AND notes = c_marker;
  GET DIAGNOSTICS v_offerings = ROW_COUNT;

  SELECT COUNT(*)::integer INTO v_legacy_offerings_after
  FROM public.course_offerings
  WHERE id <> c_offering_id;

  IF v_legacy_offerings_after <> v_legacy_offerings_before THEN
    RAISE EXCEPTION 'UAT_CLEANUP_TOUCHED_LEGACY_OFFERINGS'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.course_offerings WHERE id = c_offering_id)
     OR EXISTS (SELECT 1 FROM public.teaching_assignments WHERE id = c_ta_id)
     OR EXISTS (SELECT 1 FROM public.sections WHERE id = c_section_id)
     OR EXISTS (SELECT 1 FROM public.course_offering_sections WHERE id = c_cos_id)
     OR EXISTS (SELECT 1 FROM public.schedule_versions WHERE id = c_version_id)
     OR EXISTS (SELECT 1 FROM public.schedule_sessions WHERE id = c_session_id) THEN
    RAISE EXCEPTION 'UAT_CLEANUP_INCOMPLETE'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    NULL, c_marker || '_CLEANUP', 'schedule_versions', c_version_id, v_college_id,
    jsonb_build_object(
      'operation', c_marker || '_CLEANUP',
      'phase', 'cleanup',
      'result', 'success',
      'actor', 'migration_executor',
      'deleted_counts', jsonb_build_object(
        'section_subgroups', v_subgroups,
        'schedule_sessions', v_sessions,
        'schedule_versions', v_versions,
        'course_offering_sections', v_cos,
        'sections', v_sections,
        'teaching_assignments', v_tas,
        'course_offerings', v_offerings
      ),
      'legacy_offerings_count_unchanged', v_legacy_offerings_after,
      'masters_untouched', true,
      'executed_at', v_executed_at
    )
  );
END $$;

COMMIT;

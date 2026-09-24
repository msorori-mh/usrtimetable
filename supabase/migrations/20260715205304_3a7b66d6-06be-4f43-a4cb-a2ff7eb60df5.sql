-- 20260715200400_cleanup_isolated_schedule_builder_phase6_uat_fixture.sql
DO $$
DECLARE
  v_marker           text := 'SCHEDULE_BUILDER_PHASE6_ISOLATED_UAT';
  v_offering_id      uuid := '6a015203-0001-4000-8000-000000000001';
  v_assignment_id    uuid := '6a015203-0001-4000-8000-000000000002';
  v_section_id       uuid := '6a015203-0001-4000-8000-000000000003';
  v_cos_id           uuid := '6a015203-0001-4000-8000-000000000004';
  v_version_id       uuid := '6a015203-0001-4000-8000-000000000005';
  v_session_id       uuid := '6a015203-0001-4000-8000-000000000006';
  v_college_id       uuid;
  v_deleted_subgroups int;
  v_deleted_sessions  int;
  v_deleted_versions  int;
  v_deleted_sections  int;
  v_deleted_cos       int;
  v_deleted_ta        int;
  v_deleted_off       int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM course_offerings WHERE id = v_offering_id AND notes = v_marker
  ) THEN
    RAISE NOTICE 'UAT marker offering not found; nothing to clean.';
    RETURN;
  END IF;

  SELECT college_id INTO v_college_id FROM course_offerings WHERE id = v_offering_id;

  DELETE FROM section_subgroups WHERE section_id = v_section_id;
  GET DIAGNOSTICS v_deleted_subgroups = ROW_COUNT;

  DELETE FROM schedule_sessions
   WHERE id = v_session_id OR schedule_version_id = v_version_id;
  GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;

  DELETE FROM schedule_versions WHERE id = v_version_id;
  GET DIAGNOSTICS v_deleted_versions = ROW_COUNT;

  DELETE FROM course_offering_sections
   WHERE id = v_cos_id
      OR (course_offering_id = v_offering_id AND section_id = v_section_id);
  GET DIAGNOSTICS v_deleted_cos = ROW_COUNT;

  DELETE FROM teaching_assignments
   WHERE id = v_assignment_id OR course_offering_id = v_offering_id;
  GET DIAGNOSTICS v_deleted_ta = ROW_COUNT;

  DELETE FROM sections WHERE id = v_section_id;
  GET DIAGNOSTICS v_deleted_sections = ROW_COUNT;

  DELETE FROM course_offerings WHERE id = v_offering_id AND notes = v_marker;
  GET DIAGNOSTICS v_deleted_off = ROW_COUNT;

  INSERT INTO audit_logs (action, entity, entity_id, college_id, details)
  VALUES (
    'cleanup_isolated_uat_fixture',
    'schedule_builder_phase6_isolated_uat',
    v_offering_id,
    v_college_id,
    jsonb_build_object(
      'marker', v_marker,
      'deleted_section_subgroups', v_deleted_subgroups,
      'deleted_schedule_sessions', v_deleted_sessions,
      'deleted_schedule_versions', v_deleted_versions,
      'deleted_course_offering_sections', v_deleted_cos,
      'deleted_teaching_assignments', v_deleted_ta,
      'deleted_sections', v_deleted_sections,
      'deleted_course_offerings', v_deleted_off
    )
  );
END $$;
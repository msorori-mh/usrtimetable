-- Rollback for 20261026100000_import_commit_server_revalidation.sql
-- Restore _import_dispatch exactly as defined by 20260917232142 (no re-validation).
CREATE OR REPLACE FUNCTION public._import_dispatch(p_college uuid, p_entity text, p_mode text, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'import payload must be a jsonb array' USING ERRCODE = '22023';
  END IF;
  CASE p_entity
    WHEN 'departments', 'academic_programs' THEN
      RETURN public._import_apply_academic_structure(p_college, p_entity, p_mode, p_rows);
    WHEN 'instructors', 'rooms', 'academic_terms', 'daily_breaks' THEN
      RETURN public._import_apply_table_entity(p_college, p_entity, p_mode, p_rows);
    WHEN 'sections' THEN
      RETURN public._import_apply_sections(p_college, p_mode, p_rows);
    WHEN 'academic_cohorts' THEN
      RETURN public._import_apply_academic_cohorts(p_college, p_mode, p_rows);
    WHEN 'course_offerings' THEN
      RETURN public._import_apply_course_offerings(p_college, p_mode, p_rows);
    WHEN 'teaching_assignments' THEN
      RETURN public._import_apply_teaching_assignments(p_college, p_mode, p_rows);
    WHEN 'course_programs' THEN
      RETURN public._import_apply_course_programs(p_college, p_mode, p_rows);
    WHEN 'section_groups' THEN
      RETURN public._import_apply_section_groups(p_college, p_mode, p_rows);
    WHEN 'elective_slot_courses' THEN
      RETURN public._import_apply_elective_slot_courses(p_college, p_mode, p_rows);
    WHEN 'cohort_elective_selections' THEN
      RETURN public._import_apply_cohort_elective_selections(p_college, p_mode, p_rows);
    WHEN 'study_plan_courses', 'full_study_plan' THEN
      RETURN public._import_apply_study_plan(p_college, p_mode, p_rows);
    WHEN 'teaching_assignments_v2' THEN
      RETURN public._import_apply_teaching_assignments_v2(p_college, p_mode, p_rows);
    ELSE
      RAISE EXCEPTION 'unknown import entity: %', p_entity USING ERRCODE = '22023';
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public._import_dispatch(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._import_dispatch(uuid, text, text, jsonb) TO service_role;

DROP FUNCTION IF EXISTS public._import_validate_rows(text, jsonb);
DROP FUNCTION IF EXISTS public._import_numeric_or_null(jsonb);

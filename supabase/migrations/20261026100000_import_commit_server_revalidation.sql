-- M-13 (server side): commit_import_job_atomic trusted the browser-validated
-- payload stored by create_import_preview_manifest; only required fields were
-- re-checked in the per-entity apply helpers. This migration adds a
-- server-side re-validation of the key business rules and runs it inside the
-- commit path (_import_dispatch, called only from commit_import_job_atomic)
-- BEFORE any domain write:
--   * numeric fields must be plain decimals (no exponent/hex/NaN/Infinity) and
--     non-negative; capacities strictly positive; integer columns integral;
--     weekly/daily hour fields within a week/day;
--   * time pairs must be valid and ordered (start < end), compared as times;
--   * day lists must be integer arrays within 0..6;
--   * a plan row with lectures/labs per week needs a positive session duration.
-- Any violation raises 22023 with the row number, rolling back the whole job.

CREATE OR REPLACE FUNCTION public._import_numeric_or_null(p_value jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_text text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_value) = 'number' THEN
    RETURN (p_value #>> '{}')::numeric;
  END IF;
  IF jsonb_typeof(p_value) <> 'string' THEN
    RAISE EXCEPTION 'not a number' USING ERRCODE = '22P02';
  END IF;
  v_text := btrim(p_value #>> '{}');
  IF v_text = '' THEN
    RETURN NULL;
  END IF;
  IF v_text !~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN
    RAISE EXCEPTION 'not a number' USING ERRCODE = '22P02';
  END IF;
  RETURN v_text::numeric;
END;
$$;

REVOKE ALL ON FUNCTION public._import_numeric_or_null(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._import_numeric_or_null(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public._import_validate_rows(p_entity text, p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_elem jsonb;
  v jsonb;
  v_idx int := 0;
  v_rn int;
  v_spec record;
  v_num numeric;
  v_start time;
  v_end time;
  v_day jsonb;
  v_pair text[];
  -- field, minimum (inclusive unless strict), strict (> min), integral, maximum
  v_specs jsonb := CASE p_entity
    WHEN 'instructors' THEN '[
      ["max_weekly_hours",0,false,false,168],
      ["administrative_release_hours",0,false,false,168],
      ["max_hours_per_day",0,false,false,24]]'
    WHEN 'rooms' THEN '[["capacity",0,true,true,null]]'
    WHEN 'sections' THEN '[["capacity",0,true,true,null]]'
    WHEN 'academic_programs' THEN '[["duration_years",0,true,true,20]]'
    WHEN 'academic_terms' THEN '[["teaching_weeks_count",0,true,true,60]]'
    WHEN 'study_plan_courses' THEN '[
      ["effective_year",0,true,true,null],["level_number",0,true,true,null],
      ["semester",0,true,true,null],["credit_hours",0,false,false,null],
      ["theory_hours",0,false,false,168],["practical_hours",0,false,false,168],
      ["tutorial_hours",0,false,false,168],["project_hours",0,false,false,168],
      ["lectures_per_week",0,false,true,null],["lecture_session_duration",0,false,false,24],
      ["labs_per_week",0,false,true,null],["lab_session_duration",0,false,false,24]]'
    WHEN 'full_study_plan' THEN '[
      ["effective_year",0,true,true,null],["level_number",0,true,true,null],
      ["semester",0,true,true,null],["credit_hours",0,false,false,null],
      ["theory_hours",0,false,false,168],["practical_hours",0,false,false,168],
      ["tutorial_hours",0,false,false,168],["project_hours",0,false,false,168],
      ["lectures_per_week",0,false,true,null],["lecture_session_duration",0,false,false,24],
      ["labs_per_week",0,false,true,null],["lab_session_duration",0,false,false,24]]'
    WHEN 'course_offerings' THEN '[
      ["level_number",0,true,true,null],["expected_students",0,false,true,null],
      ["sections_count",0,false,true,null]]'
    WHEN 'teaching_assignments' THEN '[
      ["weekly_hours",0,false,false,168],["expected_students",0,false,true,null]]'
    WHEN 'academic_cohorts' THEN '[
      ["level_number",0,true,true,null],["entry_year",0,true,true,null],
      ["expected_students",0,false,true,null]]'
    WHEN 'teaching_assignments_v2' THEN '[
      ["assigned_component_hours",0,false,false,168],["expected_students",0,false,true,null],
      ["_assigned_component_hours",0,false,false,168]]'
    ELSE '[]'
  END::jsonb;
  v_times jsonb := CASE p_entity
    WHEN 'rooms' THEN '[["available_start_time","available_end_time"]]'
    WHEN 'daily_breaks' THEN '[["start_time","end_time"]]'
    ELSE '[]'
  END::jsonb;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'import payload must be a jsonb array' USING ERRCODE = '22023';
  END IF;

  FOR v_elem IN SELECT e FROM jsonb_array_elements(p_rows) AS e LOOP
    v_idx := v_idx + 1;
    v_rn := public._import_row_number(v_elem, v_idx);
    v := public._import_row_values(v_elem);
    IF jsonb_typeof(v) <> 'object' THEN
      RAISE EXCEPTION 'import row % is not an object', v_rn USING ERRCODE = '22023';
    END IF;

    -- Numeric fields.
    FOR v_spec IN
      SELECT s->>0 AS field,
             (s->>1)::numeric AS min_value,
             (s->>2)::boolean AS strict_min,
             (s->>3)::boolean AS integral,
             NULLIF(s->>4, '')::numeric AS max_value
      FROM jsonb_array_elements(v_specs) AS s
    LOOP
      BEGIN
        v_num := public._import_numeric_or_null(v -> v_spec.field);
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'IMPORT_INVALID_NUMBER: row % field % is not a plain decimal number',
          v_rn, v_spec.field USING ERRCODE = '22023';
      END;
      CONTINUE WHEN v_num IS NULL;
      IF (v_spec.strict_min AND v_num <= v_spec.min_value)
         OR (NOT v_spec.strict_min AND v_num < v_spec.min_value) THEN
        RAISE EXCEPTION 'IMPORT_NUMBER_OUT_OF_RANGE: row % field % = % is below the allowed minimum',
          v_rn, v_spec.field, v_num USING ERRCODE = '22023';
      END IF;
      IF v_spec.max_value IS NOT NULL AND v_num > v_spec.max_value THEN
        RAISE EXCEPTION 'IMPORT_NUMBER_OUT_OF_RANGE: row % field % = % exceeds %',
          v_rn, v_spec.field, v_num, v_spec.max_value USING ERRCODE = '22023';
      END IF;
      IF v_spec.integral AND v_num <> trunc(v_num) THEN
        RAISE EXCEPTION 'IMPORT_INVALID_NUMBER: row % field % must be a whole number',
          v_rn, v_spec.field USING ERRCODE = '22023';
      END IF;
    END LOOP;

    -- Plan cadence: a weekly count needs a positive session duration.
    IF p_entity IN ('study_plan_courses', 'full_study_plan') THEN
      IF COALESCE(public._import_numeric_or_null(v -> 'lectures_per_week'), 0) > 0
         AND COALESCE(public._import_numeric_or_null(v -> 'lecture_session_duration'), 0) <= 0 THEN
        RAISE EXCEPTION 'IMPORT_INVALID_PATTERN: row % lecture_session_duration must be > 0', v_rn
          USING ERRCODE = '22023';
      END IF;
      IF COALESCE(public._import_numeric_or_null(v -> 'labs_per_week'), 0) > 0
         AND COALESCE(public._import_numeric_or_null(v -> 'lab_session_duration'), 0) <= 0 THEN
        RAISE EXCEPTION 'IMPORT_INVALID_PATTERN: row % lab_session_duration must be > 0', v_rn
          USING ERRCODE = '22023';
      END IF;
    END IF;

    -- Time pairs: valid HH:MM[:SS] and start < end (compared as time, not text).
    FOR v_pair IN
      SELECT ARRAY[t->>0, t->>1] FROM jsonb_array_elements(v_times) AS t
    LOOP
      v_start := NULL;
      v_end := NULL;
      BEGIN
        IF NULLIF(btrim(v ->> v_pair[1]), '') IS NOT NULL THEN
          IF btrim(v ->> v_pair[1]) !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN
            RAISE EXCEPTION 'bad time' USING ERRCODE = '22007';
          END IF;
          v_start := btrim(v ->> v_pair[1])::time;
        END IF;
        IF NULLIF(btrim(v ->> v_pair[2]), '') IS NOT NULL THEN
          IF btrim(v ->> v_pair[2]) !~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' THEN
            RAISE EXCEPTION 'bad time' USING ERRCODE = '22007';
          END IF;
          v_end := btrim(v ->> v_pair[2])::time;
        END IF;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION 'IMPORT_INVALID_TIME: row % has an invalid time in % / %',
          v_rn, v_pair[1], v_pair[2] USING ERRCODE = '22023';
      END;
      IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end <= v_start THEN
        RAISE EXCEPTION 'IMPORT_INVALID_TIME_RANGE: row % % must be after %',
          v_rn, v_pair[2], v_pair[1] USING ERRCODE = '22023';
      END IF;
    END LOOP;

    -- Day lists (daily_breaks.days): integers 0..6 only.
    IF p_entity = 'daily_breaks' AND v ? 'days' AND jsonb_typeof(v -> 'days') <> 'null' THEN
      IF jsonb_typeof(v -> 'days') <> 'array' THEN
        RAISE EXCEPTION 'IMPORT_INVALID_DAYS: row % days must be a list of 0..6', v_rn
          USING ERRCODE = '22023';
      END IF;
      FOR v_day IN SELECT d FROM jsonb_array_elements(v -> 'days') AS d LOOP
        IF NOT (
          (jsonb_typeof(v_day) = 'number' AND (v_day #>> '{}') ~ '^[0-6]$')
          OR (jsonb_typeof(v_day) = 'string' AND btrim(v_day #>> '{}') ~ '^[0-6]$')
        ) THEN
          RAISE EXCEPTION 'IMPORT_INVALID_DAYS: row % day % is outside 0..6', v_rn, v_day
            USING ERRCODE = '22023';
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._import_validate_rows(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._import_validate_rows(text, jsonb) TO service_role;

-- Full redefinition (latest body from 20260917232142) + server re-validation.
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
  -- M-13: never trust the browser-validated payload; re-check business rules
  -- before any domain write (raises 22023 -> whole commit rolls back).
  PERFORM public._import_validate_rows(p_entity, p_rows);
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

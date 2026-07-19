-- =============================================================================
-- SOURCE-ONLY MIGRATION — NOT APPLIED
-- PR #45 import pipeline: atomic server-side commit for import jobs.
--
-- This migration is FORWARD and SOURCE-ONLY. It:
--   * Creates functions only (DDL). It does NOT run any import, backfill, seed,
--     or invocation of these functions during apply.
--   * Does NOT mutate any production/business data during apply.
--   * Does NOT DROP or TRUNCATE data, and does NOT ALTER historical migrations.
--   * Must be gated by the production deployment process before being applied.
--
-- It adds public.commit_import_job_atomic(...) which performs the entire import
-- (all domain writes + audit + job status update) inside a single transaction.
-- Any exception rolls back EVERYTHING (no partial success, no success audit).
--
-- All internal helpers are prefixed `_import_` / `_import_apply_` and have
-- EXECUTE revoked from PUBLIC, anon and authenticated. Only the definer function
-- (running as its owner) may call them. The public entrypoint is granted to
-- authenticated (and optionally service_role) only — never anon.
--
-- Pre-apply security hardening (table ACL):
--   Historical source: 20260605002216 granted INSERT/UPDATE/DELETE on
--   import_jobs and import_errors to authenticated; 20260718180000 revoked those
--   from authenticated. This migration re-asserts the revoke for authenticated,
--   and also closes anon + PUBLIC table DML so client paths cannot rely on
--   schema defaults, PUBLIC membership, or residual grants. SELECT for
--   authenticated (UI history) is intentionally left; all writes go through
--   authorized RPCs (create_import_preview_manifest / commit_import_job_atomic /
--   claim|finalize|fail_import_job). service_role table ALL is unchanged and is
--   not a browser client path.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Small pure helpers
-- ---------------------------------------------------------------------------

-- Extract the `values` object from a stored ParsedRow `{rowNumber, values}`,
-- or return the element itself when it already is a values object.
CREATE OR REPLACE FUNCTION public._import_row_values(elem jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN elem IS NULL THEN '{}'::jsonb
    WHEN jsonb_typeof(elem) = 'object' AND elem ? 'values'
      THEN COALESCE(elem->'values', '{}'::jsonb)
    ELSE COALESCE(elem, '{}'::jsonb)
  END;
$fn$;

-- Resolve the human row number from a stored ParsedRow, defaulting to idx.
CREATE OR REPLACE FUNCTION public._import_row_number(elem jsonb, idx int)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(
    NULLIF(elem->>'rowNumber', '')::int,
    NULLIF(elem->>'row_number', '')::int,
    idx
  );
$fn$;

CREATE OR REPLACE FUNCTION public._import_counters_new()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_build_object('inserted', 0, 'updated', 0, 'skipped', 0);
$fn$;

CREATE OR REPLACE FUNCTION public._import_counters_add(a jsonb, b jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_build_object(
    'inserted', COALESCE((a->>'inserted')::int, 0) + COALESCE((b->>'inserted')::int, 0),
    'updated',  COALESCE((a->>'updated')::int, 0)  + COALESCE((b->>'updated')::int, 0),
    'skipped',  COALESCE((a->>'skipped')::int, 0)  + COALESCE((b->>'skipped')::int, 0)
  );
$fn$;

-- Given the mode and whether the target row already exists, decide the action.
--   insert_only     + exists      -> skip
--   insert_only     + not exists  -> insert
--   update_existing + exists      -> update
--   update_existing + not exists  -> skip
--   upsert          + exists      -> update
--   upsert          + not exists  -> insert
CREATE OR REPLACE FUNCTION public._import_mode_action(p_mode text, p_exists boolean)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN p_exists AND p_mode = 'insert_only' THEN 'skip'
    WHEN p_exists THEN 'update'
    WHEN (NOT p_exists) AND p_mode = 'update_existing' THEN 'skip'
    ELSE 'insert'
  END;
$fn$;

-- Placeholder elective codes like CY3XX(E) must never become real courses/offerings.
CREATE OR REPLACE FUNCTION public._import_is_elective_placeholder(code text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE
    WHEN code IS NULL THEN false
    ELSE upper(btrim(code)) ~ '\(E\)$'
      OR upper(btrim(code)) ~ '^[A-Z]{2,}[0-9]XX\(E\)$'
  END;
$fn$;

-- ---------------------------------------------------------------------------
-- Table-entity apply helper (instructors, rooms, academic_terms, daily_breaks)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_apply_table_entity(
  p_college uuid,
  p_entity text,
  p_mode text,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int;
  v_elem jsonb;
  v jsonb;
  v_rn int;
  v_uniq text;
  v_id uuid;
  v_exists boolean;
  v_action text;
  v_counters jsonb := public._import_counters_new();
  v_ins int := 0;
  v_upd int := 0;
  v_skp int := 0;
BEGIN
  -- Phase 1: pre-validate ALL rows before any operational DML.
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    IF p_entity = 'instructors' THEN
      IF NULLIF(v->>'employee_number', '') IS NULL OR NULLIF(v->>'full_name', '') IS NULL THEN
        RAISE EXCEPTION 'instructors row % missing employee_number/full_name', v_rn USING ERRCODE = '22023';
      END IF;
    ELSIF p_entity = 'rooms' THEN
      IF NULLIF(v->>'code', '') IS NULL OR NULLIF(v->>'name', '') IS NULL OR NULLIF(v->>'room_type', '') IS NULL THEN
        RAISE EXCEPTION 'rooms row % missing code/name/room_type', v_rn USING ERRCODE = '22023';
      END IF;
    ELSIF p_entity = 'academic_terms' THEN
      IF NULLIF(v->>'code', '') IS NULL OR NULLIF(v->>'name', '') IS NULL THEN
        RAISE EXCEPTION 'academic_terms row % missing code/name', v_rn USING ERRCODE = '22023';
      END IF;
    ELSIF p_entity = 'daily_breaks' THEN
      IF NULLIF(v->>'name', '') IS NULL OR NULLIF(v->>'start_time', '') IS NULL OR NULLIF(v->>'end_time', '') IS NULL THEN
        RAISE EXCEPTION 'daily_breaks row % missing name/start_time/end_time', v_rn USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'unsupported table entity: %', p_entity USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Phase 2: apply. Existing target rows are locked (id ASC) before writes.
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_id := NULL;

    IF p_entity = 'instructors' THEN
      v_uniq := v->>'employee_number';
      SELECT id INTO v_id FROM public.instructors
        WHERE college_id = p_college AND lower(employee_number) = lower(v_uniq)
        ORDER BY id ASC LIMIT 1 FOR UPDATE;
      v_exists := v_id IS NOT NULL;
      v_action := public._import_mode_action(p_mode, v_exists);
      IF v_action = 'skip' THEN
        v_skp := v_skp + 1;
      ELSIF v_action = 'insert' THEN
        INSERT INTO public.instructors (
          college_id, employee_number, full_name, full_name_ar, full_name_en, email, phone,
          specialization, academic_degree, academic_rank, instructor_type_id, department_id,
          employment_type, max_weekly_hours, max_hours_per_day, administrative_release_hours,
          admin_tasks, external_source, notes, is_active
        ) VALUES (
          p_college, v->>'employee_number', v->>'full_name',
          COALESCE(NULLIF(v->>'full_name_ar', ''), v->>'full_name'),
          NULLIF(v->>'full_name_en', ''), NULLIF(v->>'email', ''), NULLIF(v->>'phone', ''),
          NULLIF(v->>'specialization', ''), NULLIF(v->>'academic_degree', ''),
          NULLIF(v->>'academic_rank', ''),
          NULLIF(v->>'_instructor_type_id', '')::uuid, NULLIF(v->>'_department_id', '')::uuid,
          COALESCE(NULLIF(v->>'employment_type', ''), 'full_time'),
          COALESCE(NULLIF(v->>'max_weekly_hours', '')::numeric, 18),
          NULLIF(v->>'max_hours_per_day', '')::numeric,
          COALESCE(NULLIF(v->>'administrative_release_hours', '')::numeric, 0),
          NULLIF(v->>'admin_tasks', ''), NULLIF(v->>'external_source', ''), NULLIF(v->>'notes', ''),
          COALESCE(NULLIF(v->>'is_active', '')::boolean, true)
        );
        v_ins := v_ins + 1;
      ELSE
        UPDATE public.instructors SET
          full_name = v->>'full_name',
          full_name_ar = COALESCE(NULLIF(v->>'full_name_ar', ''), v->>'full_name'),
          full_name_en = NULLIF(v->>'full_name_en', ''),
          email = NULLIF(v->>'email', ''),
          phone = NULLIF(v->>'phone', ''),
          specialization = NULLIF(v->>'specialization', ''),
          academic_degree = NULLIF(v->>'academic_degree', ''),
          academic_rank = NULLIF(v->>'academic_rank', ''),
          instructor_type_id = NULLIF(v->>'_instructor_type_id', '')::uuid,
          department_id = NULLIF(v->>'_department_id', '')::uuid,
          employment_type = COALESCE(NULLIF(v->>'employment_type', ''), 'full_time'),
          max_weekly_hours = COALESCE(NULLIF(v->>'max_weekly_hours', '')::numeric, 18),
          max_hours_per_day = NULLIF(v->>'max_hours_per_day', '')::numeric,
          administrative_release_hours = COALESCE(NULLIF(v->>'administrative_release_hours', '')::numeric, 0),
          admin_tasks = NULLIF(v->>'admin_tasks', ''),
          external_source = NULLIF(v->>'external_source', ''),
          notes = NULLIF(v->>'notes', ''),
          is_active = COALESCE(NULLIF(v->>'is_active', '')::boolean, true)
        WHERE id = v_id;
        v_upd := v_upd + 1;
      END IF;

    ELSIF p_entity = 'rooms' THEN
      v_uniq := v->>'code';
      SELECT id INTO v_id FROM public.rooms
        WHERE college_id = p_college AND lower(code) = lower(v_uniq)
        ORDER BY id ASC LIMIT 1 FOR UPDATE;
      v_exists := v_id IS NOT NULL;
      v_action := public._import_mode_action(p_mode, v_exists);
      IF v_action = 'skip' THEN
        v_skp := v_skp + 1;
      ELSIF v_action = 'insert' THEN
        INSERT INTO public.rooms (
          college_id, code, name, capacity, room_type, room_type_id, building_id, building,
          floor, available_start_time, available_end_time, notes, is_active
        ) VALUES (
          p_college, v->>'code', v->>'name',
          COALESCE(NULLIF(v->>'capacity', '')::int, 30), v->>'room_type',
          NULLIF(v->>'_room_type_id', '')::uuid, NULLIF(v->>'_building_id', '')::uuid,
          NULLIF(v->>'building', ''), NULLIF(v->>'floor', ''),
          NULLIF(v->>'available_start_time', '')::time, NULLIF(v->>'available_end_time', '')::time,
          NULLIF(v->>'notes', ''), COALESCE(NULLIF(v->>'is_active', '')::boolean, true)
        );
        v_ins := v_ins + 1;
      ELSE
        UPDATE public.rooms SET
          name = v->>'name',
          capacity = COALESCE(NULLIF(v->>'capacity', '')::int, 30),
          room_type = v->>'room_type',
          room_type_id = NULLIF(v->>'_room_type_id', '')::uuid,
          building_id = NULLIF(v->>'_building_id', '')::uuid,
          building = NULLIF(v->>'building', ''),
          floor = NULLIF(v->>'floor', ''),
          available_start_time = NULLIF(v->>'available_start_time', '')::time,
          available_end_time = NULLIF(v->>'available_end_time', '')::time,
          notes = NULLIF(v->>'notes', ''),
          is_active = COALESCE(NULLIF(v->>'is_active', '')::boolean, true)
        WHERE id = v_id;
        v_upd := v_upd + 1;
      END IF;

    ELSIF p_entity = 'academic_terms' THEN
      v_uniq := v->>'code';
      SELECT id INTO v_id FROM public.academic_terms
        WHERE college_id = p_college AND lower(code) = lower(v_uniq)
        ORDER BY id ASC LIMIT 1 FOR UPDATE;
      v_exists := v_id IS NOT NULL;
      v_action := public._import_mode_action(p_mode, v_exists);
      IF v_action = 'skip' THEN
        v_skp := v_skp + 1;
      ELSIF v_action = 'insert' THEN
        INSERT INTO public.academic_terms (
          college_id, code, name, academic_year, term_type, start_date, end_date,
          teaching_weeks_count, is_active
        ) VALUES (
          p_college, v->>'code', v->>'name', NULLIF(v->>'academic_year', ''),
          NULLIF(v->>'term_type', ''), NULLIF(v->>'start_date', '')::date,
          NULLIF(v->>'end_date', '')::date, NULLIF(v->>'teaching_weeks_count', '')::int,
          COALESCE(NULLIF(v->>'is_active', '')::boolean, false)
        );
        v_ins := v_ins + 1;
      ELSE
        UPDATE public.academic_terms SET
          name = v->>'name',
          academic_year = NULLIF(v->>'academic_year', ''),
          term_type = NULLIF(v->>'term_type', ''),
          start_date = NULLIF(v->>'start_date', '')::date,
          end_date = NULLIF(v->>'end_date', '')::date,
          teaching_weeks_count = NULLIF(v->>'teaching_weeks_count', '')::int,
          is_active = COALESCE(NULLIF(v->>'is_active', '')::boolean, false)
        WHERE id = v_id;
        v_upd := v_upd + 1;
      END IF;

    ELSIF p_entity = 'daily_breaks' THEN
      v_uniq := v->>'name';
      SELECT id INTO v_id FROM public.daily_breaks
        WHERE college_id = p_college AND lower(name) = lower(v_uniq)
        ORDER BY id ASC LIMIT 1 FOR UPDATE;
      v_exists := v_id IS NOT NULL;
      v_action := public._import_mode_action(p_mode, v_exists);
      IF v_action = 'skip' THEN
        v_skp := v_skp + 1;
      ELSIF v_action = 'insert' THEN
        INSERT INTO public.daily_breaks (
          college_id, name, start_time, end_time, days, affects_scheduling
        ) VALUES (
          p_college, v->>'name', (v->>'start_time')::time, (v->>'end_time')::time,
          CASE WHEN jsonb_typeof(v->'days') = 'array'
               THEN ARRAY(SELECT (e)::int FROM jsonb_array_elements_text(v->'days') e)
               ELSE ARRAY[]::int[] END,
          COALESCE(NULLIF(v->>'affects_scheduling', '')::boolean, true)
        );
        v_ins := v_ins + 1;
      ELSE
        UPDATE public.daily_breaks SET
          start_time = (v->>'start_time')::time,
          end_time = (v->>'end_time')::time,
          days = CASE WHEN jsonb_typeof(v->'days') = 'array'
                      THEN ARRAY(SELECT (e)::int FROM jsonb_array_elements_text(v->'days') e)
                      ELSE ARRAY[]::int[] END,
          affects_scheduling = COALESCE(NULLIF(v->>'affects_scheduling', '')::boolean, true)
        WHERE id = v_id;
        v_upd := v_upd + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skp);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Custom: sections
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_apply_sections(
  p_college uuid, p_mode text, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int;
  v jsonb;
  v_rn int;
  v_ss text;
  v_id uuid;
  v_exists boolean;
  v_action text;
  v_ins int := 0; v_upd int := 0; v_skp int := 0;
BEGIN
  -- Phase 1: pre-validate.
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    v_ss := COALESCE(NULLIF(v->>'study_system', ''), 'regular');
    IF NULLIF(v->>'_course_id', '') IS NULL OR NULLIF(v->>'_term_id', '') IS NULL
       OR NULLIF(v->>'section_number', '') IS NULL THEN
      RAISE EXCEPTION 'sections row % missing course/term/section_number', v_rn USING ERRCODE = '22023';
    END IF;
    IF v_ss NOT IN ('regular', 'parallel', 'both') THEN
      RAISE EXCEPTION 'sections row % invalid study_system %', v_rn, v_ss USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Phase 2: apply (lock matching id ASC before write).
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_ss := COALESCE(NULLIF(v->>'study_system', ''), 'regular');
    v_id := NULL;
    SELECT id INTO v_id FROM public.sections
      WHERE college_id = p_college
        AND course_id = (v->>'_course_id')::uuid
        AND term_id = (v->>'_term_id')::uuid
        AND section_number = (v->>'section_number')
        AND study_system = v_ss
      ORDER BY id ASC LIMIT 1 FOR UPDATE;
    v_exists := v_id IS NOT NULL;
    v_action := public._import_mode_action(p_mode, v_exists);
    IF v_action = 'skip' THEN
      v_skp := v_skp + 1;
    ELSIF v_action = 'insert' THEN
      INSERT INTO public.sections (college_id, course_id, term_id, section_number, capacity, study_system)
      VALUES (
        p_college, (v->>'_course_id')::uuid, (v->>'_term_id')::uuid, (v->>'section_number'),
        COALESCE(NULLIF(v->>'capacity', '')::int, 30), v_ss
      );
      v_ins := v_ins + 1;
    ELSE
      UPDATE public.sections SET
        capacity = COALESCE(NULLIF(v->>'capacity', '')::int, 30)
      WHERE id = v_id;
      v_upd := v_upd + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skp);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Custom: academic_cohorts
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_apply_academic_cohorts(
  p_college uuid, p_mode text, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int;
  v jsonb;
  v_rn int;
  v_id uuid;
  v_exists boolean;
  v_action text;
  v_ins int := 0; v_upd int := 0; v_skp int := 0;
BEGIN
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    IF NULLIF(v->>'_program_id', '') IS NULL OR NULLIF(v->>'_level_id', '') IS NULL
       OR NULLIF(v->>'study_system', '') IS NULL OR NULLIF(v->>'entry_year', '') IS NULL
       OR NULLIF(v->>'_term_id', '') IS NULL THEN
      RAISE EXCEPTION 'academic_cohorts row % missing program/level/study_system/entry_year/term', v_rn USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_id := NULL;
    SELECT id INTO v_id FROM public.academic_cohorts
      WHERE college_id = p_college
        AND program_id = (v->>'_program_id')::uuid
        AND level_id = (v->>'_level_id')::uuid
        AND study_system = v->>'study_system'
        AND entry_year = (v->>'entry_year')::int
        AND term_id = (v->>'_term_id')::uuid
      ORDER BY id ASC LIMIT 1 FOR UPDATE;
    v_exists := v_id IS NOT NULL;
    v_action := public._import_mode_action(p_mode, v_exists);
    IF v_action = 'skip' THEN
      v_skp := v_skp + 1;
    ELSIF v_action = 'insert' THEN
      INSERT INTO public.academic_cohorts (
        college_id, program_id, level_id, study_system, entry_year, term_id,
        expected_students, count_status, code, active
      ) VALUES (
        p_college, (v->>'_program_id')::uuid, (v->>'_level_id')::uuid, v->>'study_system',
        (v->>'entry_year')::int, (v->>'_term_id')::uuid,
        COALESCE(NULLIF(v->>'expected_students', '')::int, 0),
        COALESCE(NULLIF(v->>'count_status', ''), 'estimated'),
        NULLIF(v->>'code', ''), COALESCE(NULLIF(v->>'active', '')::boolean, true)
      );
      v_ins := v_ins + 1;
    ELSE
      UPDATE public.academic_cohorts SET
        expected_students = COALESCE(NULLIF(v->>'expected_students', '')::int, 0),
        count_status = COALESCE(NULLIF(v->>'count_status', ''), 'estimated'),
        code = NULLIF(v->>'code', ''),
        active = COALESCE(NULLIF(v->>'active', '')::boolean, true)
      WHERE id = v_id;
      v_upd := v_upd + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skp);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Custom: course_offerings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_apply_course_offerings(
  p_college uuid, p_mode text, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int;
  v jsonb;
  v_rn int;
  v_prog uuid;
  v_id uuid;
  v_exists boolean;
  v_action text;
  v_ins int := 0; v_upd int := 0; v_skp int := 0;
BEGIN
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    IF NULLIF(v->>'_term_id', '') IS NULL OR NULLIF(v->>'_course_id', '') IS NULL THEN
      RAISE EXCEPTION 'course_offerings row % missing term/course', v_rn USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_prog := NULLIF(v->>'_program_id', '')::uuid;
    v_id := NULL;
    IF v_prog IS NOT NULL THEN
      SELECT id INTO v_id FROM public.course_offerings
        WHERE college_id = p_college AND term_id = (v->>'_term_id')::uuid
          AND course_id = (v->>'_course_id')::uuid AND program_id = v_prog
        ORDER BY id ASC LIMIT 1 FOR UPDATE;
    ELSE
      SELECT id INTO v_id FROM public.course_offerings
        WHERE college_id = p_college AND term_id = (v->>'_term_id')::uuid
          AND course_id = (v->>'_course_id')::uuid AND program_id IS NULL
        ORDER BY id ASC LIMIT 1 FOR UPDATE;
    END IF;
    v_exists := v_id IS NOT NULL;
    v_action := public._import_mode_action(p_mode, v_exists);
    IF v_action = 'skip' THEN
      v_skp := v_skp + 1;
    ELSIF v_action = 'insert' THEN
      INSERT INTO public.course_offerings (
        college_id, term_id, course_id, program_id, level_id, study_plan_id, plan_course_id,
        expected_students, sections_count, status, is_active, notes
      ) VALUES (
        p_college, (v->>'_term_id')::uuid, (v->>'_course_id')::uuid, v_prog,
        NULLIF(v->>'_level_id', '')::uuid, NULLIF(v->>'_study_plan_id', '')::uuid,
        NULLIF(v->>'_plan_course_id', '')::uuid,
        COALESCE(NULLIF(v->>'expected_students', '')::int, 0),
        COALESCE(NULLIF(v->>'sections_count', '')::int, 1),
        COALESCE(NULLIF(v->>'status', ''), 'draft'),
        COALESCE(NULLIF(v->>'is_active', '')::boolean, true),
        NULLIF(v->>'notes', '')
      );
      v_ins := v_ins + 1;
    ELSE
      UPDATE public.course_offerings SET
        level_id = NULLIF(v->>'_level_id', '')::uuid,
        study_plan_id = NULLIF(v->>'_study_plan_id', '')::uuid,
        plan_course_id = NULLIF(v->>'_plan_course_id', '')::uuid,
        expected_students = COALESCE(NULLIF(v->>'expected_students', '')::int, 0),
        sections_count = COALESCE(NULLIF(v->>'sections_count', '')::int, 1),
        status = COALESCE(NULLIF(v->>'status', ''), 'draft'),
        is_active = COALESCE(NULLIF(v->>'is_active', '')::boolean, true),
        notes = NULLIF(v->>'notes', '')
      WHERE id = v_id;
      v_upd := v_upd + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skp);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Custom: teaching_assignments (legacy V1)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_apply_teaching_assignments(
  p_college uuid, p_mode text, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int;
  v jsonb;
  v_rn int;
  v_offering uuid;
  v_section uuid;
  v_id uuid;
  v_exists boolean;
  v_action text;
  v_ins int := 0; v_upd int := 0; v_skp int := 0;
BEGIN
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    IF NULLIF(v->>'_term_id', '') IS NULL OR NULLIF(v->>'_course_id', '') IS NULL
       OR NULLIF(v->>'_instructor_id', '') IS NULL OR NULLIF(v->>'session_type', '') IS NULL THEN
      RAISE EXCEPTION 'teaching_assignments row % missing term/course/instructor/session_type', v_rn USING ERRCODE = '22023';
    END IF;
    -- offering must resolve
    PERFORM 1 FROM public.course_offerings
      WHERE college_id = p_college AND term_id = (v->>'_term_id')::uuid
        AND course_id = (v->>'_course_id')::uuid LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'teaching_assignments row %: no matching course offering', v_rn USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_offering := NULL; v_section := NULL; v_id := NULL;

    SELECT id INTO v_offering FROM public.course_offerings
      WHERE college_id = p_college AND term_id = (v->>'_term_id')::uuid
        AND course_id = (v->>'_course_id')::uuid
      ORDER BY id ASC LIMIT 1;
    IF v_offering IS NULL THEN
      RAISE EXCEPTION 'teaching_assignments: no matching course offering' USING ERRCODE = '22023';
    END IF;

    IF NULLIF(v->>'section_number', '') IS NOT NULL THEN
      SELECT id INTO v_section FROM public.sections
        WHERE college_id = p_college AND course_id = (v->>'_course_id')::uuid
          AND term_id = (v->>'_term_id')::uuid AND section_number = (v->>'section_number')
        ORDER BY id ASC LIMIT 1;
    END IF;

    SELECT id INTO v_id FROM public.teaching_assignments
      WHERE college_id = p_college AND course_offering_id = v_offering
        AND instructor_id = (v->>'_instructor_id')::uuid
        AND session_type = v->>'session_type'
        AND COALESCE(section_number, '') = COALESCE(NULLIF(v->>'section_number', ''), '')
      ORDER BY id ASC LIMIT 1 FOR UPDATE;
    v_exists := v_id IS NOT NULL;
    v_action := public._import_mode_action(p_mode, v_exists);
    IF v_action = 'skip' THEN
      v_skp := v_skp + 1;
    ELSIF v_action = 'insert' THEN
      INSERT INTO public.teaching_assignments (
        college_id, course_offering_id, instructor_id, session_type, section_number, section_id,
        weekly_hours, expected_students, required_room_type, notes
      ) VALUES (
        p_college, v_offering, (v->>'_instructor_id')::uuid, v->>'session_type',
        NULLIF(v->>'section_number', ''), v_section,
        COALESCE(NULLIF(v->>'weekly_hours', '')::numeric, 3),
        COALESCE(NULLIF(v->>'expected_students', '')::int, 0),
        NULLIF(v->>'required_room_type', ''), NULLIF(v->>'notes', '')
      );
      v_ins := v_ins + 1;
    ELSE
      UPDATE public.teaching_assignments SET
        section_number = NULLIF(v->>'section_number', ''),
        section_id = v_section,
        weekly_hours = COALESCE(NULLIF(v->>'weekly_hours', '')::numeric, 3),
        expected_students = COALESCE(NULLIF(v->>'expected_students', '')::int, 0),
        required_room_type = NULLIF(v->>'required_room_type', ''),
        notes = NULLIF(v->>'notes', '')
      WHERE id = v_id;
      v_upd := v_upd + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skp);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Custom: course_programs (pure link table; existing -> skip)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_apply_course_programs(
  p_college uuid, p_mode text, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int;
  v jsonb;
  v_rn int;
  v_id uuid;
  v_exists boolean;
  v_ins int := 0; v_upd int := 0; v_skp int := 0;
BEGIN
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    IF NULLIF(v->>'_course_id', '') IS NULL OR NULLIF(v->>'_program_id', '') IS NULL THEN
      RAISE EXCEPTION 'course_programs row % missing course/program', v_rn USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_id := NULL;
    SELECT id INTO v_id FROM public.course_programs
      WHERE college_id = p_college AND course_id = (v->>'_course_id')::uuid
        AND program_id = (v->>'_program_id')::uuid
      ORDER BY id ASC LIMIT 1 FOR UPDATE;
    v_exists := v_id IS NOT NULL;
    IF v_exists THEN
      -- Pure link: nothing meaningful to update, always skip when present.
      v_skp := v_skp + 1;
    ELSIF p_mode = 'update_existing' THEN
      v_skp := v_skp + 1;
    ELSE
      INSERT INTO public.course_programs (college_id, course_id, program_id)
      VALUES (p_college, (v->>'_course_id')::uuid, (v->>'_program_id')::uuid);
      v_ins := v_ins + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skp);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Custom: section_groups (+ members)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_apply_section_groups(
  p_college uuid, p_mode text, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int;
  v jsonb;
  v_rn int;
  v_members jsonb;
  v_group uuid;
  v_exists boolean;
  v_action text;
  v_expected_total int;
  v_num text;
  v_sec_id uuid;
  v_sec_cap int;
  v_ins int := 0; v_upd int := 0; v_skp int := 0;
BEGIN
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    v_members := v->'member_section_numbers';
    IF NULLIF(v->>'_term_id', '') IS NULL OR NULLIF(v->>'_course_id', '') IS NULL
       OR NULLIF(v->>'group_name', '') IS NULL THEN
      RAISE EXCEPTION 'section_groups row % missing term/course/group_name', v_rn USING ERRCODE = '22023';
    END IF;
    IF v_members IS NULL OR jsonb_typeof(v_members) <> 'array' OR jsonb_array_length(v_members) = 0 THEN
      RAISE EXCEPTION 'section_groups row % requires at least one member section', v_rn USING ERRCODE = '22023';
    END IF;
    -- every member section must resolve
    FOR v_num IN SELECT jsonb_array_elements_text(v_members) LOOP
      PERFORM 1 FROM public.sections
        WHERE college_id = p_college AND course_id = (v->>'_course_id')::uuid
          AND term_id = (v->>'_term_id')::uuid AND section_number = v_num LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'section_groups row %: member section % not found', v_rn, v_num USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;

  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_members := v->'member_section_numbers';
    v_group := NULL;

    SELECT COALESCE(SUM(COALESCE(s.capacity, 0)), 0)::int INTO v_expected_total
    FROM jsonb_array_elements_text(v_members) AS m(num)
    JOIN public.sections s
      ON s.college_id = p_college AND s.course_id = (v->>'_course_id')::uuid
     AND s.term_id = (v->>'_term_id')::uuid AND s.section_number = m.num;

    SELECT id INTO v_group FROM public.section_groups
      WHERE college_id = p_college AND academic_term_id = (v->>'_term_id')::uuid
        AND course_id = (v->>'_course_id')::uuid AND group_name = v->>'group_name'
      ORDER BY id ASC LIMIT 1 FOR UPDATE;
    v_exists := v_group IS NOT NULL;
    v_action := public._import_mode_action(p_mode, v_exists);

    IF v_action = 'skip' THEN
      v_skp := v_skp + 1;
      CONTINUE;
    ELSIF v_action = 'update' THEN
      UPDATE public.section_groups SET
        expected_students_total = v_expected_total,
        notes = NULLIF(v->>'notes', '')
      WHERE id = v_group;
      DELETE FROM public.section_group_members
        WHERE section_group_id = v_group AND college_id = p_college;
      v_upd := v_upd + 1;
    ELSE
      INSERT INTO public.section_groups (
        college_id, academic_term_id, course_id, group_name, expected_students_total, notes
      ) VALUES (
        p_college, (v->>'_term_id')::uuid, (v->>'_course_id')::uuid, v->>'group_name',
        v_expected_total, NULLIF(v->>'notes', '')
      ) RETURNING id INTO v_group;
      v_ins := v_ins + 1;
    END IF;

    -- (re)insert members within the same transaction
    FOR v_num IN SELECT jsonb_array_elements_text(v_members) LOOP
      SELECT id, COALESCE(capacity, 0) INTO v_sec_id, v_sec_cap FROM public.sections
        WHERE college_id = p_college AND course_id = (v->>'_course_id')::uuid
          AND term_id = (v->>'_term_id')::uuid AND section_number = v_num
        ORDER BY id ASC LIMIT 1;
      INSERT INTO public.section_group_members (college_id, section_group_id, section_id, expected_students)
      VALUES (p_college, v_group, v_sec_id, v_sec_cap);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skp);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Custom: elective_slot_courses (insert if missing else skip)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_apply_elective_slot_courses(
  p_college uuid, p_mode text, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int;
  v jsonb;
  v_rn int;
  v_id uuid;
  v_exists boolean;
  v_ins int := 0; v_upd int := 0; v_skp int := 0;
BEGIN
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    IF NULLIF(v->>'_elective_slot_id', '') IS NULL OR NULLIF(v->>'_course_id', '') IS NULL THEN
      RAISE EXCEPTION 'elective_slot_courses row % missing slot/course', v_rn USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_id := NULL;
    SELECT id INTO v_id FROM public.elective_slot_courses
      WHERE college_id = p_college AND elective_slot_id = (v->>'_elective_slot_id')::uuid
        AND course_id = (v->>'_course_id')::uuid
      ORDER BY id ASC LIMIT 1 FOR UPDATE;
    v_exists := v_id IS NOT NULL;
    IF v_exists THEN
      v_skp := v_skp + 1;                 -- link exists: always skip
    ELSIF p_mode = 'update_existing' THEN
      v_skp := v_skp + 1;
    ELSE
      INSERT INTO public.elective_slot_courses (college_id, elective_slot_id, course_id)
      VALUES (p_college, (v->>'_elective_slot_id')::uuid, (v->>'_course_id')::uuid);
      v_ins := v_ins + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skp);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Custom: cohort_elective_selections (upsert by cohort+slot)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_apply_cohort_elective_selections(
  p_college uuid, p_mode text, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int;
  v jsonb;
  v_rn int;
  v_id uuid;
  v_exists boolean;
  v_action text;
  v_ins int := 0; v_upd int := 0; v_skp int := 0;
BEGIN
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    IF NULLIF(v->>'_cohort_id', '') IS NULL OR NULLIF(v->>'_elective_slot_id', '') IS NULL
       OR NULLIF(v->>'_course_id', '') IS NULL THEN
      RAISE EXCEPTION 'cohort_elective_selections row % missing cohort/slot/course', v_rn USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_id := NULL;
    SELECT id INTO v_id FROM public.cohort_elective_selections
      WHERE college_id = p_college AND cohort_id = (v->>'_cohort_id')::uuid
        AND elective_slot_id = (v->>'_elective_slot_id')::uuid
      ORDER BY id ASC LIMIT 1 FOR UPDATE;
    v_exists := v_id IS NOT NULL;
    v_action := public._import_mode_action(p_mode, v_exists);
    IF v_action = 'skip' THEN
      v_skp := v_skp + 1;
    ELSIF v_action = 'insert' THEN
      INSERT INTO public.cohort_elective_selections (
        college_id, cohort_id, elective_slot_id, selected_course_id
      ) VALUES (
        p_college, (v->>'_cohort_id')::uuid, (v->>'_elective_slot_id')::uuid, (v->>'_course_id')::uuid
      );
      v_ins := v_ins + 1;
    ELSE
      UPDATE public.cohort_elective_selections SET
        selected_course_id = (v->>'_course_id')::uuid
      WHERE id = v_id;
      v_upd := v_upd + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skp);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Study plan internal find-or-create + component sync helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_find_or_create_study_plan(p_college uuid, v jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ver text := COALESCE(NULLIF(v->>'plan_version', ''), '1');
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.study_plans
    WHERE college_id = p_college AND program_id = (v->>'_program_id')::uuid
      AND code = v->>'plan_code' AND version = v_ver
    ORDER BY id ASC LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  INSERT INTO public.study_plans (college_id, program_id, code, name, version, effective_year)
  VALUES (
    p_college, (v->>'_program_id')::uuid, v->>'plan_code',
    COALESCE(NULLIF(v->>'plan_name', ''), v->>'plan_code'), v_ver,
    NULLIF(v->>'effective_year', '')::int
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._import_find_or_create_level(p_college uuid, p_program uuid, p_level int)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.academic_levels
    WHERE college_id = p_college AND program_id = p_program AND level_number = p_level
    ORDER BY id ASC LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  INSERT INTO public.academic_levels (college_id, program_id, level_number, name)
  VALUES (p_college, p_program, p_level, 'المستوى ' || p_level::text)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public._import_find_or_create_course(p_college uuid, v jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.courses
    WHERE college_id = p_college AND code = v->>'course_code'
    ORDER BY id ASC LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  INSERT INTO public.courses (
    college_id, department_id, code, name, credit_hours, theory_hours, practical_hours,
    course_nature, is_shared
  ) VALUES (
    p_college, NULLIF(v->>'_department_id', '')::uuid, v->>'course_code', v->>'course_name',
    COALESCE(NULLIF(v->>'credit_hours', '')::numeric, 3),
    COALESCE(NULLIF(v->>'theory_hours', '')::numeric, 0),
    COALESCE(NULLIF(v->>'practical_hours', '')::numeric, 0),
    COALESCE(NULLIF(v->>'course_nature', ''), 'department'),
    COALESCE(NULLIF(v->>'is_shared', '')::boolean, false)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$;

-- Port of derivePlanCourseComponents: build components strictly from explicit
-- hour fields/flags (credit_hours is ignored) and upsert them by component_type.
CREATE OR REPLACE FUNCTION public._import_sync_plan_course_components(
  p_college uuid, p_plan_course uuid, v jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_theory numeric := COALESCE(NULLIF(v->>'theory_hours', '')::numeric, 0);
  v_practical numeric := COALESCE(NULLIF(v->>'practical_hours', '')::numeric, 0);
  v_tutorial numeric := COALESCE(NULLIF(v->>'tutorial_hours', '')::numeric, 0)
                        + COALESCE(NULLIF(v->>'training_hours', '')::numeric, 0);
  v_project numeric := COALESCE(NULLIF(v->>'project_hours', '')::numeric, 0);
  v_summer boolean := COALESCE(NULLIF(v->>'is_summer_training', '')::boolean, false);
  v_grad boolean := COALESCE(NULLIF(v->>'is_graduation_project', '')::boolean, false);
  v_training numeric := COALESCE(NULLIF(v->>'training_hours', '')::numeric, 0);
BEGIN
  IF v_theory > 0 THEN
    INSERT INTO public.plan_course_components (
      college_id, plan_course_id, component_type, weekly_contact_hours,
      is_timetabled, counts_toward_regular_load, counts_toward_overtime, compensation_mode
    ) VALUES (p_college, p_plan_course, 'theory', v_theory, true, true, true, 'per_hour')
    ON CONFLICT (plan_course_id, component_type) DO UPDATE SET
      weekly_contact_hours = EXCLUDED.weekly_contact_hours,
      is_timetabled = EXCLUDED.is_timetabled,
      counts_toward_regular_load = EXCLUDED.counts_toward_regular_load,
      counts_toward_overtime = EXCLUDED.counts_toward_overtime,
      compensation_mode = EXCLUDED.compensation_mode;
  END IF;

  IF v_practical > 0 THEN
    INSERT INTO public.plan_course_components (
      college_id, plan_course_id, component_type, weekly_contact_hours,
      is_timetabled, counts_toward_regular_load, counts_toward_overtime, compensation_mode
    ) VALUES (p_college, p_plan_course, 'practical', v_practical, true, true, true, 'per_hour')
    ON CONFLICT (plan_course_id, component_type) DO UPDATE SET
      weekly_contact_hours = EXCLUDED.weekly_contact_hours,
      is_timetabled = EXCLUDED.is_timetabled,
      counts_toward_regular_load = EXCLUDED.counts_toward_regular_load,
      counts_toward_overtime = EXCLUDED.counts_toward_overtime,
      compensation_mode = EXCLUDED.compensation_mode;
  END IF;

  IF v_tutorial > 0 AND NOT v_summer THEN
    INSERT INTO public.plan_course_components (
      college_id, plan_course_id, component_type, weekly_contact_hours,
      is_timetabled, counts_toward_regular_load, counts_toward_overtime, compensation_mode
    ) VALUES (p_college, p_plan_course, 'tutorial', v_tutorial, true, true, true, 'per_hour')
    ON CONFLICT (plan_course_id, component_type) DO UPDATE SET
      weekly_contact_hours = EXCLUDED.weekly_contact_hours,
      is_timetabled = EXCLUDED.is_timetabled,
      counts_toward_regular_load = EXCLUDED.counts_toward_regular_load,
      counts_toward_overtime = EXCLUDED.counts_toward_overtime,
      compensation_mode = EXCLUDED.compensation_mode;
  END IF;

  IF v_project > 0 OR v_grad THEN
    INSERT INTO public.plan_course_components (
      college_id, plan_course_id, component_type, weekly_contact_hours,
      is_timetabled, counts_toward_regular_load, counts_toward_overtime, compensation_mode
    ) VALUES (
      p_college, p_plan_course, 'project', CASE WHEN v_project > 0 THEN v_project ELSE 0 END,
      true, false, false, 'none'
    )
    ON CONFLICT (plan_course_id, component_type) DO UPDATE SET
      weekly_contact_hours = EXCLUDED.weekly_contact_hours,
      is_timetabled = EXCLUDED.is_timetabled,
      counts_toward_regular_load = EXCLUDED.counts_toward_regular_load,
      counts_toward_overtime = EXCLUDED.counts_toward_overtime,
      compensation_mode = EXCLUDED.compensation_mode;
  END IF;

  IF v_summer THEN
    INSERT INTO public.plan_course_components (
      college_id, plan_course_id, component_type, weekly_contact_hours,
      is_timetabled, counts_toward_regular_load, counts_toward_overtime, compensation_mode
    ) VALUES (
      p_college, p_plan_course, 'summer_training',
      CASE WHEN v_tutorial > 0 THEN v_tutorial ELSE v_training END,
      false, false, false, 'none'
    )
    ON CONFLICT (plan_course_id, component_type) DO UPDATE SET
      weekly_contact_hours = EXCLUDED.weekly_contact_hours,
      is_timetabled = EXCLUDED.is_timetabled,
      counts_toward_regular_load = EXCLUDED.counts_toward_regular_load,
      counts_toward_overtime = EXCLUDED.counts_toward_overtime,
      compensation_mode = EXCLUDED.compensation_mode;
  END IF;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Custom: study_plan (study_plan_courses + full_study_plan)
-- Does NOT create sections. Elective-slot rows create elective_slots only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_apply_study_plan(
  p_college uuid, p_mode text, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int;
  v jsonb;
  v_rn int;
  v_plan uuid;
  v_level uuid;
  v_course uuid;
  v_slot_code text;
  v_is_slot boolean;
  v_id uuid;
  v_exists boolean;
  v_action text;
  v_plan_course uuid;
  v_ins int := 0; v_upd int := 0; v_skp int := 0;
BEGIN
  -- Phase 1: pre-validate required identity fields.
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    IF NULLIF(v->>'_program_id', '') IS NULL OR NULLIF(v->>'plan_code', '') IS NULL THEN
      RAISE EXCEPTION 'study_plan row % missing program/plan_code', v_rn USING ERRCODE = '22023';
    END IF;
    v_is_slot := COALESCE(NULLIF(v->>'is_elective_slot', '')::boolean, false)
      OR (NULLIF(v->>'elective_slot_code', '') IS NOT NULL
          AND public._import_is_elective_placeholder(COALESCE(NULLIF(v->>'course_code', ''), v->>'elective_slot_code')));
    IF NOT v_is_slot THEN
      IF NULLIF(v->>'course_code', '') IS NULL OR NULLIF(v->>'course_name', '') IS NULL THEN
        RAISE EXCEPTION 'study_plan row % missing course_code/course_name', v_rn USING ERRCODE = '22023';
      END IF;
    END IF;
  END LOOP;

  -- Phase 2: apply.
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_plan := public._import_find_or_create_study_plan(p_college, v);
    v_level := NULL;
    IF NULLIF(v->>'level_number', '') IS NOT NULL THEN
      v_level := public._import_find_or_create_level(
        p_college, (v->>'_program_id')::uuid, (v->>'level_number')::int
      );
    END IF;

    v_is_slot := COALESCE(NULLIF(v->>'is_elective_slot', '')::boolean, false)
      OR (NULLIF(v->>'elective_slot_code', '') IS NOT NULL
          AND public._import_is_elective_placeholder(COALESCE(NULLIF(v->>'course_code', ''), v->>'elective_slot_code')));

    IF v_is_slot THEN
      v_slot_code := COALESCE(NULLIF(v->>'elective_slot_code', ''), v->>'course_code');
      v_id := NULL;
      SELECT id INTO v_id FROM public.elective_slots
        WHERE college_id = p_college AND study_plan_id = v_plan AND slot_code = v_slot_code
        ORDER BY id ASC LIMIT 1 FOR UPDATE;
      v_exists := v_id IS NOT NULL;
      v_action := public._import_mode_action(p_mode, v_exists);
      IF v_action = 'skip' THEN
        v_skp := v_skp + 1;
      ELSIF v_action = 'insert' THEN
        INSERT INTO public.elective_slots (
          college_id, study_plan_id, level_id, semester, slot_code, label,
          required_component_type, active
        ) VALUES (
          p_college, v_plan, v_level, COALESCE(NULLIF(v->>'semester', '')::int, 1),
          v_slot_code, COALESCE(NULLIF(v->>'course_name', ''), v_slot_code), 'theory', true
        );
        v_ins := v_ins + 1;
      ELSE
        UPDATE public.elective_slots SET
          level_id = v_level,
          semester = COALESCE(NULLIF(v->>'semester', '')::int, 1),
          label = COALESCE(NULLIF(v->>'course_name', ''), v_slot_code),
          required_component_type = 'theory',
          active = true
        WHERE id = v_id;
        v_upd := v_upd + 1;
      END IF;
      CONTINUE;
    END IF;

    -- Regular plan course row.
    v_course := public._import_find_or_create_course(p_college, v);
    v_plan_course := NULL;
    SELECT id INTO v_plan_course FROM public.plan_courses
      WHERE college_id = p_college AND study_plan_id = v_plan AND course_id = v_course
      ORDER BY id ASC LIMIT 1 FOR UPDATE;
    v_exists := v_plan_course IS NOT NULL;
    v_action := public._import_mode_action(p_mode, v_exists);

    IF v_action = 'skip' THEN
      v_skp := v_skp + 1;
      CONTINUE;
    ELSIF v_action = 'update' THEN
      UPDATE public.plan_courses SET
        level_id = v_level,
        semester = COALESCE(NULLIF(v->>'semester', '')::int, 1),
        is_required = COALESCE(NULLIF(v->>'is_required', '')::boolean, true),
        lectures_per_week = COALESCE(NULLIF(v->>'lectures_per_week', '')::int, 0),
        lecture_session_duration = COALESCE(NULLIF(v->>'lecture_session_duration', '')::numeric, 2),
        labs_per_week = COALESCE(NULLIF(v->>'labs_per_week', '')::int, 0),
        lab_session_duration = COALESCE(NULLIF(v->>'lab_session_duration', '')::numeric, 2),
        required_room_type_for_lecture = NULLIF(v->>'required_room_type_for_lecture', ''),
        required_room_type_for_lab = NULLIF(v->>'required_room_type_for_lab', '')
      WHERE id = v_plan_course;
      v_upd := v_upd + 1;
    ELSE
      INSERT INTO public.plan_courses (
        college_id, study_plan_id, course_id, level_id, semester, is_required,
        lectures_per_week, lecture_session_duration, labs_per_week, lab_session_duration,
        required_room_type_for_lecture, required_room_type_for_lab
      ) VALUES (
        p_college, v_plan, v_course, v_level, COALESCE(NULLIF(v->>'semester', '')::int, 1),
        COALESCE(NULLIF(v->>'is_required', '')::boolean, true),
        COALESCE(NULLIF(v->>'lectures_per_week', '')::int, 0),
        COALESCE(NULLIF(v->>'lecture_session_duration', '')::numeric, 2),
        COALESCE(NULLIF(v->>'labs_per_week', '')::int, 0),
        COALESCE(NULLIF(v->>'lab_session_duration', '')::numeric, 2),
        NULLIF(v->>'required_room_type_for_lecture', ''),
        NULLIF(v->>'required_room_type_for_lab', '')
      ) RETURNING id INTO v_plan_course;
      v_ins := v_ins + 1;
    END IF;

    IF v_plan_course IS NOT NULL THEN
      PERFORM public._import_sync_plan_course_components(p_college, v_plan_course, v);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'skipped', v_skp);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Custom: teaching_assignments_v2 — transform stored ParsedRows into the V2
-- payload and delegate to the existing atomic RPC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_apply_teaching_assignments_v2(
  p_college uuid, p_mode text, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_len int := COALESCE(jsonb_array_length(p_rows), 0);
  v_idx int;
  v jsonb;
  v_rn int;
  v_payload jsonb;
  v_res jsonb;
BEGIN
  -- Pre-validate: required resolved fields; summer training is forbidden here.
  FOR v_idx IN 0 .. v_len - 1 LOOP
    v := public._import_row_values(p_rows -> v_idx);
    v_rn := public._import_row_number(p_rows -> v_idx, v_idx + 1);
    IF NULLIF(v->>'_delivery_group_id', '') IS NULL OR NULLIF(v->>'_instructor_id', '') IS NULL THEN
      RAISE EXCEPTION 'teaching_assignments_v2 row % missing delivery_group/instructor', v_rn USING ERRCODE = '22023';
    END IF;
    IF v->>'component_type' = 'summer_training' THEN
      RAISE EXCEPTION 'teaching_assignments_v2 row %: summer training cannot be assigned as weekly teaching', v_rn USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Build the V2 payload array in row order.
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'row_number', public._import_row_number(p_rows -> ord, ord + 1),
      'delivery_group_id', vv->>'_delivery_group_id',
      'instructor_id', vv->>'_instructor_id',
      'assigned_component_hours',
        CASE
          WHEN NULLIF(vv->>'_assigned_component_hours', '') IS NOT NULL
            THEN (vv->>'_assigned_component_hours')::numeric
          WHEN NULLIF(vv->>'assigned_component_hours', '') IS NOT NULL
            THEN (vv->>'assigned_component_hours')::numeric
          ELSE NULL
        END,
      'notes', NULLIF(vv->>'notes', ''),
      'is_active', COALESCE(NULLIF(vv->>'_is_active', '')::boolean, true),
      'course_offering_id', NULLIF(vv->>'_offering_id', ''),
      'expected_students', COALESCE(NULLIF(vv->>'expected_students', '')::int, 0),
      'required_room_type', NULLIF(vv->>'required_room_type', ''),
      'session_type', CASE vv->>'component_type'
        WHEN 'theory' THEN 'lecture'
        WHEN 'practical' THEN 'lab'
        WHEN 'tutorial' THEN 'tutorial'
        WHEN 'project' THEN 'seminar'
        WHEN 'summer_training' THEN 'seminar'
        ELSE 'lecture'
      END
    ) ORDER BY ord
  ), '[]'::jsonb)
  INTO v_payload
  FROM generate_series(0, GREATEST(v_len - 1, -1)) AS ord
  CROSS JOIN LATERAL (SELECT public._import_row_values(p_rows -> ord) AS vv) AS lat;

  IF jsonb_array_length(v_payload) = 0 THEN
    RETURN public._import_counters_new();
  END IF;

  -- Delegate to the existing atomic V2 RPC (co-teaching split + all V2 gates
  -- enforced inside it). On any non-ok result, RAISE to roll everything back.
  v_res := public.commit_teaching_assignments_v2_import(v_payload, p_mode);
  IF COALESCE(v_res->>'status', '') <> 'ok' THEN
    RAISE EXCEPTION 'teaching_assignments_v2 import failed: %',
      COALESCE(v_res->'validation_errors', '[]'::jsonb)::text
      USING ERRCODE = '22023';
  END IF;

  RETURN jsonb_build_object(
    'inserted', COALESCE((v_res->>'rows_created')::int, 0) + COALESCE((v_res->>'rows_reactivated')::int, 0),
    'updated',  COALESCE((v_res->>'rows_updated')::int, 0),
    'skipped',  COALESCE((v_res->>'rows_unchanged')::int, 0)
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Dispatcher
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._import_dispatch(
  p_college uuid, p_entity text, p_mode text, p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'import payload must be a jsonb array' USING ERRCODE = '22023';
  END IF;

  CASE p_entity
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
$fn$;

-- ---------------------------------------------------------------------------
-- Public entrypoint: atomic server-side commit
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_import_job_atomic(
  p_job_id uuid,
  p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_job public.import_jobs%ROWTYPE;
  v_actor uuid;
  v_college uuid;
  v_entity text;
  v_mode text;
  v_payload jsonb;
  v_counters jsonb;
BEGIN
  -- 1) Authentication is required before any job lookup or lock.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  -- 2) Lock the job row FOR UPDATE (prevents concurrent double-commit).
  SELECT * INTO v_job FROM public.import_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import job not found' USING ERRCODE = '55000';
  END IF;

  v_college := v_job.college_id;   -- college ALWAYS from the job, never the client/payload
  v_entity := v_job.target_entity; -- entity from job only
  v_mode := v_job.mode;            -- mode from job only

  -- 3) Require an authenticated import manager for the job's college.
  v_actor := public.import_manager_actor(v_college);

  -- 3) Actor must be the job creator.
  IF v_job.created_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'import job actor mismatch' USING ERRCODE = '42501';
  END IF;

  -- 4) Idempotent replay: already committed by the same actor -> return saved
  --    counters without re-writing anything.
  IF v_job.status = 'committed' THEN
    RETURN jsonb_build_object(
      'status', 'ok',
      'inserted', COALESCE(v_job.inserted_rows, 0),
      'updated', COALESCE(v_job.updated_rows, 0),
      'skipped', COALESCE(v_job.skipped_rows, 0),
      'failed', 0,
      'replay', true,
      'job_id', v_job.id,
      'entity', v_entity,
      'mode', v_mode,
      'college_id', v_college,
      'payload_manifest', v_job.payload_manifest
    );
  END IF;

  -- 5) Only a preview job may be committed atomically.
  IF v_job.status <> 'preview' THEN
    RAISE EXCEPTION 'import job is not in a committable (preview) state: %', v_job.status
      USING ERRCODE = '55000';
  END IF;

  -- 6) Optimistic-concurrency guard.
  IF p_expected_updated_at IS NOT NULL
     AND v_job.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'import job stale' USING ERRCODE = '40001';
  END IF;

  -- 7) Payload integrity: must be a jsonb array whose manifest matches.
  v_payload := v_job.validated_payload;
  IF v_payload IS NULL OR jsonb_typeof(v_payload) <> 'array' THEN
    RAISE EXCEPTION 'import validated_payload must be a jsonb array' USING ERRCODE = '22023';
  END IF;
  IF v_job.payload_manifest IS DISTINCT FROM md5(v_payload::text) THEN
    RAISE EXCEPTION 'import payload manifest mismatch' USING ERRCODE = '23000';
  END IF;

  -- 8) Apply all domain writes (pre-validated per entity before any DML). Any
  --    exception here rolls back the whole transaction (no partial success).
  v_counters := public._import_dispatch(v_college, v_entity, v_mode, v_payload);

  -- 9) Flip the job to committed with the resulting counters.
  UPDATE public.import_jobs SET
    status = 'committed',
    inserted_rows = (v_counters->>'inserted')::int,
    updated_rows = (v_counters->>'updated')::int,
    skipped_rows = (v_counters->>'skipped')::int,
    claimed_at = COALESCE(claimed_at, now()),
    finished_at = now()
  WHERE id = v_job.id AND status = 'preview';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'import job commit lost (concurrent state change)' USING ERRCODE = '40001';
  END IF;

  -- 10) Success audit (only reached when everything above succeeded).
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_actor, 'import_job_committed', 'import_' || v_entity, v_job.id, v_college,
    jsonb_build_object(
      'actor', v_actor,
      'college_id', v_college,
      'entity', v_entity,
      'mode', v_mode,
      'study_system', v_job.validated_payload -> 0 -> 'values' ->> 'study_system',
      'inserted', (v_counters->>'inserted')::int,
      'updated', (v_counters->>'updated')::int,
      'skipped', (v_counters->>'skipped')::int,
      'failed', 0,
      'job_id', v_job.id,
      'payload_manifest', v_job.payload_manifest
    )
  );

  RETURN jsonb_build_object(
    'status', 'ok',
    'inserted', (v_counters->>'inserted')::int,
    'updated', (v_counters->>'updated')::int,
    'skipped', (v_counters->>'skipped')::int,
    'failed', 0,
    'replay', false,
    'job_id', v_job.id,
    'entity', v_entity,
    'mode', v_mode,
    'college_id', v_college,
    'payload_manifest', v_job.payload_manifest
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- Grants: helpers are callable ONLY from the definer entrypoint (as its owner).
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._import_row_values(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_row_number(jsonb, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_counters_new() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_counters_add(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_mode_action(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_is_elective_placeholder(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_apply_table_entity(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_apply_sections(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_apply_academic_cohorts(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_apply_course_offerings(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_apply_teaching_assignments(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_apply_course_programs(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_apply_section_groups(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_apply_elective_slot_courses(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_apply_cohort_elective_selections(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_find_or_create_study_plan(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_find_or_create_level(uuid, uuid, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_find_or_create_course(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_sync_plan_course_components(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_apply_study_plan(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_apply_teaching_assignments_v2(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._import_dispatch(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Public entrypoint: authenticated only (never anon). service_role optional.
REVOKE ALL ON FUNCTION public.commit_import_job_atomic(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commit_import_job_atomic(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_import_job_atomic(uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- Table ACL hardening: no direct client DML on import control tables.
-- Closes authenticated residual grants (re-assert 20260718180000), anon (never
-- granted in source but revoked for defense-in-depth), and PUBLIC (schema
-- default / membership inheritance). SELECT remains for authenticated UI reads
-- under existing RLS; service_role ALL unchanged (non-browser path).
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.import_jobs FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.import_errors FROM PUBLIC, anon, authenticated;

COMMIT;

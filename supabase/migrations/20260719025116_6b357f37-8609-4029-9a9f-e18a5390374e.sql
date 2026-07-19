-- SOURCE-ONLY / DO NOT AUTO-APPLY.
-- Fail-closed tenant-reference hardening for the academic-delivery V2 model.
-- This migration performs no business-data remediation and must not be applied
-- until the remote migration history and the preflight result are reviewed.

BEGIN;

DO $migration$
DECLARE
  r record;
  v_bad_rows bigint;
BEGIN
  FOR r IN
    SELECT DISTINCT child_table FROM (VALUES
      ('academic_cohorts'), ('plan_course_components'), ('elective_slots'),
      ('elective_slot_courses'), ('cohort_elective_selections'),
      ('delivery_groups'), ('teaching_assignments'), ('schedule_sessions')
    ) AS required(child_table)
  LOOP
    IF to_regclass(format('public.%I', r.child_table)) IS NULL THEN
      RAISE EXCEPTION 'CROSS_COLLEGE_PREFLIGHT_MISSING_TABLE: public.%', r.child_table;
    END IF;
  END LOOP;

  FOR r IN
    SELECT DISTINCT parent_table FROM (VALUES
      ('academic_programs'), ('academic_levels'), ('academic_terms'),
      ('plan_courses'), ('room_types'), ('study_plans'), ('elective_slots'),
      ('courses'), ('academic_cohorts'), ('plan_course_components'),
      ('delivery_groups')
    ) AS required(parent_table)
  LOOP
    IF to_regclass(format('public.%I', r.parent_table)) IS NULL THEN
      RAISE EXCEPTION 'CROSS_COLLEGE_PREFLIGHT_MISSING_TABLE: public.%', r.parent_table;
    END IF;
  END LOOP;

  FOR r IN
    SELECT * FROM (VALUES
      ('academic_cohorts','program_id','academic_programs','ac_program_college_fkey'),
      ('academic_cohorts','level_id','academic_levels','ac_level_college_fkey'),
      ('academic_cohorts','term_id','academic_terms','ac_term_college_fkey'),
      ('plan_course_components','plan_course_id','plan_courses','pcc_plan_course_college_fkey'),
      ('plan_course_components','required_room_type_id','room_types','pcc_room_type_college_fkey'),
      ('elective_slots','study_plan_id','study_plans','es_study_plan_college_fkey'),
      ('elective_slots','level_id','academic_levels','es_level_college_fkey'),
      ('elective_slot_courses','elective_slot_id','elective_slots','esc_slot_college_fkey'),
      ('elective_slot_courses','course_id','courses','esc_course_college_fkey'),
      ('cohort_elective_selections','cohort_id','academic_cohorts','ces_cohort_college_fkey'),
      ('cohort_elective_selections','elective_slot_id','elective_slots','ces_slot_college_fkey'),
      ('cohort_elective_selections','selected_course_id','courses','ces_course_college_fkey'),
      ('delivery_groups','cohort_id','academic_cohorts','dg_cohort_college_fkey'),
      ('delivery_groups','plan_course_id','plan_courses','dg_plan_course_college_fkey'),
      ('delivery_groups','component_id','plan_course_components','dg_component_college_fkey'),
      ('teaching_assignments','cohort_id','academic_cohorts','ta_cohort_college_fkey'),
      ('teaching_assignments','plan_course_component_id','plan_course_components','ta_component_college_fkey'),
      ('teaching_assignments','delivery_group_id','delivery_groups','ta_delivery_group_college_fkey'),
      ('schedule_sessions','cohort_id','academic_cohorts','ss_cohort_college_fkey'),
      ('schedule_sessions','plan_course_component_id','plan_course_components','ss_component_college_fkey'),
      ('schedule_sessions','delivery_group_id','delivery_groups','ss_delivery_group_college_fkey')
    ) AS refs(child_table, child_column, parent_table, constraint_name)
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I c WHERE c.%I IS NOT NULL AND NOT EXISTS '
      || '(SELECT 1 FROM public.%I p WHERE p.id = c.%I AND p.college_id = c.college_id)',
      r.child_table, r.child_column, r.parent_table, r.child_column
    ) INTO v_bad_rows;
    IF v_bad_rows <> 0 THEN
      RAISE EXCEPTION 'CROSS_COLLEGE_PREFLIGHT_FAILED: %.% -> % (% invalid rows)',
        r.child_table, r.child_column, r.parent_table, v_bad_rows;
    END IF;
  END LOOP;

  FOR r IN
    SELECT * FROM (VALUES
      ('academic_programs','academic_programs_id_college_key'),
      ('academic_levels','academic_levels_id_college_key'),
      ('academic_terms','academic_terms_id_college_key'),
      ('plan_courses','plan_courses_id_college_key'),
      ('room_types','room_types_id_college_key'),
      ('study_plans','study_plans_id_college_key'),
      ('elective_slots','elective_slots_id_college_key'),
      ('courses','courses_id_college_key'),
      ('academic_cohorts','academic_cohorts_id_college_key'),
      ('plan_course_components','pcc_id_college_key'),
      ('delivery_groups','delivery_groups_id_college_key')
    ) AS parents(parent_table, constraint_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.constraint_name
                   AND conrelid = format('public.%I', r.parent_table)::regclass) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE (id, college_id)',
                     r.parent_table, r.constraint_name);
    END IF;
  END LOOP;

  FOR r IN
    SELECT * FROM (VALUES
      ('academic_cohorts','program_id','academic_programs','ac_program_college_fkey'),
      ('academic_cohorts','level_id','academic_levels','ac_level_college_fkey'),
      ('academic_cohorts','term_id','academic_terms','ac_term_college_fkey'),
      ('plan_course_components','plan_course_id','plan_courses','pcc_plan_course_college_fkey'),
      ('plan_course_components','required_room_type_id','room_types','pcc_room_type_college_fkey'),
      ('elective_slots','study_plan_id','study_plans','es_study_plan_college_fkey'),
      ('elective_slots','level_id','academic_levels','es_level_college_fkey'),
      ('elective_slot_courses','elective_slot_id','elective_slots','esc_slot_college_fkey'),
      ('elective_slot_courses','course_id','courses','esc_course_college_fkey'),
      ('cohort_elective_selections','cohort_id','academic_cohorts','ces_cohort_college_fkey'),
      ('cohort_elective_selections','elective_slot_id','elective_slots','ces_slot_college_fkey'),
      ('cohort_elective_selections','selected_course_id','courses','ces_course_college_fkey'),
      ('delivery_groups','cohort_id','academic_cohorts','dg_cohort_college_fkey'),
      ('delivery_groups','plan_course_id','plan_courses','dg_plan_course_college_fkey'),
      ('delivery_groups','component_id','plan_course_components','dg_component_college_fkey'),
      ('teaching_assignments','cohort_id','academic_cohorts','ta_cohort_college_fkey'),
      ('teaching_assignments','plan_course_component_id','plan_course_components','ta_component_college_fkey'),
      ('teaching_assignments','delivery_group_id','delivery_groups','ta_delivery_group_college_fkey'),
      ('schedule_sessions','cohort_id','academic_cohorts','ss_cohort_college_fkey'),
      ('schedule_sessions','plan_course_component_id','plan_course_components','ss_component_college_fkey'),
      ('schedule_sessions','delivery_group_id','delivery_groups','ss_delivery_group_college_fkey')
    ) AS refs(child_table, child_column, parent_table, constraint_name)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.constraint_name
               AND conrelid = format('public.%I', r.child_table)::regclass) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        WHERE c.conname = r.constraint_name
          AND c.conrelid = format('public.%I', r.child_table)::regclass
          AND c.contype = 'f'
          AND c.confrelid = format('public.%I', r.parent_table)::regclass
          AND c.conkey = ARRAY[
            (SELECT attnum FROM pg_attribute
             WHERE attrelid = c.conrelid AND attname = r.child_column AND NOT attisdropped),
            (SELECT attnum FROM pg_attribute
             WHERE attrelid = c.conrelid AND attname = 'college_id' AND NOT attisdropped)
          ]::smallint[]
          AND c.confkey = ARRAY[
            (SELECT attnum FROM pg_attribute
             WHERE attrelid = c.confrelid AND attname = 'id' AND NOT attisdropped),
            (SELECT attnum FROM pg_attribute
             WHERE attrelid = c.confrelid AND attname = 'college_id' AND NOT attisdropped)
          ]::smallint[]
          AND c.confdeltype = 'r'
          AND c.confupdtype = 'a'
      ) THEN
        RAISE EXCEPTION 'CROSS_COLLEGE_CONSTRAINT_NAME_COLLISION: %.%',
          r.child_table, r.constraint_name;
      END IF;
    ELSE
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I, college_id) '
        || 'REFERENCES public.%I (id, college_id) ON DELETE RESTRICT NOT VALID',
        r.child_table, r.constraint_name, r.child_column, r.parent_table
      );
    END IF;
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I',
                   r.child_table, r.constraint_name);

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conname = r.constraint_name
        AND c.conrelid = format('public.%I', r.child_table)::regclass
        AND c.contype = 'f'
        AND c.confrelid = format('public.%I', r.parent_table)::regclass
        AND c.conkey = ARRAY[
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = c.conrelid AND attname = r.child_column AND NOT attisdropped),
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = c.conrelid AND attname = 'college_id' AND NOT attisdropped)
        ]::smallint[]
        AND c.confkey = ARRAY[
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = c.confrelid AND attname = 'id' AND NOT attisdropped),
          (SELECT attnum FROM pg_attribute
           WHERE attrelid = c.confrelid AND attname = 'college_id' AND NOT attisdropped)
        ]::smallint[]
        AND c.confdeltype = 'r'
        AND c.confupdtype = 'a'
        AND c.convalidated
    ) THEN
      RAISE EXCEPTION 'CROSS_COLLEGE_POSTCHECK_FAILED: %.%',
        r.child_table, r.constraint_name;
    END IF;
  END LOOP;
END
$migration$;

COMMIT;
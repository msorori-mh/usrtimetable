-- M-5: add the missing foreign keys and fix the purge maintenance-role check.
--
-- Foreign keys are added only when the column is not already covered by any
-- FK (so the migration is a no-op where production already has them), created
-- NOT VALID, then validated; if orphan rows exist the VALIDATE is skipped with
-- a NOTICE and the constraint still guards every new write.
-- ON DELETE semantics:
--   RESTRICT  for operational/history data (never cascade into published
--             schedule history);
--   CASCADE   only for college-owned configuration/seed rows, pure link
--             tables, derived rows (conflict_results) and version children that
--             already follow the existing CASCADE convention of
--             schedule_sessions/conflict_checks/auto_schedule_runs
--             (schedule_quality_runs). Published versions themselves cannot be
--             deleted (prevent_locked_schedule_version_delete);
--   SET NULL  where the sibling FKs already use it (instructors department,
--             rooms building).
-- Intentionally NOT constrained: audit_logs.entity_id (polymorphic),
-- deleted_study_plan_archives.study_plan_id (archive of deleted rows),
-- instructors.university_person_id (no canonical target table),
-- schedule_sessions.split_source_session_id / auto_schedule_run_id and
-- schedule_compaction_receipts.actor_id/operation_id (SET NULL would rewrite
-- schedule sessions through track-C write guards; left for track C).

CREATE SCHEMA IF NOT EXISTS security_private;
REVOKE ALL ON SCHEMA security_private FROM PUBLIC, anon, authenticated;

-- Records which constraints this migration created (used by the rollback so a
-- pre-existing production FK with the same default name is never dropped).
CREATE TABLE IF NOT EXISTS security_private.added_constraints (
  migration text NOT NULL,
  table_name text NOT NULL,
  constraint_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, constraint_name)
);
REVOKE ALL ON security_private.added_constraints FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION security_private.add_fk_if_missing(
  p_table text, p_column text, p_ref_table text, p_ref_column text, p_on_delete text)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_rel regclass := to_regclass('public.' || p_table);
  v_ref regclass := to_regclass('public.' || p_ref_table);
  v_att int2;
  v_name text;
BEGIN
  IF v_rel IS NULL OR v_ref IS NULL THEN
    RAISE NOTICE 'M-5: skip %.% -> % (table missing)', p_table, p_column, p_ref_table;
    RETURN;
  END IF;
  SELECT attnum INTO v_att FROM pg_attribute
   WHERE attrelid = v_rel AND attname = p_column AND NOT attisdropped;
  IF v_att IS NULL THEN
    RAISE NOTICE 'M-5: skip %.% (column missing)', p_table, p_column;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = v_rel AND contype = 'f' AND v_att = ANY (conkey)) THEN
    RETURN;  -- already constrained
  END IF;
  IF upper(p_on_delete) NOT IN ('RESTRICT', 'CASCADE', 'SET NULL') THEN
    RAISE EXCEPTION 'bad on_delete %', p_on_delete;
  END IF;
  v_name := left(p_table || '_' || p_column, 58) || '_fkey';
  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(%I) ON DELETE %s NOT VALID',
                 p_table, v_name, p_column, p_ref_table, p_ref_column, upper(p_on_delete));
  INSERT INTO security_private.added_constraints (migration, table_name, constraint_name)
  VALUES ('20261020000800_m5_missing_foreign_keys', p_table, v_name)
  ON CONFLICT DO NOTHING;
  BEGIN
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', p_table, v_name);
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'M-5: %.% has orphan rows; % left NOT VALID (clean up and VALIDATE later)',
      p_table, p_column, v_name;
  END;
END
$function$;
REVOKE ALL ON FUNCTION security_private.add_fk_if_missing(text, text, text, text, text) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- college ownership: configuration / seed / link rows
    ('academic_buildings','college_id','colleges','id','CASCADE'),
    ('academic_calendar','college_id','colleges','id','CASCADE'),
    ('college_constraint_settings','college_id','colleges','id','CASCADE'),
    ('college_quality_settings','college_id','colleges','id','CASCADE'),
    ('daily_breaks','college_id','colleges','id','CASCADE'),
    ('instructor_types','college_id','colleges','id','CASCADE'),
    ('scheduling_settings','college_id','colleges','id','CASCADE'),
    ('session_types','college_id','colleges','id','CASCADE'),
    ('time_slot_templates','college_id','colleges','id','CASCADE'),
    ('time_slots','college_id','colleges','id','CASCADE'),
    ('import_templates','college_id','colleges','id','CASCADE'),
    ('import_template_columns','college_id','colleges','id','CASCADE'),
    ('import_jobs','college_id','colleges','id','CASCADE'),
    ('import_errors','college_id','colleges','id','CASCADE'),
    ('room_types','college_id','colleges','id','CASCADE'),
    ('instructor_availability','college_id','colleges','id','CASCADE'),
    ('room_availability','college_id','colleges','id','CASCADE'),
    ('room_unavailability','college_id','colleges','id','CASCADE'),
    ('course_departments','college_id','colleges','id','CASCADE'),
    ('course_programs','college_id','colleges','id','CASCADE'),
    ('course_offering_sections','college_id','colleges','id','CASCADE'),
    ('section_group_members','college_id','colleges','id','CASCADE'),
    -- college ownership: operational / history rows
    ('auto_schedule_runs','college_id','colleges','id','RESTRICT'),
    ('conflict_checks','college_id','colleges','id','RESTRICT'),
    ('conflict_results','college_id','colleges','id','RESTRICT'),
    ('course_offerings','college_id','colleges','id','RESTRICT'),
    ('instructors','college_id','colleges','id','RESTRICT'),
    ('rooms','college_id','colleges','id','RESTRICT'),
    ('schedule_quality_runs','college_id','colleges','id','RESTRICT'),
    ('schedule_version_conflict_exceptions','college_id','colleges','id','RESTRICT'),
    ('schedule_version_events','college_id','colleges','id','RESTRICT'),
    ('section_groups','college_id','colleges','id','RESTRICT'),
    ('section_subgroups','college_id','colleges','id','RESTRICT'),
    -- schedule sessions
    ('schedule_sessions','instructor_id','instructors','id','RESTRICT'),
    ('schedule_sessions','teaching_assignment_id','teaching_assignments','id','RESTRICT'),
    ('schedule_sessions','section_id','sections','id','RESTRICT'),
    ('schedule_sessions','course_offering_id','course_offerings','id','RESTRICT'),
    ('schedule_sessions','section_group_id','section_groups','id','RESTRICT'),
    ('schedule_sessions','section_subgroup_id','section_subgroups','id','RESTRICT'),
    -- teaching assignments
    ('teaching_assignments','instructor_id','instructors','id','RESTRICT'),
    ('teaching_assignments','course_offering_id','course_offerings','id','RESTRICT'),
    ('teaching_assignments','section_id','sections','id','RESTRICT'),
    -- instructors / rooms
    ('instructors','department_id','departments','id','SET NULL'),
    ('instructors','instructor_type_id','instructor_types','id','RESTRICT'),
    ('rooms','room_type_id','room_types','id','RESTRICT'),
    ('rooms','building_id','academic_buildings','id','SET NULL'),
    ('instructor_availability','instructor_id','instructors','id','CASCADE'),
    -- course offerings
    ('course_offerings','course_id','courses','id','RESTRICT'),
    ('course_offerings','level_id','academic_levels','id','RESTRICT'),
    ('course_offerings','plan_course_id','plan_courses','id','RESTRICT'),
    ('course_offerings','program_id','academic_programs','id','RESTRICT'),
    ('course_offerings','study_plan_id','study_plans','id','RESTRICT'),
    ('course_offering_sections','course_offering_id','course_offerings','id','CASCADE'),
    ('course_offering_sections','section_id','sections','id','CASCADE'),
    -- course link tables
    ('course_departments','course_id','courses','id','CASCADE'),
    ('course_departments','department_id','departments','id','CASCADE'),
    ('course_programs','course_id','courses','id','CASCADE'),
    ('course_programs','program_id','academic_programs','id','CASCADE'),
    -- legacy section groups
    ('section_group_members','section_group_id','section_groups','id','CASCADE'),
    ('section_group_members','section_id','sections','id','CASCADE'),
    ('section_groups','academic_term_id','academic_terms','id','RESTRICT'),
    ('section_groups','course_id','courses','id','RESTRICT'),
    ('section_subgroups','academic_term_id','academic_terms','id','RESTRICT'),
    ('section_subgroups','course_id','courses','id','RESTRICT'),
    ('section_subgroups','section_id','sections','id','RESTRICT'),
    ('section_subgroups','teaching_assignment_id','teaching_assignments','id','RESTRICT'),
    -- misc
    ('import_errors','job_id','import_jobs','id','CASCADE'),
    ('import_template_columns','template_id','import_templates','id','CASCADE'),
    ('academic_calendar','term_id','academic_terms','id','CASCADE'),
    ('conflict_results','schedule_session_id','schedule_sessions','id','CASCADE'),
    ('conflict_results','related_session_id','schedule_sessions','id','CASCADE'),
    ('schedule_quality_runs','schedule_version_id','schedule_versions','id','CASCADE')
  ) AS t(tbl, col, ref, refcol, act)
  LOOP
    PERFORM security_private.add_fk_if_missing(r.tbl, r.col, r.ref, r.refcol, r.act);
  END LOOP;
END $$;

-- purge_all_academic_operational_data: the old guard tested current_user,
-- which inside a SECURITY DEFINER function is always the owner (postgres), so
-- it never rejected anyone holding EXECUTE. Check the real caller instead.
CREATE OR REPLACE FUNCTION public.purge_all_academic_operational_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tables text[] := ARRAY[
    'schedule_version_conflict_exceptions',
    'conflict_results',
    'conflict_checks',
    'schedule_quality_runs',
    'schedule_sessions',
    'auto_schedule_runs',
    'schedule_version_events',
    'schedule_versions',
    'section_subgroups',
    'section_group_members',
    'course_offering_sections',
    'scheduling_headcount_revisions',
    'scheduling_headcount_overrides',
    'scheduling_cohort_term_headcounts',
    'teaching_assignments',
    'delivery_groups',
    'cohort_elective_selections',
    'elective_slot_courses',
    'elective_slots',
    'section_groups',
    'sections',
    'course_offerings',
    'plan_course_components',
    'plan_courses',
    'course_departments',
    'course_programs',
    'instructor_availability',
    'instructors',
    'academic_cohorts',
    'courses',
    'study_plans'
  ];
  v_table text;
  v_deleted bigint;
  v_remaining bigint;
  v_counts jsonb := '{}'::jsonb;
  v_total bigint := 0;
BEGIN
  IF NOT (coalesce(auth.role(), '') = 'service_role'
          OR session_user IN ('postgres', 'supabase_admin')) THEN
    RAISE EXCEPTION 'PURGE_MAINTENANCE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;

  -- Single fixed advisory lock for the whole transaction (serializes concurrent runs).
  PERFORM pg_advisory_xact_lock(918273645);

  -- Transaction-local maintenance flag consumed by the three lock triggers.
  PERFORM set_config('gomufadhala.operational_cleanup', 'on', true);

  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('DELETE FROM public.%I', v_table);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object(v_table, v_deleted);
    v_total := v_total + v_deleted;
  END LOOP;

  -- Fail closed: every target table must be empty, else roll back the whole RPC.
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_remaining;
    IF v_remaining <> 0 THEN
      RAISE EXCEPTION 'PURGE_TABLE_NOT_EMPTY:%:%', v_table, v_remaining
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    NULL,
    'operational_data_purge',
    'platform',
    NULL,
    NULL,
    jsonb_build_object('total_deleted', v_total, 'counts', v_counts)
  );

  RETURN jsonb_build_object(
    'purged', true,
    'total_deleted', v_total,
    'tables', cardinality(v_tables),
    'counts', v_counts
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.purge_all_academic_operational_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_all_academic_operational_data() TO service_role;

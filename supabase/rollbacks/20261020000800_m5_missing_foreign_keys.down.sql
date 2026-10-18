-- Rollback for M-5: drop only the FKs this migration created and restore the
-- previous purge guard (current_user based).
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('security_private.added_constraints') IS NOT NULL THEN
    FOR r IN SELECT * FROM security_private.added_constraints
              WHERE migration = '20261020000800_m5_missing_foreign_keys' LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.table_name, r.constraint_name);
      DELETE FROM security_private.added_constraints
       WHERE table_name = r.table_name AND constraint_name = r.constraint_name;
    END LOOP;
  END IF;
END $$;
DROP FUNCTION IF EXISTS security_private.add_fk_if_missing(text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.purge_all_academic_operational_data()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tables text[] := ARRAY['schedule_version_conflict_exceptions','conflict_results','conflict_checks',
    'schedule_quality_runs','schedule_sessions','auto_schedule_runs','schedule_version_events','schedule_versions',
    'section_subgroups','section_group_members','course_offering_sections','scheduling_headcount_revisions',
    'scheduling_headcount_overrides','scheduling_cohort_term_headcounts','teaching_assignments','delivery_groups',
    'cohort_elective_selections','elective_slot_courses','elective_slots','section_groups','sections',
    'course_offerings','plan_course_components','plan_courses','course_departments','course_programs',
    'instructor_availability','instructors','academic_cohorts','courses','study_plans'];
  v_table text; v_deleted bigint; v_remaining bigint; v_counts jsonb := '{}'::jsonb; v_total bigint := 0;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'PURGE_MAINTENANCE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(918273645);
  PERFORM set_config('gomufadhala.operational_cleanup', 'on', true);
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('DELETE FROM public.%I', v_table);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object(v_table, v_deleted);
    v_total := v_total + v_deleted;
  END LOOP;
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_remaining;
    IF v_remaining <> 0 THEN
      RAISE EXCEPTION 'PURGE_TABLE_NOT_EMPTY:%:%', v_table, v_remaining USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (NULL, 'operational_data_purge', 'platform', NULL, NULL,
          jsonb_build_object('total_deleted', v_total, 'counts', v_counts));
  RETURN jsonb_build_object('purged', true, 'total_deleted', v_total, 'tables', cardinality(v_tables), 'counts', v_counts);
END;
$function$;

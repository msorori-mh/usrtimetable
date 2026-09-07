-- 1) Trigger functions: unchanged normal behaviour, plus a narrow maintenance bypass for DELETE only.

CREATE OR REPLACE FUNCTION public.enforce_schedule_session_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE st text; vid uuid;
BEGIN
  IF TG_OP = 'DELETE'
     AND coalesce(current_setting('gomufadhala.operational_cleanup', true), '') = 'on'
     AND current_user IN ('postgres', 'service_role') THEN
    RETURN OLD;
  END IF;

  vid := COALESCE(NEW.schedule_version_id, OLD.schedule_version_id);
  SELECT status INTO st FROM public.schedule_versions WHERE id = vid;
  IF st IN ('published','archived') THEN
    RAISE EXCEPTION 'schedule_sessions are locked: version status is %', st
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $function$;

CREATE OR REPLACE FUNCTION public.enforce_schedule_session_lock_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('gomufadhala.operational_cleanup', true), '') = 'on'
       AND current_user IN ('postgres', 'service_role') THEN
      RETURN OLD;
    END IF;
    IF OLD.is_locked THEN
      RAISE EXCEPTION 'session % is locked and cannot be deleted', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_locked = true AND NEW.is_locked = true THEN
    -- Only allow editing lock_reason or unlocking; block schedule-affecting changes
    IF (NEW.day_of_week IS DISTINCT FROM OLD.day_of_week
        OR NEW.start_time IS DISTINCT FROM OLD.start_time
        OR NEW.end_time IS DISTINCT FROM OLD.end_time
        OR NEW.room_id IS DISTINCT FROM OLD.room_id
        OR NEW.instructor_id IS DISTINCT FROM OLD.instructor_id) THEN
      RAISE EXCEPTION 'session % is locked; unlock before changing time/room/instructor', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.prevent_locked_schedule_version_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('gomufadhala.operational_cleanup', true), '') = 'on'
     AND current_user IN ('postgres', 'service_role') THEN
    RETURN OLD;
  END IF;

  IF OLD.status IN ('published', 'archived') THEN
    RAISE EXCEPTION 'IMMUTABLE_SCHEDULE_VERSION:%', OLD.status USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$function$;

-- 2) Maintenance RPC

CREATE OR REPLACE FUNCTION public.purge_all_academic_operational_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  IF current_user NOT IN ('postgres', 'service_role') THEN
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
-- PHASE-6: Self-verifying experimental schedule reset (SOURCE ONLY — do not auto-apply).
-- OWNER_CONFIRMED — CURRENT_SCHEDULE_DATA_IS_EXPERIMENTAL_AND_DISPOSABLE
-- Migration executor is the administrative source of truth (no external anon preflight).
-- Explicit transaction: any RAISE rolls back deletes + audits in this file.

BEGIN;

DO $$
DECLARE
  v_has_published_at boolean;
  v_has_approved_at boolean;
  v_official integer;
  v_versions integer;
  v_sessions integer;
  v_subgroups integer;
  v_checks integer;
  v_results integer;
  v_exceptions integer;
  v_events integer;
  v_runs integer;
  v_quality integer;
  v_locked integer;
  v_version_ids jsonb;
  v_version_names jsonb;
  v_version_statuses jsonb;
  v_rooms integer;
  v_courses integer;
  v_sections integer;
  v_offerings integer;
  v_assignments integer;
  v_instructors integer;
  v_terms integer;
  v_colleges integer;
  v_departments integer;
  v_programs integer;
  v_enroll_fp text;
  v_has_expected boolean;
  v_has_enroll_status boolean;
  v_has_enroll_updated boolean;
  v_after_versions integer;
  v_after_sessions integer;
  v_after_subgroups integer;
  v_after_checks integer;
  v_after_results integer;
  v_after_exceptions integer;
  v_after_events integer;
  v_after_runs integer;
  v_after_quality integer;
  v_after_rooms integer;
  v_after_courses integer;
  v_after_sections integer;
  v_after_offerings integer;
  v_after_assignments integer;
  v_after_instructors integer;
  v_after_terms integer;
  v_after_colleges integer;
  v_after_departments integer;
  v_after_programs integer;
  v_after_enroll_fp text;
  v_executed_at timestamptz := clock_timestamp();
  v_publish_tbl text;
  v_publish_sql text;
  v_publish_hits integer;
BEGIN
  -- Optional timestamp columns (catalog-safe)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'schedule_versions' AND column_name = 'published_at'
  ) INTO v_has_published_at;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'schedule_versions' AND column_name = 'approved_at'
  ) INTO v_has_approved_at;

  -- Official / published gate
  SELECT COUNT(*)::integer INTO v_official
  FROM public.schedule_versions
  WHERE status IN ('published', 'approved');

  IF v_official > 0 THEN
    RAISE EXCEPTION 'OFFICIAL_SCHEDULE_VERSION_FOUND'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_has_published_at THEN
    EXECUTE $q$SELECT COUNT(*)::integer FROM public.schedule_versions WHERE published_at IS NOT NULL$q$
      INTO v_official;
    IF v_official > 0 THEN
      RAISE EXCEPTION 'OFFICIAL_SCHEDULE_VERSION_FOUND'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF v_has_approved_at THEN
    EXECUTE $q$SELECT COUNT(*)::integer FROM public.schedule_versions WHERE approved_at IS NOT NULL$q$
      INTO v_official;
    IF v_official > 0 THEN
      RAISE EXCEPTION 'OFFICIAL_SCHEDULE_VERSION_FOUND'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Prior publish lifecycle events (actual publish relationship)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'schedule_version_events'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'schedule_version_events' AND column_name = 'event_type'
  ) THEN
    SELECT COUNT(*)::integer INTO v_official
    FROM public.schedule_version_events
    WHERE event_type = 'published';
    IF v_official > 0 THEN
      RAISE EXCEPTION 'OFFICIAL_SCHEDULE_VERSION_FOUND'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Any public *publish* table with schedule_version_id rows
  FOR v_publish_tbl IN
    SELECT t.table_name
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON c.table_schema = t.table_schema
     AND c.table_name = t.table_name
     AND c.column_name = 'schedule_version_id'
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND t.table_name ILIKE '%publish%'
  LOOP
    v_publish_sql := format(
      'SELECT COUNT(*)::integer FROM public.%I WHERE schedule_version_id IS NOT NULL',
      v_publish_tbl
    );
    EXECUTE v_publish_sql INTO v_publish_hits;
    IF v_publish_hits > 0 THEN
      RAISE EXCEPTION 'OFFICIAL_SCHEDULE_VERSION_FOUND'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- Operational before-counts
  SELECT COUNT(*)::integer INTO v_versions FROM public.schedule_versions;
  SELECT COUNT(*)::integer INTO v_sessions FROM public.schedule_sessions;
  SELECT COUNT(*)::integer INTO v_subgroups FROM public.section_subgroups;
  SELECT COUNT(*)::integer INTO v_checks FROM public.conflict_checks;
  SELECT COUNT(*)::integer INTO v_results FROM public.conflict_results;
  SELECT COUNT(*)::integer INTO v_exceptions FROM public.schedule_version_conflict_exceptions;
  SELECT COUNT(*)::integer INTO v_events FROM public.schedule_version_events;
  SELECT COUNT(*)::integer INTO v_runs FROM public.auto_schedule_runs;
  SELECT COUNT(*)::integer INTO v_quality FROM public.schedule_quality_runs;
  SELECT COUNT(*)::integer INTO v_locked FROM public.schedule_sessions WHERE is_locked = true;

  SELECT COALESCE(jsonb_agg(id ORDER BY created_at, id), '[]'::jsonb),
         COALESCE(jsonb_agg(name ORDER BY created_at, id), '[]'::jsonb),
         COALESCE(jsonb_agg(status ORDER BY created_at, id), '[]'::jsonb)
    INTO v_version_ids, v_version_names, v_version_statuses
  FROM public.schedule_versions;

  -- Protected master before-counts
  SELECT COUNT(*)::integer INTO v_rooms FROM public.rooms;
  SELECT COUNT(*)::integer INTO v_courses FROM public.courses;
  SELECT COUNT(*)::integer INTO v_sections FROM public.sections;
  SELECT COUNT(*)::integer INTO v_offerings FROM public.course_offerings;
  SELECT COUNT(*)::integer INTO v_assignments FROM public.teaching_assignments;
  SELECT COUNT(*)::integer INTO v_instructors FROM public.instructors;
  SELECT COUNT(*)::integer INTO v_terms FROM public.academic_terms;
  SELECT COUNT(*)::integer INTO v_colleges FROM public.colleges;
  SELECT COUNT(*)::integer INTO v_departments FROM public.departments;
  SELECT COUNT(*)::integer INTO v_programs FROM public.academic_programs;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'course_offerings' AND column_name = 'expected_students'
  ) INTO v_has_expected;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'course_offerings' AND column_name = 'enrollment_count_status'
  ) INTO v_has_enroll_status;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'course_offerings' AND column_name = 'enrollment_count_updated_at'
  ) INTO v_has_enroll_updated;

  IF v_has_expected AND v_has_enroll_status AND v_has_enroll_updated THEN
    SELECT COALESCE(md5(string_agg(
      id::text || '|' || coalesce(expected_students::text, '') || '|' ||
      coalesce(enrollment_count_status, '') || '|' ||
      coalesce(enrollment_count_updated_at::text, ''),
      E'\n' ORDER BY id
    )), 'empty')
    INTO v_enroll_fp
    FROM public.course_offerings;
  ELSE
    v_enroll_fp := 'enrollment_columns_partial_or_missing';
  END IF;

  RAISE NOTICE 'experimental_reset_preflight versions=% sessions=% subgroups=% rooms=% offerings=%',
    v_versions, v_sessions, v_subgroups, v_rooms, v_offerings;

  -- Before audit (actor_id NULL — migration has no end-user session)
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    NULL,
    'EXPERIMENTAL_SCHEDULE_RESET',
    'schedule_versions',
    NULL,
    NULL,
    jsonb_build_object(
      'operation', 'EXPERIMENTAL_SCHEDULE_RESET',
      'phase', 'before',
      'owner_confirmed_experimental', true,
      'actor', 'migration_executor',
      'version_ids', v_version_ids,
      'version_names', v_version_names,
      'version_statuses', v_version_statuses,
      'schedule_versions_count', v_versions,
      'schedule_sessions_count', v_sessions,
      'section_subgroups_count', v_subgroups,
      'dependent_row_counts', jsonb_build_object(
        'conflict_checks', v_checks,
        'conflict_results', v_results,
        'schedule_version_conflict_exceptions', v_exceptions,
        'schedule_version_events', v_events,
        'auto_schedule_runs', v_runs,
        'schedule_quality_runs', v_quality,
        'locked_sessions', v_locked
      ),
      'protected_master_counts', jsonb_build_object(
        'rooms', v_rooms,
        'courses', v_courses,
        'sections', v_sections,
        'course_offerings', v_offerings,
        'teaching_assignments', v_assignments,
        'instructors', v_instructors,
        'academic_terms', v_terms,
        'colleges', v_colleges,
        'departments', v_departments,
        'academic_programs', v_programs,
        'enrollment_fingerprint', v_enroll_fp
      ),
      'executed_at', v_executed_at
    )
  );

  -- Bypass session lock guards for disposable experimental wipe only
  ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_ss_lock_iud;
  ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_ss_lock_row;

  BEGIN
    DELETE FROM public.schedule_quality_runs;
    DELETE FROM public.conflict_results;
    DELETE FROM public.conflict_checks;
    DELETE FROM public.schedule_version_conflict_exceptions;
    DELETE FROM public.schedule_version_events;
    DELETE FROM public.auto_schedule_runs;
    DELETE FROM public.schedule_sessions;
    DELETE FROM public.schedule_versions;
    DELETE FROM public.section_subgroups;
  EXCEPTION
    WHEN OTHERS THEN
      ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_lock_iud;
      ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_lock_row;
      RAISE;
  END;

  ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_lock_iud;
  ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_lock_row;

  -- Postcheck operational zeros
  SELECT COUNT(*)::integer INTO v_after_versions FROM public.schedule_versions;
  SELECT COUNT(*)::integer INTO v_after_sessions FROM public.schedule_sessions;
  SELECT COUNT(*)::integer INTO v_after_subgroups FROM public.section_subgroups;
  SELECT COUNT(*)::integer INTO v_after_checks FROM public.conflict_checks;
  SELECT COUNT(*)::integer INTO v_after_results FROM public.conflict_results;
  SELECT COUNT(*)::integer INTO v_after_exceptions FROM public.schedule_version_conflict_exceptions;
  SELECT COUNT(*)::integer INTO v_after_events FROM public.schedule_version_events;
  SELECT COUNT(*)::integer INTO v_after_runs FROM public.auto_schedule_runs;
  SELECT COUNT(*)::integer INTO v_after_quality FROM public.schedule_quality_runs;

  IF v_after_versions <> 0 OR v_after_sessions <> 0 OR v_after_subgroups <> 0
     OR v_after_checks <> 0 OR v_after_results <> 0 OR v_after_exceptions <> 0
     OR v_after_events <> 0 OR v_after_runs <> 0 OR v_after_quality <> 0 THEN
    RAISE EXCEPTION 'EXPERIMENTAL_RESET_INCOMPLETE'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Protected masters unchanged
  SELECT COUNT(*)::integer INTO v_after_rooms FROM public.rooms;
  SELECT COUNT(*)::integer INTO v_after_courses FROM public.courses;
  SELECT COUNT(*)::integer INTO v_after_sections FROM public.sections;
  SELECT COUNT(*)::integer INTO v_after_offerings FROM public.course_offerings;
  SELECT COUNT(*)::integer INTO v_after_assignments FROM public.teaching_assignments;
  SELECT COUNT(*)::integer INTO v_after_instructors FROM public.instructors;
  SELECT COUNT(*)::integer INTO v_after_terms FROM public.academic_terms;
  SELECT COUNT(*)::integer INTO v_after_colleges FROM public.colleges;
  SELECT COUNT(*)::integer INTO v_after_departments FROM public.departments;
  SELECT COUNT(*)::integer INTO v_after_programs FROM public.academic_programs;

  IF v_after_rooms <> v_rooms
     OR v_after_courses <> v_courses
     OR v_after_sections <> v_sections
     OR v_after_offerings <> v_offerings
     OR v_after_assignments <> v_assignments
     OR v_after_instructors <> v_instructors
     OR v_after_terms <> v_terms
     OR v_after_colleges <> v_colleges
     OR v_after_departments <> v_departments
     OR v_after_programs <> v_programs THEN
    RAISE EXCEPTION 'PROTECTED_MASTER_DATA_CHANGED'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_has_expected AND v_has_enroll_status AND v_has_enroll_updated THEN
    SELECT COALESCE(md5(string_agg(
      id::text || '|' || coalesce(expected_students::text, '') || '|' ||
      coalesce(enrollment_count_status, '') || '|' ||
      coalesce(enrollment_count_updated_at::text, ''),
      E'\n' ORDER BY id
    )), 'empty')
    INTO v_after_enroll_fp
    FROM public.course_offerings;
    IF v_after_enroll_fp IS DISTINCT FROM v_enroll_fp THEN
      RAISE EXCEPTION 'PROTECTED_MASTER_DATA_CHANGED'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    v_after_enroll_fp := v_enroll_fp;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    NULL,
    'EXPERIMENTAL_SCHEDULE_RESET',
    'schedule_versions',
    NULL,
    NULL,
    jsonb_build_object(
      'operation', 'EXPERIMENTAL_SCHEDULE_RESET',
      'phase', 'after',
      'owner_confirmed_experimental', true,
      'actor', 'migration_executor',
      'deleted_counts', jsonb_build_object(
        'schedule_versions', v_versions,
        'schedule_sessions', v_sessions,
        'section_subgroups', v_subgroups,
        'conflict_checks', v_checks,
        'conflict_results', v_results,
        'schedule_version_conflict_exceptions', v_exceptions,
        'schedule_version_events', v_events,
        'auto_schedule_runs', v_runs,
        'schedule_quality_runs', v_quality
      ),
      'protected_master_counts_after', jsonb_build_object(
        'rooms', v_after_rooms,
        'courses', v_after_courses,
        'sections', v_after_sections,
        'course_offerings', v_after_offerings,
        'teaching_assignments', v_after_assignments,
        'instructors', v_after_instructors,
        'academic_terms', v_after_terms,
        'colleges', v_after_colleges,
        'departments', v_after_departments,
        'academic_programs', v_after_programs,
        'enrollment_fingerprint', v_after_enroll_fp
      ),
      'result', 'success',
      'idempotent_empty_input', (v_versions = 0 AND v_sessions = 0 AND v_subgroups = 0),
      'executed_at', clock_timestamp()
    )
  );

  RAISE NOTICE 'experimental_reset_complete versions_deleted=% sessions_deleted=%', v_versions, v_sessions;
END $$;

COMMIT;
-- PHASE-6: Reset experimental schedule operational data (SOURCE ONLY — do not auto-apply).
-- OWNER_CONFIRMED — CURRENT_SCHEDULE_DATA_IS_EXPERIMENTAL_AND_DISPOSABLE
-- Preserves academic masters (colleges, courses, offerings, sections, rooms, instructors, users).
-- Does NOT modify expected_students / enrollment_count_status.
-- Does NOT create a new schedule version (UAT rebuild is a later phase).
-- Entire DO block runs in a single transaction; any exception rolls back all deletes.

DO $$
DECLARE
  v_published integer;
  v_approved integer;
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
BEGIN
  -- G1 preflight: refuse official/published (and approved) versions
  SELECT COUNT(*)::integer INTO v_published
  FROM public.schedule_versions
  WHERE status = 'published';

  IF v_published > 0 THEN
    RAISE EXCEPTION
      'NO_GO — OFFICIAL_SCHEDULE_VERSION_FOUND: % published schedule_versions present; experimental reset aborted',
      v_published
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_approved
  FROM public.schedule_versions
  WHERE status = 'approved';

  IF v_approved > 0 THEN
    RAISE EXCEPTION
      'NO_GO — OFFICIAL_SCHEDULE_VERSION_FOUND: % approved schedule_versions present; experimental reset aborted',
      v_approved
      USING ERRCODE = 'check_violation';
  END IF;

  -- Pre-delete counts (for audit)
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

  RAISE NOTICE 'experimental_reset_preflight versions=% sessions=% subgroups=% checks=% results=% exceptions=% events=% runs=% quality=% locked=%',
    v_versions, v_sessions, v_subgroups, v_checks, v_results, v_exceptions, v_events, v_runs, v_quality, v_locked;

  -- Bypass publish/archive and row-lock guards for disposable experimental wipe only.
  ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_ss_lock_iud;
  ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_ss_lock_row;

  BEGIN
    -- Soft-linked quality runs (no FK cascade)
    DELETE FROM public.schedule_quality_runs;

    -- Conflict tree
    DELETE FROM public.conflict_results;
    DELETE FROM public.conflict_checks;

    -- Exceptions / events / generation runs (also cascade from versions, deleted explicitly for clarity)
    DELETE FROM public.schedule_version_conflict_exceptions;
    DELETE FROM public.schedule_version_events;
    DELETE FROM public.auto_schedule_runs;

    -- Sessions then versions (versions CASCADE would also remove sessions)
    DELETE FROM public.schedule_sessions;
    DELETE FROM public.schedule_versions;

    -- Capacity-split experimental subgroups (not version-scoped)
    DELETE FROM public.section_subgroups;
  EXCEPTION
    WHEN OTHERS THEN
      ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_lock_iud;
      ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_lock_row;
      RAISE;
  END;

  ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_lock_iud;
  ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_lock_row;

  -- Post-delete sanity
  IF EXISTS (SELECT 1 FROM public.schedule_versions)
     OR EXISTS (SELECT 1 FROM public.schedule_sessions)
     OR EXISTS (SELECT 1 FROM public.section_subgroups) THEN
    RAISE EXCEPTION 'experimental reset incomplete: residual schedule operational rows remain'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    NULL,
    'EXPERIMENTAL_SCHEDULE_RESET',
    'schedule_versions',
    NULL,
    NULL,
    jsonb_build_object(
      'policy', 'OWNER_CONFIRMED_EXPERIMENTAL_DISPOSABLE',
      'deleted_before', jsonb_build_object(
        'schedule_versions', v_versions,
        'schedule_sessions', v_sessions,
        'section_subgroups', v_subgroups,
        'conflict_checks', v_checks,
        'conflict_results', v_results,
        'schedule_version_conflict_exceptions', v_exceptions,
        'schedule_version_events', v_events,
        'auto_schedule_runs', v_runs,
        'schedule_quality_runs', v_quality,
        'locked_sessions', v_locked
      ),
      'preserved', jsonb_build_array(
        'colleges', 'departments', 'academic_programs', 'study_plans', 'courses',
        'academic_terms', 'sections', 'course_offerings', 'teaching_assignments',
        'instructors', 'rooms', 'room_availability', 'room_unavailability',
        'users', 'roles', 'enrollment_count_status', 'expected_students'
      ),
      'note', 'Experimental Reset — no official published schedule; UAT version not created in this phase'
    )
  );

  RAISE NOTICE 'experimental_reset_complete';
END $$;

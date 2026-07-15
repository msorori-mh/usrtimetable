-- PHASE-7: Self-verifying course_offerings.term_id remediation (SOURCE ONLY — do not auto-apply).
-- Remap 84 offerings (orphan term ca5146f1…) → current first term 18dd364a…
-- Delete 129 offerings (orphan term 3e59d219…) and their exclusive dependents.
-- Then VALIDATE CONSTRAINT course_offerings_term_id_fkey (RESTRICT, not CASCADE).
-- Does NOT modify academic_terms / rooms / courses / instructors.
-- Explicit transaction: any RAISE rolls back all writes in this file.

BEGIN;

DO $$
DECLARE
  c_operation       constant text := 'COURSE_OFFERING_TERM_REMEDIATION';
  c_remap_from      constant uuid := 'ca5146f1-2f61-46e7-be4b-2a29099d2d23';
  c_delete_term     constant uuid := '3e59d219-bfde-435f-a65e-cc55876c64ab';
  c_target_term     constant uuid := '18dd364a-76d7-40b8-a217-fa929c082a7f';
  c_null_uuid       constant uuid := '00000000-0000-0000-0000-000000000000';

  c_expect_total              constant integer := 213;
  c_expect_remap              constant integer := 84;
  c_expect_delete             constant integer := 129;
  c_expect_delete_ta          constant integer := 163;
  c_expect_delete_cos         constant integer := 129;
  c_expect_keep_ta            constant integer := 174;
  c_expect_keep_cos           constant integer := 5;
  c_expect_remaining_total    constant integer := 84;
  c_expect_unique_conflicts   constant integer := 0;
  c_expect_delete_sessions    constant integer := 0;
  c_expect_orphans_before     constant integer := 213;
  c_expect_orphans_after      constant integer := 0;

  v_executed_at timestamptz := clock_timestamp();

  v_total integer;
  v_remap_count integer;
  v_delete_count integer;
  v_target_exists boolean;
  v_unique_conflicts integer;
  v_delete_sessions integer;
  v_orphan_before integer;
  v_delete_ta integer;
  v_delete_cos integer;
  v_keep_ta integer;
  v_keep_cos integer;

  v_rooms_before integer;
  v_courses_before integer;
  v_instructors_before integer;
  v_terms_before integer;
  v_sessions_before integer;
  v_sections_before integer;

  v_update_ids uuid[];
  v_delete_ids uuid[];
  v_candidate_section_ids uuid[];
  v_shared_section_ids uuid[];

  v_updated integer;
  v_deleted_ta integer;
  v_deleted_cos integer;
  v_deleted_orphan_sections integer;
  v_deleted_offerings integer;

  v_remaining_total integer;
  v_remaining_on_target integer;
  v_orphan_after integer;
  v_dangling_ta integer;
  v_dangling_cos integer;
  v_keep_ta_after integer;
  v_keep_cos_after integer;
  v_rooms_after integer;
  v_courses_after integer;
  v_instructors_after integer;
  v_terms_after integer;
  v_sessions_after integer;

  v_fk_exists boolean;
  v_convalidated boolean;
  v_confdeltype char;

  v_success_state boolean;
BEGIN
  SELECT COUNT(*)::integer INTO v_remaining_total FROM public.course_offerings;
  SELECT COUNT(*)::integer INTO v_remaining_on_target
  FROM public.course_offerings WHERE term_id = c_target_term;
  SELECT COUNT(*)::integer INTO v_orphan_after
  FROM public.course_offerings co
  WHERE NOT EXISTS (SELECT 1 FROM public.academic_terms t WHERE t.id = co.term_id);

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'course_offerings_term_id_fkey'
      AND conrelid = 'public.course_offerings'::regclass
  ) INTO v_fk_exists;

  IF v_fk_exists THEN
    SELECT c.convalidated, c.confdeltype
      INTO v_convalidated, v_confdeltype
    FROM pg_constraint c
    WHERE c.conname = 'course_offerings_term_id_fkey'
      AND c.conrelid = 'public.course_offerings'::regclass;
  END IF;

  v_success_state :=
    v_remaining_total = c_expect_remaining_total
    AND v_remaining_on_target = c_expect_remaining_total
    AND v_orphan_after = c_expect_orphans_after
    AND NOT EXISTS (
      SELECT 1 FROM public.course_offerings
      WHERE term_id IN (c_remap_from, c_delete_term)
    )
    AND v_fk_exists
    AND COALESCE(v_convalidated, false) = true
    AND v_confdeltype = 'r';

  IF v_success_state THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (
      NULL, c_operation, 'course_offerings', NULL, NULL,
      jsonb_build_object(
        'operation', c_operation, 'phase', 'idempotent',
        'result', 'idempotent_noop', 'actor', 'migration_executor',
        'remaining_offerings', v_remaining_total,
        'remaining_term_orphans', v_orphan_after,
        'fk_validated', true, 'on_delete_behavior', 'RESTRICT',
        'executed_at', v_executed_at
      )
    );
    RAISE NOTICE 'COURSE_OFFERING_TERM_REMEDIATION already applied — idempotent noop';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.course_offerings WHERE term_id = c_target_term
  ) AND (
    SELECT COUNT(*)::integer FROM public.course_offerings WHERE term_id = c_remap_from
  ) NOT IN (0, c_expect_remap) THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PARTIAL_STATE' USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(v_convalidated, false) = true AND NOT v_success_state THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_FK_ALREADY_VALID_WITH_BAD_DATA' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_total FROM public.course_offerings;
  IF v_total IS DISTINCT FROM c_expect_total THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PREFLIGHT_TOTAL_MISMATCH: expected %, got %', c_expect_total, v_total USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_remap_count FROM public.course_offerings WHERE term_id = c_remap_from;
  IF v_remap_count IS DISTINCT FROM c_expect_remap THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PREFLIGHT_REMAP_COUNT_MISMATCH: expected %, got %', c_expect_remap, v_remap_count USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_delete_count FROM public.course_offerings WHERE term_id = c_delete_term;
  IF v_delete_count IS DISTINCT FROM c_expect_delete THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PREFLIGHT_DELETE_COUNT_MISMATCH: expected %, got %', c_expect_delete, v_delete_count USING ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.academic_terms WHERE id = c_target_term) INTO v_target_exists;
  IF NOT v_target_exists THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PREFLIGHT_TARGET_TERM_MISSING: %', c_target_term USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_unique_conflicts
  FROM public.course_offerings src
  WHERE src.term_id = c_remap_from
    AND EXISTS (
      SELECT 1 FROM public.course_offerings dst
      WHERE dst.term_id = c_target_term
        AND dst.college_id = src.college_id
        AND dst.course_id = src.course_id
        AND COALESCE(dst.program_id, c_null_uuid) = COALESCE(src.program_id, c_null_uuid)
        AND COALESCE(dst.level_id, c_null_uuid) = COALESCE(src.level_id, c_null_uuid)
        AND dst.study_system = src.study_system
    );
  IF v_unique_conflicts IS DISTINCT FROM c_expect_unique_conflicts THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PREFLIGHT_UNIQUE_CONFLICT: expected %, got %', c_expect_unique_conflicts, v_unique_conflicts USING ERRCODE = 'unique_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_delete_sessions
  FROM public.schedule_sessions ss
  WHERE ss.course_offering_id IN (SELECT id FROM public.course_offerings WHERE term_id = c_delete_term)
     OR ss.section_id IN (
        SELECT cos.section_id FROM public.course_offering_sections cos
        JOIN public.course_offerings co ON co.id = cos.course_offering_id
        WHERE co.term_id = c_delete_term)
     OR ss.teaching_assignment_id IN (
        SELECT ta.id FROM public.teaching_assignments ta
        JOIN public.course_offerings co ON co.id = ta.course_offering_id
        WHERE co.term_id = c_delete_term);
  IF v_delete_sessions IS DISTINCT FROM c_expect_delete_sessions THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PREFLIGHT_DELETE_SESSIONS_NONEMPTY: expected %, got %', c_expect_delete_sessions, v_delete_sessions USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_orphan_before
  FROM public.course_offerings co
  WHERE NOT EXISTS (SELECT 1 FROM public.academic_terms t WHERE t.id = co.term_id);
  IF v_orphan_before IS DISTINCT FROM c_expect_orphans_before THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PREFLIGHT_ORPHAN_MISMATCH: expected %, got %', c_expect_orphans_before, v_orphan_before USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_delete_ta
  FROM public.teaching_assignments ta
  WHERE ta.course_offering_id IN (SELECT id FROM public.course_offerings WHERE term_id = c_delete_term);
  IF v_delete_ta IS DISTINCT FROM c_expect_delete_ta THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PREFLIGHT_DELETE_TA_MISMATCH: expected %, got %', c_expect_delete_ta, v_delete_ta USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_delete_cos
  FROM public.course_offering_sections cos
  WHERE cos.course_offering_id IN (SELECT id FROM public.course_offerings WHERE term_id = c_delete_term);
  IF v_delete_cos IS DISTINCT FROM c_expect_delete_cos THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PREFLIGHT_DELETE_COS_MISMATCH: expected %, got %', c_expect_delete_cos, v_delete_cos USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_keep_ta
  FROM public.teaching_assignments ta
  WHERE ta.course_offering_id IN (SELECT id FROM public.course_offerings WHERE term_id = c_remap_from);
  IF v_keep_ta IS DISTINCT FROM c_expect_keep_ta THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PREFLIGHT_KEEP_TA_MISMATCH: expected %, got %', c_expect_keep_ta, v_keep_ta USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_keep_cos
  FROM public.course_offering_sections cos
  WHERE cos.course_offering_id IN (SELECT id FROM public.course_offerings WHERE term_id = c_remap_from);
  IF v_keep_cos IS DISTINCT FROM c_expect_keep_cos THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PREFLIGHT_KEEP_COS_MISMATCH: expected %, got %', c_expect_keep_cos, v_keep_cos USING ERRCODE = 'check_violation';
  END IF;

  IF NOT v_fk_exists THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PREFLIGHT_FK_MISSING' USING ERRCODE = 'check_violation';
  END IF;
  IF v_confdeltype = 'c' THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PREFLIGHT_FK_CASCADE_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;
  IF v_confdeltype IS DISTINCT FROM 'r' AND v_confdeltype IS DISTINCT FROM 'a' THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_PREFLIGHT_FK_DELETE_ACTION_INVALID' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_update_ids
  FROM public.course_offerings WHERE term_id = c_remap_from;

  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_delete_ids
  FROM public.course_offerings WHERE term_id = c_delete_term;

  SELECT COALESCE((SELECT array_agg(d.section_id ORDER BY d.section_id) FROM (
      SELECT DISTINCT cos.section_id FROM public.course_offering_sections cos
      WHERE cos.course_offering_id = ANY (v_delete_ids)) d), ARRAY[]::uuid[])
    INTO v_candidate_section_ids;

  SELECT COALESCE((SELECT array_agg(d.section_id ORDER BY d.section_id) FROM (
      SELECT DISTINCT cos.section_id FROM public.course_offering_sections cos
      WHERE cos.section_id = ANY (v_candidate_section_ids)
        AND cos.course_offering_id = ANY (v_update_ids)) d), ARRAY[]::uuid[])
    INTO v_shared_section_ids;

  SELECT COUNT(*)::integer INTO v_rooms_before FROM public.rooms;
  SELECT COUNT(*)::integer INTO v_courses_before FROM public.courses;
  SELECT COUNT(*)::integer INTO v_instructors_before FROM public.instructors;
  SELECT COUNT(*)::integer INTO v_terms_before FROM public.academic_terms;
  SELECT COUNT(*)::integer INTO v_sessions_before FROM public.schedule_sessions;
  SELECT COUNT(*)::integer INTO v_sections_before FROM public.sections;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (NULL, c_operation, 'course_offerings', NULL, NULL,
    jsonb_build_object(
      'operation', c_operation, 'phase', 'before', 'actor', 'migration_executor',
      'remap_from_term_id', c_remap_from, 'delete_term_id', c_delete_term, 'target_term_id', c_target_term,
      'counts', jsonb_build_object(
        'course_offerings_total', v_total, 'remap_offerings', v_remap_count,
        'delete_offerings', v_delete_count, 'orphan_term_references', v_orphan_before,
        'co_unique_conflicts', v_unique_conflicts, 'delete_schedule_sessions', v_delete_sessions,
        'delete_teaching_assignments', v_delete_ta, 'delete_course_offering_sections', v_delete_cos,
        'keep_teaching_assignments', v_keep_ta, 'keep_course_offering_sections', v_keep_cos),
      'update_offering_ids', to_jsonb(v_update_ids),
      'delete_offering_ids', to_jsonb(v_delete_ids),
      'candidate_section_ids', to_jsonb(v_candidate_section_ids),
      'shared_section_ids_protected', to_jsonb(v_shared_section_ids),
      'dependency_counts', jsonb_build_object(
        'teaching_assignments_delete_set', v_delete_ta,
        'course_offering_sections_delete_set', v_delete_cos,
        'schedule_sessions_delete_set', v_delete_sessions),
      'protected_master_counts', jsonb_build_object(
        'rooms', v_rooms_before, 'courses', v_courses_before,
        'instructors', v_instructors_before, 'academic_terms', v_terms_before,
        'schedule_sessions', v_sessions_before, 'sections', v_sections_before),
      'executed_at', v_executed_at));

  UPDATE public.course_offerings
  SET term_id = c_target_term, updated_at = clock_timestamp()
  WHERE id = ANY (v_update_ids) AND term_id = c_remap_from;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated IS DISTINCT FROM c_expect_remap THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_UPDATE_COUNT_MISMATCH: expected %, got %', c_expect_remap, v_updated USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.teaching_assignments WHERE course_offering_id = ANY (v_delete_ids);
  GET DIAGNOSTICS v_deleted_ta = ROW_COUNT;
  IF v_deleted_ta IS DISTINCT FROM c_expect_delete_ta THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_DELETE_TA_COUNT_MISMATCH: expected %, got %', c_expect_delete_ta, v_deleted_ta USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.course_offering_sections WHERE course_offering_id = ANY (v_delete_ids);
  GET DIAGNOSTICS v_deleted_cos = ROW_COUNT;
  IF v_deleted_cos IS DISTINCT FROM c_expect_delete_cos THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_DELETE_COS_COUNT_MISMATCH: expected %, got %', c_expect_delete_cos, v_deleted_cos USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.sections s
  WHERE s.id = ANY (v_candidate_section_ids)
    AND NOT (s.id = ANY (v_shared_section_ids))
    AND NOT EXISTS (SELECT 1 FROM public.course_offering_sections cos WHERE cos.section_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM public.teaching_assignments ta WHERE ta.section_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM public.schedule_sessions ss WHERE ss.section_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM public.section_subgroups sg WHERE sg.section_id = s.id)
    AND NOT EXISTS (SELECT 1 FROM public.section_group_members sgm WHERE sgm.section_id = s.id);
  GET DIAGNOSTICS v_deleted_orphan_sections = ROW_COUNT;

  DELETE FROM public.course_offerings WHERE id = ANY (v_delete_ids) AND term_id = c_delete_term;
  GET DIAGNOSTICS v_deleted_offerings = ROW_COUNT;
  IF v_deleted_offerings IS DISTINCT FROM c_expect_delete THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_DELETE_OFFERING_COUNT_MISMATCH: expected %, got %', c_expect_delete, v_deleted_offerings USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_keep_ta_after
  FROM public.teaching_assignments WHERE course_offering_id = ANY (v_update_ids);
  SELECT COUNT(*)::integer INTO v_keep_cos_after
  FROM public.course_offering_sections WHERE course_offering_id = ANY (v_update_ids);
  IF v_keep_ta_after IS DISTINCT FROM c_expect_keep_ta OR v_keep_cos_after IS DISTINCT FROM c_expect_keep_cos THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_KEEP_SET_DEPENDENCIES_CHANGED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_remaining_total FROM public.course_offerings;
  IF v_remaining_total IS DISTINCT FROM c_expect_remaining_total THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_POSTCHECK_TOTAL_MISMATCH: expected %, got %', c_expect_remaining_total, v_remaining_total USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_remaining_on_target
  FROM public.course_offerings WHERE term_id = c_target_term;
  IF v_remaining_on_target IS DISTINCT FROM c_expect_remaining_total THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_POSTCHECK_TARGET_TERM_MISMATCH: expected %, got %', c_expect_remaining_total, v_remaining_on_target USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_orphan_after
  FROM public.course_offerings co
  WHERE NOT EXISTS (SELECT 1 FROM public.academic_terms t WHERE t.id = co.term_id);
  IF v_orphan_after IS DISTINCT FROM c_expect_orphans_after THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_POSTCHECK_ORPHANS_REMAIN: expected %, got %', c_expect_orphans_after, v_orphan_after USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_dangling_ta
  FROM public.teaching_assignments ta WHERE ta.course_offering_id = ANY (v_delete_ids);
  SELECT COUNT(*)::integer INTO v_dangling_cos
  FROM public.course_offering_sections cos WHERE cos.course_offering_id = ANY (v_delete_ids);
  IF v_dangling_ta <> 0 OR v_dangling_cos <> 0 THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_POSTCHECK_DANGLING_DELETE_DEPS' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_rooms_after FROM public.rooms;
  SELECT COUNT(*)::integer INTO v_courses_after FROM public.courses;
  SELECT COUNT(*)::integer INTO v_instructors_after FROM public.instructors;
  SELECT COUNT(*)::integer INTO v_terms_after FROM public.academic_terms;
  SELECT COUNT(*)::integer INTO v_sessions_after FROM public.schedule_sessions;

  IF v_rooms_after IS DISTINCT FROM v_rooms_before
     OR v_courses_after IS DISTINCT FROM v_courses_before
     OR v_instructors_after IS DISTINCT FROM v_instructors_before
     OR v_terms_after IS DISTINCT FROM v_terms_before
     OR v_sessions_after IS DISTINCT FROM v_sessions_before THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_POSTCHECK_PROTECTED_DATA_CHANGED' USING ERRCODE = 'check_violation';
  END IF;

  EXECUTE 'ALTER TABLE public.course_offerings VALIDATE CONSTRAINT course_offerings_term_id_fkey';

  SELECT c.convalidated, c.confdeltype INTO v_convalidated, v_confdeltype
  FROM pg_constraint c
  WHERE c.conname = 'course_offerings_term_id_fkey'
    AND c.conrelid = 'public.course_offerings'::regclass;

  IF COALESCE(v_convalidated, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_FK_NOT_VALIDATED' USING ERRCODE = 'check_violation';
  END IF;
  IF v_confdeltype = 'c' THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_FK_CASCADE_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;
  IF v_confdeltype IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'TERM_REMEDIATION_FK_NOT_RESTRICT' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (NULL, c_operation, 'course_offerings', NULL, NULL,
    jsonb_build_object(
      'operation', c_operation, 'phase', 'after', 'actor', 'migration_executor',
      'updated_offerings', v_updated, 'deleted_offerings', v_deleted_offerings,
      'deleted_assignments', v_deleted_ta, 'deleted_offering_sections', v_deleted_cos,
      'deleted_orphan_sections', v_deleted_orphan_sections,
      'remaining_offerings', v_remaining_total, 'remaining_term_orphans', v_orphan_after,
      'keep_teaching_assignments', v_keep_ta_after, 'keep_course_offering_sections', v_keep_cos_after,
      'shared_sections_protected', COALESCE(array_length(v_shared_section_ids, 1), 0),
      'fk_validated', true, 'on_delete_behavior', 'RESTRICT',
      'protected_master_counts_after', jsonb_build_object(
        'rooms', v_rooms_after, 'courses', v_courses_after,
        'instructors', v_instructors_after, 'academic_terms', v_terms_after,
        'schedule_sessions', v_sessions_after),
      'result', 'success', 'executed_at', clock_timestamp()));

  RAISE NOTICE 'COURSE_OFFERING_TERM_REMEDIATION success updated=% deleted=% orphans=%',
    v_updated, v_deleted_offerings, v_orphan_after;
END $$;

COMMENT ON CONSTRAINT course_offerings_term_id_fkey ON public.course_offerings IS
  'Validated FK: course_offerings.term_id → academic_terms(id); ON DELETE RESTRICT; remediates legacy orphans.';

COMMIT;
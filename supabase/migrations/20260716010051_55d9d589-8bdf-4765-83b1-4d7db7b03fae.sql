-- PHASE-8: Harden course_offering_id dependencies (PR #28 HEAD 327ee810)
BEGIN;

DO $$
DECLARE
  c_operation constant text := 'COURSE_OFFERING_DEPENDENCY_HARDENING';
  c_expect_offerings constant integer := 84;
  c_expect_ta        constant integer := 174;
  c_expect_cos       constant integer := 5;
  c_expect_sessions  constant integer := 0;
  c_expect_orphans   constant integer := 0;
  v_executed_at timestamptz := clock_timestamp();
  v_offerings integer;
  v_ta integer;
  v_cos integer;
  v_sessions integer;
  v_ta_nulls integer;
  v_cos_nulls integer;
  v_ss_nulls integer;
  v_ta_orphans integer;
  v_cos_orphans integer;
  v_ss_orphans integer;
  v_index_exists boolean;
  v_success_state boolean := false;
  v_fk_ta_exists boolean;
  v_fk_cos_exists boolean;
  v_fk_ss_exists boolean;
  v_ta_validated boolean;
  v_cos_validated boolean;
  v_ss_validated boolean;
  v_ta_del char;
  v_cos_del char;
  v_ss_del char;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'i'
      AND c.relname = 'idx_schedule_sessions_course_offering_id'
  ) INTO v_index_exists;

  SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teaching_assignments_course_offering_id_fkey' AND conrelid = 'public.teaching_assignments'::regclass) INTO v_fk_ta_exists;
  SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'course_offering_sections_course_offering_id_fkey' AND conrelid = 'public.course_offering_sections'::regclass) INTO v_fk_cos_exists;
  SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_sessions_course_offering_id_fkey' AND conrelid = 'public.schedule_sessions'::regclass) INTO v_fk_ss_exists;

  IF v_fk_ta_exists THEN
    SELECT c.convalidated, c.confdeltype INTO v_ta_validated, v_ta_del FROM pg_constraint c
    WHERE c.conname = 'teaching_assignments_course_offering_id_fkey' AND c.conrelid = 'public.teaching_assignments'::regclass;
  END IF;
  IF v_fk_cos_exists THEN
    SELECT c.convalidated, c.confdeltype INTO v_cos_validated, v_cos_del FROM pg_constraint c
    WHERE c.conname = 'course_offering_sections_course_offering_id_fkey' AND c.conrelid = 'public.course_offering_sections'::regclass;
  END IF;
  IF v_fk_ss_exists THEN
    SELECT c.convalidated, c.confdeltype INTO v_ss_validated, v_ss_del FROM pg_constraint c
    WHERE c.conname = 'schedule_sessions_course_offering_id_fkey' AND c.conrelid = 'public.schedule_sessions'::regclass;
  END IF;

  v_success_state :=
    v_index_exists
    AND v_fk_ta_exists AND COALESCE(v_ta_validated, false) AND v_ta_del = 'r'
    AND v_fk_cos_exists AND COALESCE(v_cos_validated, false) AND v_cos_del = 'r'
    AND v_fk_ss_exists AND COALESCE(v_ss_validated, false) AND v_ss_del = 'r';

  IF v_success_state THEN
    INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (NULL, c_operation, 'course_offerings', NULL, NULL,
      jsonb_build_object('operation', c_operation, 'phase', 'idempotent', 'result', 'idempotent_noop',
        'actor', 'migration_executor',
        'index_name', 'idx_schedule_sessions_course_offering_id',
        'fk_names', jsonb_build_array('teaching_assignments_course_offering_id_fkey','course_offering_sections_course_offering_id_fkey','schedule_sessions_course_offering_id_fkey'),
        'fk_validated', true, 'on_delete_behavior', 'RESTRICT', 'executed_at', v_executed_at));
    RAISE NOTICE 'COURSE_OFFERING_DEPENDENCY_HARDENING already applied — idempotent noop';
    RETURN;
  END IF;

  IF (v_fk_ta_exists AND v_ta_del = 'c') OR (v_fk_cos_exists AND v_cos_del = 'c') OR (v_fk_ss_exists AND v_ss_del = 'c') THEN
    RAISE EXCEPTION 'COURSE_OFFERING_DEP_FK_CASCADE_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;
  IF (v_fk_ta_exists AND v_ta_del = 'n') OR (v_fk_cos_exists AND v_cos_del = 'n') OR (v_fk_ss_exists AND v_ss_del = 'n') THEN
    RAISE EXCEPTION 'COURSE_OFFERING_DEP_FK_SET_NULL_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_offerings FROM public.course_offerings;
  IF v_offerings IS DISTINCT FROM c_expect_offerings THEN
    RAISE EXCEPTION 'COURSE_OFFERING_DEP_PREFLIGHT_OFFERINGS_MISMATCH: expected %, got %', c_expect_offerings, v_offerings USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer, COUNT(*) FILTER (WHERE course_offering_id IS NULL)::integer INTO v_ta, v_ta_nulls FROM public.teaching_assignments;
  IF v_ta IS DISTINCT FROM c_expect_ta OR v_ta_nulls <> 0 THEN
    RAISE EXCEPTION 'COURSE_OFFERING_DEP_PREFLIGHT_TA_MISMATCH: expected rows=% nulls=0, got rows=% nulls=%', c_expect_ta, v_ta, v_ta_nulls USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_ta_orphans FROM public.teaching_assignments ta
  WHERE NOT EXISTS (SELECT 1 FROM public.course_offerings co WHERE co.id = ta.course_offering_id);
  IF v_ta_orphans IS DISTINCT FROM c_expect_orphans THEN
    RAISE EXCEPTION 'COURSE_OFFERING_DEP_PREFLIGHT_TA_ORPHANS: expected %, got %', c_expect_orphans, v_ta_orphans USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer, COUNT(*) FILTER (WHERE course_offering_id IS NULL)::integer INTO v_cos, v_cos_nulls FROM public.course_offering_sections;
  IF v_cos IS DISTINCT FROM c_expect_cos OR v_cos_nulls <> 0 THEN
    RAISE EXCEPTION 'COURSE_OFFERING_DEP_PREFLIGHT_COS_MISMATCH: expected rows=% nulls=0, got rows=% nulls=%', c_expect_cos, v_cos, v_cos_nulls USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_cos_orphans FROM public.course_offering_sections cos
  WHERE NOT EXISTS (SELECT 1 FROM public.course_offerings co WHERE co.id = cos.course_offering_id);
  IF v_cos_orphans IS DISTINCT FROM c_expect_orphans THEN
    RAISE EXCEPTION 'COURSE_OFFERING_DEP_PREFLIGHT_COS_ORPHANS: expected %, got %', c_expect_orphans, v_cos_orphans USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer, COUNT(*) FILTER (WHERE course_offering_id IS NULL)::integer INTO v_sessions, v_ss_nulls FROM public.schedule_sessions;
  IF v_sessions IS DISTINCT FROM c_expect_sessions OR v_ss_nulls <> 0 THEN
    RAISE EXCEPTION 'COURSE_OFFERING_DEP_PREFLIGHT_SESSIONS_MISMATCH: expected rows=% nulls=0, got rows=% nulls=%', c_expect_sessions, v_sessions, v_ss_nulls USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*)::integer INTO v_ss_orphans FROM public.schedule_sessions ss
  WHERE NOT EXISTS (SELECT 1 FROM public.course_offerings co WHERE co.id = ss.course_offering_id);
  IF v_ss_orphans IS DISTINCT FROM c_expect_orphans THEN
    RAISE EXCEPTION 'COURSE_OFFERING_DEP_PREFLIGHT_SESSION_ORPHANS: expected %, got %', c_expect_orphans, v_ss_orphans USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (NULL, c_operation, 'course_offerings', NULL, NULL,
    jsonb_build_object('operation', c_operation, 'phase', 'before', 'actor', 'migration_executor',
      'counts', jsonb_build_object('course_offerings', v_offerings, 'teaching_assignments', v_ta,
        'course_offering_sections', v_cos, 'schedule_sessions', v_sessions,
        'ta_orphans', v_ta_orphans, 'cos_orphans', v_cos_orphans, 'session_orphans', v_ss_orphans),
      'executed_at', v_executed_at));

  IF NOT v_index_exists THEN
    EXECUTE 'CREATE INDEX idx_schedule_sessions_course_offering_id ON public.schedule_sessions (course_offering_id)';
  END IF;

  IF v_fk_ta_exists AND (COALESCE(v_ta_validated, false) = false OR v_ta_del IS DISTINCT FROM 'r') THEN
    EXECUTE 'ALTER TABLE public.teaching_assignments DROP CONSTRAINT teaching_assignments_course_offering_id_fkey';
    v_fk_ta_exists := false;
  END IF;
  IF NOT v_fk_ta_exists THEN
    EXECUTE 'ALTER TABLE public.teaching_assignments ADD CONSTRAINT teaching_assignments_course_offering_id_fkey FOREIGN KEY (course_offering_id) REFERENCES public.course_offerings(id) ON DELETE RESTRICT';
  END IF;

  IF v_fk_cos_exists AND (COALESCE(v_cos_validated, false) = false OR v_cos_del IS DISTINCT FROM 'r') THEN
    EXECUTE 'ALTER TABLE public.course_offering_sections DROP CONSTRAINT course_offering_sections_course_offering_id_fkey';
    v_fk_cos_exists := false;
  END IF;
  IF NOT v_fk_cos_exists THEN
    EXECUTE 'ALTER TABLE public.course_offering_sections ADD CONSTRAINT course_offering_sections_course_offering_id_fkey FOREIGN KEY (course_offering_id) REFERENCES public.course_offerings(id) ON DELETE RESTRICT';
  END IF;

  IF v_fk_ss_exists AND (COALESCE(v_ss_validated, false) = false OR v_ss_del IS DISTINCT FROM 'r') THEN
    EXECUTE 'ALTER TABLE public.schedule_sessions DROP CONSTRAINT schedule_sessions_course_offering_id_fkey';
    v_fk_ss_exists := false;
  END IF;
  IF NOT v_fk_ss_exists THEN
    EXECUTE 'ALTER TABLE public.schedule_sessions ADD CONSTRAINT schedule_sessions_course_offering_id_fkey FOREIGN KEY (course_offering_id) REFERENCES public.course_offerings(id) ON DELETE RESTRICT';
  END IF;

  SELECT c.convalidated, c.confdeltype INTO v_ta_validated, v_ta_del FROM pg_constraint c
  WHERE c.conname = 'teaching_assignments_course_offering_id_fkey' AND c.conrelid = 'public.teaching_assignments'::regclass;
  SELECT c.convalidated, c.confdeltype INTO v_cos_validated, v_cos_del FROM pg_constraint c
  WHERE c.conname = 'course_offering_sections_course_offering_id_fkey' AND c.conrelid = 'public.course_offering_sections'::regclass;
  SELECT c.convalidated, c.confdeltype INTO v_ss_validated, v_ss_del FROM pg_constraint c
  WHERE c.conname = 'schedule_sessions_course_offering_id_fkey' AND c.conrelid = 'public.schedule_sessions'::regclass;

  IF COALESCE(v_ta_validated, false) IS DISTINCT FROM true OR COALESCE(v_cos_validated, false) IS DISTINCT FROM true OR COALESCE(v_ss_validated, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'COURSE_OFFERING_DEP_FK_NOT_VALIDATED' USING ERRCODE = 'check_violation';
  END IF;
  IF v_ta_del = 'c' OR v_cos_del = 'c' OR v_ss_del = 'c' THEN
    RAISE EXCEPTION 'COURSE_OFFERING_DEP_FK_CASCADE_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;
  IF v_ta_del = 'n' OR v_cos_del = 'n' OR v_ss_del = 'n' THEN
    RAISE EXCEPTION 'COURSE_OFFERING_DEP_FK_SET_NULL_FORBIDDEN' USING ERRCODE = 'check_violation';
  END IF;
  IF v_ta_del IS DISTINCT FROM 'r' OR v_cos_del IS DISTINCT FROM 'r' OR v_ss_del IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'COURSE_OFFERING_DEP_FK_NOT_RESTRICT' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname = 'idx_schedule_sessions_course_offering_id') THEN
    RAISE EXCEPTION 'COURSE_OFFERING_DEP_INDEX_MISSING' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (NULL, c_operation, 'course_offerings', NULL, NULL,
    jsonb_build_object('operation', c_operation, 'phase', 'after', 'actor', 'migration_executor',
      'index_name', 'idx_schedule_sessions_course_offering_id',
      'fk_names', jsonb_build_array('teaching_assignments_course_offering_id_fkey','course_offering_sections_course_offering_id_fkey','schedule_sessions_course_offering_id_fkey'),
      'fk_validated', true, 'on_delete_behavior', 'RESTRICT',
      'no_cascade', true, 'no_set_null', true, 'no_data_mutation', true,
      'result', 'success', 'executed_at', clock_timestamp()));

  RAISE NOTICE 'COURSE_OFFERING_DEPENDENCY_HARDENING success';
END $$;

COMMENT ON CONSTRAINT teaching_assignments_course_offering_id_fkey ON public.teaching_assignments IS
  'Validated FK: teaching_assignments.course_offering_id → course_offerings(id); ON DELETE RESTRICT.';
COMMENT ON CONSTRAINT course_offering_sections_course_offering_id_fkey ON public.course_offering_sections IS
  'Validated FK: course_offering_sections.course_offering_id → course_offerings(id); ON DELETE RESTRICT.';
COMMENT ON CONSTRAINT schedule_sessions_course_offering_id_fkey ON public.schedule_sessions IS
  'Validated FK: schedule_sessions.course_offering_id → course_offerings(id); ON DELETE RESTRICT.';

COMMIT;
-- PHASE-6: Self-verifying room reference hardening (SOURCE ONLY — do not auto-apply).
-- Apply AFTER experimental schedule reset.
-- Migration executor verifies orphans, index, FK RESTRICT, and room delete snapshot — no anon preflight.

BEGIN;

DO $$
DECLARE
  v_orphan_count integer;
  v_fk_exists boolean;
  v_confdeltype char;
  v_convalidated boolean;
  v_index_exists boolean;
  v_executed_at timestamptz := clock_timestamp();
BEGIN
  SELECT COUNT(*)::integer INTO v_orphan_count
  FROM public.schedule_sessions s
  WHERE s.room_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = s.room_id);

  IF v_orphan_count > 0 THEN
    RAISE EXCEPTION 'ORPHAN_ROOM_REFERENCES_REMAIN'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'i'
      AND c.relname = 'idx_schedule_sessions_room_id'
  ) INTO v_index_exists;

  IF NOT v_index_exists THEN
    EXECUTE 'CREATE INDEX idx_schedule_sessions_room_id ON public.schedule_sessions (room_id)';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'schedule_sessions_room_id_fkey'
      AND conrelid = 'public.schedule_sessions'::regclass
  ) INTO v_fk_exists;

  IF v_fk_exists THEN
    SELECT c.confdeltype, c.convalidated
      INTO v_confdeltype, v_convalidated
    FROM pg_constraint c
    WHERE c.conname = 'schedule_sessions_room_id_fkey'
      AND c.conrelid = 'public.schedule_sessions'::regclass;

    IF v_confdeltype = 'c' OR COALESCE(v_convalidated, false) = false THEN
      EXECUTE 'ALTER TABLE public.schedule_sessions DROP CONSTRAINT schedule_sessions_room_id_fkey';
      v_fk_exists := false;
    END IF;
  END IF;

  IF NOT v_fk_exists THEN
    EXECUTE $ddl$
      ALTER TABLE public.schedule_sessions
        ADD CONSTRAINT schedule_sessions_room_id_fkey
        FOREIGN KEY (room_id)
        REFERENCES public.rooms(id)
        ON DELETE RESTRICT
    $ddl$;
  END IF;

  SELECT c.confdeltype, c.convalidated
    INTO v_confdeltype, v_convalidated
  FROM pg_constraint c
  WHERE c.conname = 'schedule_sessions_room_id_fkey'
    AND c.conrelid = 'public.schedule_sessions'::regclass;

  IF v_confdeltype IS NULL THEN
    RAISE EXCEPTION 'ROOM_FK_MISSING_AFTER_HARDEN'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_confdeltype = 'c' THEN
    RAISE EXCEPTION 'ROOM_FK_CASCADE_FORBIDDEN'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_confdeltype IS DISTINCT FROM 'r' AND v_confdeltype IS DISTINCT FROM 'a' THEN
    RAISE EXCEPTION 'ROOM_FK_DELETE_ACTION_INVALID'
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(v_convalidated, false) = false THEN
    RAISE EXCEPTION 'ROOM_FK_NOT_VALIDATED'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Availability FKs: RESTRICT only (no cascade-on-delete)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'room_availability'
  ) THEN
    EXECUTE 'ALTER TABLE public.room_availability DROP CONSTRAINT IF EXISTS room_availability_room_id_fkey';
    EXECUTE $ddl$
      ALTER TABLE public.room_availability
        ADD CONSTRAINT room_availability_room_id_fkey
        FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE RESTRICT
    $ddl$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'room_unavailability'
  ) THEN
    EXECUTE 'ALTER TABLE public.room_unavailability DROP CONSTRAINT IF EXISTS room_unavailability_room_id_fkey';
    EXECUTE $ddl$
      ALTER TABLE public.room_unavailability
        ADD CONSTRAINT room_unavailability_room_id_fkey
        FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE RESTRICT
    $ddl$;
  END IF;

  -- Room delete integrity + non-null snapshot (runtime may use auth.uid(); migration audit does not)
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.enforce_room_delete_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_session_refs integer;
  v_deleted_at timestamptz := now();
  v_deleted_by uuid := auth.uid();
BEGIN
  SELECT COUNT(*)::integer INTO v_session_refs
  FROM public.schedule_sessions
  WHERE room_id = OLD.id;

  IF v_session_refs > 0 THEN
    RAISE EXCEPTION
      'ROOM_IN_USE: لا يمكن حذف القاعة لأنها مستخدمة في جلسات دراسية.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  DELETE FROM public.room_availability WHERE room_id = OLD.id;
  DELETE FROM public.room_unavailability WHERE room_id = OLD.id;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_deleted_by,
    'room_delete_snapshot',
    'rooms',
    OLD.id,
    OLD.college_id,
    jsonb_build_object(
      'id', OLD.id,
      'college_id', OLD.college_id,
      'code', OLD.code,
      'name', OLD.name,
      'room_type', OLD.room_type,
      'capacity', OLD.capacity,
      'is_active', OLD.is_active,
      'deleted_by', v_deleted_by,
      'deleted_at', v_deleted_at,
      'snapshot', to_jsonb(OLD),
      'session_refs', 0,
      'note', 'Unused room deleted; required snapshot fields retained in audit_logs.details (never NULL)'
    )
  );

  RETURN OLD;
END;
$body$;
  $fn$;

  EXECUTE 'DROP TRIGGER IF EXISTS trg_rooms_delete_integrity ON public.rooms';
  EXECUTE $trg$
CREATE TRIGGER trg_rooms_delete_integrity
  BEFORE DELETE ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_room_delete_integrity()
  $trg$;

  EXECUTE 'REVOKE ALL ON FUNCTION public.enforce_room_delete_integrity() FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.enforce_room_delete_integrity() TO authenticated, service_role';
  EXECUTE $cmt$
COMMENT ON CONSTRAINT schedule_sessions_room_id_fkey ON public.schedule_sessions IS
  'Prevents orphan room_id and blocks deleting rooms referenced by schedule sessions (ON DELETE RESTRICT; cascade forbidden).'
  $cmt$;

  -- Re-read catalog for success audit
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'i' AND c.relname = 'idx_schedule_sessions_room_id'
  ) INTO v_index_exists;

  SELECT c.confdeltype, c.convalidated
    INTO v_confdeltype, v_convalidated
  FROM pg_constraint c
  WHERE c.conname = 'schedule_sessions_room_id_fkey'
    AND c.conrelid = 'public.schedule_sessions'::regclass;

  SELECT COUNT(*)::integer INTO v_orphan_count
  FROM public.schedule_sessions s
  WHERE s.room_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = s.room_id);

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    NULL,
    'ROOM_REFERENCE_HARDENING',
    'schedule_sessions',
    NULL,
    NULL,
    jsonb_build_object(
      'operation', 'ROOM_REFERENCE_HARDENING',
      'actor', 'migration_executor',
      'index_name', 'idx_schedule_sessions_room_id',
      'index_exists', v_index_exists,
      'fk_name', 'schedule_sessions_room_id_fkey',
      'fk_validated', v_convalidated,
      'on_delete_behavior', CASE v_confdeltype
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'c' THEN 'CASCADE'
        ELSE v_confdeltype::text
      END,
      'confdeltype', v_confdeltype,
      'orphan_count', v_orphan_count,
      'snapshot_mechanism_installed', true,
      'snapshot_trigger', 'trg_rooms_delete_integrity',
      'snapshot_function', 'enforce_room_delete_integrity',
      'result', 'success',
      'executed_at', v_executed_at
    )
  );

  IF v_orphan_count <> 0 OR v_index_exists IS NOT TRUE OR v_convalidated IS NOT TRUE THEN
    RAISE EXCEPTION 'ROOM_REFERENCE_HARDENING_POSTCHECK_FAILED'
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

COMMIT;
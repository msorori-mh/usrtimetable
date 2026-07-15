-- PHASE-6: Harden schedule room references (SOURCE ONLY — do not auto-apply).
-- Apply AFTER experimental schedule reset (no orphan session.room_id values).
-- 1) FK schedule_sessions.room_id → rooms(id) ON DELETE RESTRICT
-- 2) FK room_availability / room_unavailability → rooms ON DELETE CASCADE (room metadata)
-- 3) BEFORE DELETE on rooms: block if sessions reference; snapshot full row when delete proceeds

-- Fail fast if orphans remain (must run reset migration first)
DO $$
DECLARE orphan_count integer;
BEGIN
  SELECT COUNT(*)::integer INTO orphan_count
  FROM public.schedule_sessions s
  WHERE s.room_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = s.room_id);

  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'ROOM_FK_BLOCKED: % schedule_sessions.room_id values are orphans; apply experimental schedule reset first',
      orphan_count
      USING ERRCODE = 'foreign_key_violation';
  END IF;
END $$;

-- Schedule sessions: prevent orphan room refs + prevent delete of rooms in use
ALTER TABLE public.schedule_sessions
  DROP CONSTRAINT IF EXISTS schedule_sessions_room_id_fkey;

ALTER TABLE public.schedule_sessions
  ADD CONSTRAINT schedule_sessions_room_id_fkey
  FOREIGN KEY (room_id)
  REFERENCES public.rooms(id)
  ON DELETE RESTRICT;

-- Room availability rows are metadata of the room (not schedule usage)
ALTER TABLE public.room_availability
  DROP CONSTRAINT IF EXISTS room_availability_room_id_fkey;

ALTER TABLE public.room_availability
  ADD CONSTRAINT room_availability_room_id_fkey
  FOREIGN KEY (room_id)
  REFERENCES public.rooms(id)
  ON DELETE CASCADE;

ALTER TABLE public.room_unavailability
  DROP CONSTRAINT IF EXISTS room_unavailability_room_id_fkey;

ALTER TABLE public.room_unavailability
  ADD CONSTRAINT room_unavailability_room_id_fkey
  FOREIGN KEY (room_id)
  REFERENCES public.rooms(id)
  ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.enforce_room_delete_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_refs integer;
BEGIN
  SELECT COUNT(*)::integer INTO v_session_refs
  FROM public.schedule_sessions
  WHERE room_id = OLD.id;

  IF v_session_refs > 0 THEN
    RAISE EXCEPTION
      'ROOM_IN_USE: لا يمكن حذف قاعة مستخدمة في % جلسة جدول. انقل أو احذف الجلسات أولاً.',
      v_session_refs
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Full snapshot for unused room deletes (rolls back if later constraints fail)
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    auth.uid(),
    'room_delete_snapshot',
    'rooms',
    OLD.id,
    OLD.college_id,
    jsonb_build_object(
      'snapshot', to_jsonb(OLD),
      'session_refs', 0,
      'note', 'Unused room deleted; full row snapshot retained in audit_logs'
    )
  );

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_rooms_delete_integrity ON public.rooms;
CREATE TRIGGER trg_rooms_delete_integrity
  BEFORE DELETE ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_room_delete_integrity();

REVOKE ALL ON FUNCTION public.enforce_room_delete_integrity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_room_delete_integrity() TO authenticated, service_role;

COMMENT ON CONSTRAINT schedule_sessions_room_id_fkey ON public.schedule_sessions IS
  'Prevents orphan room_id and blocks deleting rooms referenced by schedule sessions (ON DELETE RESTRICT).';

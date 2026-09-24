-- Scope stale delivery-group protection to each work item instead of the whole draft.
--
-- Imported historical sessions may legitimately retain legacy group metadata.
-- They remain immutable and individually blocked by freshness.is_current and by
-- guard_schedule_session_current_delivery_group. A stale historical session must
-- not hide unrelated current, unscheduled work items from the scheduler.
--
-- This migration changes function code only. It performs no timetable DML.

BEGIN;

DO $do$
DECLARE
  v_signature regprocedure :=
    to_regprocedure('public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)');
  v_def text;
  v_start integer;
  v_end integer;
  v_start_marker text := E'\n  IF EXISTS (\n    SELECT 1\n    FROM public.schedule_sessions ss\n    JOIN public.delivery_groups raw_dg ON raw_dg.id=ss.delivery_group_id';
  v_end_marker text := E'\n\n  SELECT COALESCE(jsonb_agg';
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'LIST_SCHEDULE_BUILDER_V2_WORK_ITEMS_MISSING';
  END IF;

  v_def := pg_get_functiondef(v_signature);

  -- Idempotent replay: the version-wide guard has already been removed.
  IF position('SCHEDULE_VERSION_CONTAINS_STALE_DELIVERY_GROUPS' in v_def) = 0 THEN
    IF position('NOT freshness.is_current' in v_def) = 0
       OR position('can_create_session' in v_def) = 0 THEN
      RAISE EXCEPTION 'ROW_LEVEL_STALE_WORK_ITEM_GUARD_MISSING';
    END IF;
    RETURN;
  END IF;

  v_start := position(v_start_marker in v_def);
  v_end := position(v_end_marker in v_def);

  IF v_start = 0 OR v_end = 0 OR v_end <= v_start THEN
    RAISE EXCEPTION 'STALE_VERSION_GUARD_PATCH_ANCHOR_NOT_FOUND';
  END IF;

  -- Keep the newline that begins the original work-item SELECT.
  v_def := substring(v_def from 1 for v_start - 1)
        || substring(v_def from v_end + 1);

  EXECUTE v_def;

  v_def := pg_get_functiondef(v_signature);
  IF position('SCHEDULE_VERSION_CONTAINS_STALE_DELIVERY_GROUPS' in v_def) > 0 THEN
    RAISE EXCEPTION 'STALE_VERSION_GUARD_PATCH_FAILED';
  END IF;
  IF position('NOT freshness.is_current' in v_def) = 0
     OR position('can_create_session' in v_def) = 0 THEN
    RAISE EXCEPTION 'ROW_LEVEL_STALE_WORK_ITEM_GUARD_DAMAGED';
  END IF;
END
$do$;

COMMENT ON FUNCTION public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)
IS 'Returns all visible V2 work items. Stale delivery groups are blocked per row; unrelated current work remains schedulable.';

NOTIFY pgrst, 'reload schema';

COMMIT;

BEGIN;
-- The timetable sidebar must use the same version-effective assignments as
-- coverage. Historical active assignments replaced in this version are not
-- pending teaching work. A member covered by a version-level shared lecture
-- is represented by its anchor, unless it still has a physical session.
-- This only changes the read model; assignments and sessions remain intact.
DO $patch$
DECLARE
  signature text := 'public.list_schedule_builder_v2_work_items(uuid,uuid,uuid,uuid,text,text,uuid,text)';
  definition text := pg_get_functiondef(signature::regprocedure);
  before_text text := '      AND ta.delivery_group_id IS NOT NULL';
  after_text text := '      AND ta.delivery_group_id IS NOT NULL
      -- VERSION_EFFECTIVE_TIMETABLE_WORK_ITEMS
      AND EXISTS (
        SELECT 1 FROM public.version_effective_assignments(p_schedule_version_id) effective
        WHERE effective.assignment_id = ta.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM schedule_version_delivery_private.shared_link_facts merged
        WHERE merged.version_id = p_schedule_version_id
          AND merged.member_group_id = dg.id
          AND EXISTS (
            SELECT 1 FROM public.schedule_sessions anchor_session
            WHERE anchor_session.schedule_version_id = p_schedule_version_id
              AND anchor_session.delivery_group_id = merged.anchor_group_id
              AND NOT coalesce(anchor_session.replaced_by_split, false)
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.schedule_sessions own_session
            WHERE own_session.schedule_version_id = p_schedule_version_id
              AND own_session.delivery_group_id = dg.id
              AND NOT coalesce(own_session.replaced_by_split, false)
          )
      )';
BEGIN
  IF position('VERSION_EFFECTIVE_TIMETABLE_WORK_ITEMS' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF (length(definition) - length(replace(definition, before_text, '')))
       / length(before_text) <> 1 THEN
    RAISE EXCEPTION 'TIMETABLE_WORK_ITEMS_DEFINITION_DRIFT';
  END IF;
  EXECUTE replace(definition, before_text, after_text);
END $patch$;
COMMIT;

BEGIN;
-- Removes only the additive read model. The operational workspace function,
-- assignments, sessions and scope rows were never changed by the migration.
DROP FUNCTION IF EXISTS public.list_teaching_assignment_workspace_for_version(
  uuid,uuid,uuid,uuid,uuid,text,uuid,text,text);
COMMIT;

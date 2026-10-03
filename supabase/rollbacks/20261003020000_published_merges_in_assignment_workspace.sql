BEGIN;
-- Restores the global-links-only workspace, then removes the added helpers.
DO $unpatch$
DECLARE
  target text;
  d text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'public.list_teaching_assignment_workspace(uuid,uuid,uuid,uuid,text,uuid,text,text)',
    'public.list_teaching_assignment_workspace_for_version(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text)'
  ] LOOP
    d := pg_get_functiondef(target::regprocedure);
    d := replace(d, $a4$
      ) OR EXISTS (
        SELECT 1 FROM public.published_shared_lecture_members(dg.id)
      ) AS has_shared_members$a4$, $b4$
      ) AS has_shared_members$b4$);
    d := replace(d, $a3$
      AND NOT public.delivery_group_shared_in_published(dg.id)$a3$, '');
    d := replace(d, 'public.operational_shared_lecture_matches(', 'public.shared_lecture_matches(');
    d := replace(d, 'public.operational_shared_lecture_group_ids(', 'public.shared_lecture_group_ids(');
    EXECUTE d;
  END LOOP;
END $unpatch$;
DROP FUNCTION IF EXISTS public.operational_shared_lecture_matches(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.operational_shared_lecture_group_ids(uuid);
DROP FUNCTION IF EXISTS public.published_shared_lecture_members(uuid);
COMMIT;

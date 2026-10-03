BEGIN;
-- Restores the stored-flag-only test in every reader, then removes the helper.
-- Stored flags, assignments, sessions and merges were never changed.
DO $unpatch$
DECLARE
  t record;
  d text;
BEGIN
  FOR t IN SELECT * FROM (VALUES
    ('view', 'public.v_instructor_delivery_workload', 'dg'),
    ('function', 'public.list_teaching_assignment_workspace(uuid,uuid,uuid,uuid,text,uuid,text,text)', 'dg'),
    ('function', 'public.list_teaching_assignment_workspace_for_version(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text)', 'dg'),
    ('function', 'public.preview_instructor_workload_after_assignment(uuid,uuid,numeric,uuid)', 'dg'),
    ('function', 'public.preview_instructor_workload_after_assignment(uuid,uuid,numeric,uuid)', 'v_dg')
  ) AS x(kind, target, alias) LOOP
    IF t.kind = 'view' THEN
      d := pg_get_viewdef(t.target::regclass, true);
    ELSE
      d := pg_get_functiondef(t.target::regprocedure);
    END IF;
    -- A view is stored re-formatted (schema prefix dropped), so remove the
    -- added OR term in either spelling; the leftover parentheses are harmless.
    d := replace(d, format(' OR public.delivery_group_shared_in_published(%s.id)', t.alias), '');
    d := replace(d, format(' OR delivery_group_shared_in_published(%s.id)', t.alias), '');
    IF t.kind = 'view' THEN
      EXECUTE format('CREATE OR REPLACE VIEW %s AS %s', t.target, d);
    ELSE
      EXECUTE d;
    END IF;
  END LOOP;
END $unpatch$;
DROP FUNCTION IF EXISTS public.delivery_group_shared_in_published(uuid);
COMMIT;

-- Rollback for 20260927_itcs_version_scoped_assignments.sql.
-- Restores the three live functions verbatim from the definitions the
-- migration saved before patching. Refuses while scoped rows are in use.
DO $$
DECLARE d record;
BEGIN
  IF EXISTS (SELECT 1 FROM assignment_version_private.scope)
     OR EXISTS (SELECT 1 FROM assignment_version_private.request_scope) THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED_SCOPED_ROWS_EXIST';
  END IF;
  IF (SELECT count(*) FROM assignment_version_private.original_defs) <> 3 THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED_ORIGINALS_MISSING';
  END IF;
  FOR d IN SELECT * FROM assignment_version_private.original_defs LOOP
    EXECUTE d.definition;
    IF pg_get_functiondef(d.signature::regprocedure) <> d.definition THEN
      RAISE EXCEPTION 'ROLLBACK_RESTORE_MISMATCH %', d.signature;
    END IF;
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS trg_guard_session_version_scoped_assignment ON public.schedule_sessions;
DROP TRIGGER IF EXISTS trg_guard_version_scoped_publish ON public.schedule_versions;
DROP FUNCTION IF EXISTS public.guard_session_version_scoped_assignment();
DROP FUNCTION IF EXISTS public.guard_version_scoped_publish();
DROP FUNCTION IF EXISTS public.version_scoped_publish_gate(uuid);
DROP FUNCTION IF EXISTS public.seal_version_publish_expectation(uuid,integer,text);
DROP FUNCTION IF EXISTS public.apply_version_session_moves(uuid,jsonb,integer,text,text);
DROP FUNCTION IF EXISTS public.preview_version_session_moves(uuid,jsonb);
DROP FUNCTION IF EXISTS public.apply_version_scoped_replacements(uuid,jsonb,integer,text);
DROP FUNCTION IF EXISTS public.submit_version_scoped_teaching_request(uuid,uuid,uuid,numeric,text);
DROP FUNCTION IF EXISTS public.create_version_scoped_replacement_assignment(uuid,uuid,uuid,numeric);
DROP FUNCTION IF EXISTS assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid);
DROP FUNCTION IF EXISTS public.schedule_version_session_snapshot(uuid);
DROP FUNCTION IF EXISTS public.validate_version_assignment_allocation(uuid,uuid,numeric);
DROP FUNCTION IF EXISTS public.version_effective_assignments(uuid);
DROP SCHEMA assignment_version_private CASCADE;

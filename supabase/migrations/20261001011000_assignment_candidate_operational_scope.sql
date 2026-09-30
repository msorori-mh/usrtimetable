BEGIN;
-- Candidate visibility must use the same operational assignment policy as
-- the workspace, preview and save validation. Historical/draft alternatives
-- do not mean a lecturer is already assigned in the current workspace.
DO $patch$
DECLARE d text; old_fragment text; new_fragment text;
BEGIN
  d := pg_get_functiondef('public.get_delivery_group_assignment_candidates(uuid)'::regprocedure);
  IF position('assignment_version_private.is_counted(ta.id)' IN d) > 0 THEN
    RAISE EXCEPTION 'CANDIDATE_SCOPE_ALREADY_PATCHED';
  END IF;
  -- Support both deployed and repository candidate implementations.
  IF position('AND ta.is_active = TRUE' IN d) > 0 THEN
    old_fragment := 'AND ta.is_active = TRUE';
  ELSE
    old_fragment := 'AND ta.is_active';
  END IF;
  IF (length(d)-length(replace(d,old_fragment,'')))/length(old_fragment) <> 1 THEN
    RAISE EXCEPTION 'CANDIDATE_SCOPE_FUNCTION_DRIFT';
  END IF;
  new_fragment := old_fragment || E'\n          AND assignment_version_private.is_counted(ta.id)';
  EXECUTE replace(d,old_fragment,new_fragment);
END $patch$;
COMMIT;

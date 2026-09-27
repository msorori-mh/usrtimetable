-- Rollback for 20260927b (run BEFORE the Rev2 rollback). Restores the view,
-- workload(), guard_assignment_request(), and the two Rev2 writers verbatim.
DO $$
DECLARE d record; n int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM assignment_version_private.scope) THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED_SCOPED_ROWS_EXIST'; END IF;
  FOR d IN SELECT * FROM assignment_version_private.original_defs WHERE signature IN (
    'view:public.v_instructor_delivery_workload','faculty_private.workload(uuid,uuid)',
    'faculty_private.guard_assignment_request()',
    'assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid)',
    'public.apply_version_session_moves(uuid,jsonb,integer,text,text)') LOOP
    EXECUTE d.definition; n := n + 1;
    IF d.signature NOT LIKE 'view:%' AND pg_get_functiondef(d.signature::regprocedure) <> d.definition THEN
      RAISE EXCEPTION 'ROLLBACK_RESTORE_MISMATCH %', d.signature; END IF;
  END LOOP;
  IF n <> 5 THEN RAISE EXCEPTION 'ROLLBACK_BLOCKED_ORIGINALS_MISSING %', n; END IF;
  IF position('is_replacement_pair' IN pg_get_viewdef('public.v_instructor_delivery_workload'::regclass)) > 0 THEN
    RAISE EXCEPTION 'ROLLBACK_VIEW_NOT_RESTORED'; END IF;
  DELETE FROM assignment_version_private.original_defs WHERE signature IN (
    'view:public.v_instructor_delivery_workload','faculty_private.workload(uuid,uuid)',
    'faculty_private.guard_assignment_request()',
    'assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid)',
    'public.apply_version_session_moves(uuid,jsonb,integer,text,text)');
END $$;
DROP FUNCTION assignment_version_private.is_replacement_pair(uuid,uuid);
DROP FUNCTION assignment_version_private.is_same_identity_clone(uuid);
DROP TABLE assignment_version_private.enabled_versions;

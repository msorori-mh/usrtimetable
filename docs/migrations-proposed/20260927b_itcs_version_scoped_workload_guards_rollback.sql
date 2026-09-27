-- Rollback for 20260927b (run BEFORE the Rev2 rollback). Restores eight
-- definitions verbatim. Refuses while scope rows or promotions exist: removing
-- the pairing while both rows are active would re-create the P0.
DO $$
DECLARE d record; n int := 0;
  sigs text[] := ARRAY['view:public.v_instructor_delivery_workload','faculty_private.workload(uuid,uuid)',
    'faculty_private.guard_assignment_request()',
    'assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid)',
    'public.apply_version_session_moves(uuid,jsonb,integer,text,text)',
    'public.version_effective_assignments(uuid)',
    'public.guard_session_version_scoped_assignment()',
    'public.guard_version_scoped_publish()'];
BEGIN
  IF EXISTS (SELECT 1 FROM assignment_version_private.scope)
     OR EXISTS (SELECT 1 FROM assignment_version_private.promotions) THEN
    RAISE EXCEPTION 'ROLLBACK_BLOCKED_SCOPED_ROWS_EXIST'; END IF;
  FOR d IN SELECT * FROM assignment_version_private.original_defs WHERE signature = ANY (sigs) LOOP
    EXECUTE d.definition; n := n + 1;
    IF d.signature NOT LIKE 'view:%' AND pg_get_functiondef(d.signature::regprocedure) <> d.definition THEN
      RAISE EXCEPTION 'ROLLBACK_RESTORE_MISMATCH %', d.signature; END IF;
  END LOOP;
  IF n <> 8 THEN RAISE EXCEPTION 'ROLLBACK_BLOCKED_ORIGINALS_MISSING %', n; END IF;
  IF position('assignment_version_private' IN pg_get_viewdef('public.v_instructor_delivery_workload'::regclass)) > 0 THEN
    RAISE EXCEPTION 'ROLLBACK_VIEW_NOT_RESTORED'; END IF;
  DELETE FROM assignment_version_private.original_defs WHERE signature = ANY (sigs);
END $$;
DROP FUNCTION assignment_version_private.assert_projected_load(uuid);
DROP FUNCTION assignment_version_private.is_counted(uuid);
DROP FUNCTION assignment_version_private.new_side_wins(uuid);
DROP FUNCTION assignment_version_private.is_promoted(uuid);
DROP FUNCTION assignment_version_private.is_replacement_pair(uuid,uuid);
DROP TABLE assignment_version_private.promotions;
DROP TABLE assignment_version_private.enabled_versions;

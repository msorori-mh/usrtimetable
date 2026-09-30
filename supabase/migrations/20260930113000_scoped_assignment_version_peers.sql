-- A replacement in a new draft must not count a prior publication's sibling
-- replacement as a co-teacher. Keep the full allocation and college guards,
-- selecting peers from the target version's effective assignment set.
BEGIN;
DO $patch$
DECLARE d text:=pg_get_functiondef('public.ensure_ta_college()'::regprocedure);
 old_text text:='        AND (ta.id = NEW.id OR (assignment_version_private.is_counted(ta.id)
          AND NOT assignment_version_private.is_replacement_pair(NEW.id,ta.id)));';
 new_text text:='        AND ((NEW.scope_version_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.version_effective_assignments(NEW.scope_version_id) e
          WHERE e.assignment_id=ta.id))
          OR (NEW.scope_version_id IS NULL AND (ta.id=NEW.id OR (
            assignment_version_private.is_counted(ta.id)
            AND NOT assignment_version_private.is_replacement_pair(NEW.id,ta.id)))));';
BEGIN
 IF (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 THEN
  RAISE EXCEPTION 'VERSION_PEER_GUARD_DRIFT'; END IF;
 EXECUTE replace(d,old_text,new_text);
END $patch$;
DO $patch$
DECLARE d text:=pg_get_functiondef('faculty_private.guard_assignment_request()'::regprocedure);
 old_text text:='AND NOT assignment_version_private.is_replacement_pair(NEW.id,a.id))';
 new_text text:='AND NOT assignment_version_private.is_replacement_pair(NEW.id,a.id)
    AND (NEW.scope_version_id IS NULL OR EXISTS (
      SELECT 1 FROM public.version_effective_assignments(NEW.scope_version_id) e
      WHERE e.assignment_id=a.id)))';
BEGIN
 IF (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 THEN
  RAISE EXCEPTION 'VERSION_IDENTITY_PEER_GUARD_DRIFT'; END IF;
 EXECUTE replace(d,old_text,new_text);
END $patch$;
COMMIT;

BEGIN;
-- A draft's replacement stays the projected winner through review and approval.
-- Restricting this predicate to draft counts the old published copy again on
-- review -> approved, although no teaching hours changed. Keep every lineage,
-- college/term, promotion and workload-limit condition unchanged.
DO $patch$
DECLARE
  d text := pg_get_functiondef('assignment_version_private.new_side_wins(uuid)'::regprocedure);
  old_predicate constant text := 'target.status=''draft''';
  new_predicate constant text := 'target.status IN (''draft'',''review'',''approved'')';
  old_count integer;
  new_count integer;
BEGIN
  old_count := (length(d) - length(replace(d, old_predicate, ''))) / length(old_predicate);
  new_count := (length(d) - length(replace(d, new_predicate, ''))) / length(new_predicate);
  -- Safe to replay after an exact controlled application of this same fix.
  IF old_count = 0 AND new_count = 1 THEN RETURN; END IF;
  IF old_count <> 1 OR new_count <> 0 THEN
    RAISE EXCEPTION 'PROJECTED_SCOPED_ASSIGNMENT_LIFECYCLE_DRIFT';
  END IF;
  EXECUTE replace(d, old_predicate, new_predicate);
END $patch$;
COMMIT;

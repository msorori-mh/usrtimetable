BEGIN;
DO $patch$
DECLARE d text; fragment text := E'\n          AND assignment_version_private.is_counted(ta.id)';
BEGIN
  d := pg_get_functiondef('public.get_delivery_group_assignment_candidates(uuid)'::regprocedure);
  IF (length(d)-length(replace(d,fragment,'')))/length(fragment) <> 1 THEN
    RAISE EXCEPTION 'CANDIDATE_SCOPE_ROLLBACK_DRIFT';
  END IF;
  EXECUTE replace(d,fragment,'');
END $patch$;
COMMIT;

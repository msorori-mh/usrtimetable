-- A historical assignment and its registered draft replacement are not
-- co-teachers. Keep every college/component/hour guard, selecting live peers.
BEGIN;
DO $patch$
DECLARE d text:=pg_get_functiondef('public.ensure_ta_college()'::regprocedure);
 old_text text:=E'        AND ta.is_active = TRUE;';
 new_text text:=E'        AND ta.is_active = TRUE\n        AND (ta.id = NEW.id OR (assignment_version_private.is_counted(ta.id)\n          AND NOT assignment_version_private.is_replacement_pair(NEW.id,ta.id)));';
BEGIN
 IF (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 THEN
  RAISE EXCEPTION 'ENSURE_TA_ALLOCATION_DEFINITION_DRIFT'; END IF;
 EXECUTE replace(d,old_text,new_text);
END $patch$;
-- Trigger-only function needs owner access to the private scope helpers.
-- It performs validation, not privileged writes; its fixed search_path and
-- all original college, offering, instructor and component checks are retained.
ALTER FUNCTION public.ensure_ta_college() SECURITY DEFINER;
COMMIT;

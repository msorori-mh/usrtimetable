-- Eligibility invalidation does not change a timetable's coordination state.
-- Session writes, publication/coordination changes and term changes still run
-- the same final-state validator. No trigger or permission is disabled.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $patch$
DECLARE d text:=pg_get_functiondef('schedule_coordination_private.enforce_final_state()'::regprocedure);
 needle text:=' ELSIF TG_TABLE_NAME=''schedule_versions'' THEN';
BEGIN
 IF position('ELIGIBILITY_ONLY_INVALIDATION' in d)>0 THEN RETURN; END IF;
 IF (length(d)-length(replace(d,needle,'')))/length(needle)<>1 THEN
  RAISE EXCEPTION 'COORDINATION_INVALIDATION_FUNCTION_DRIFT'; END IF;
 EXECUTE replace(d,needle,needle||'
   -- ELIGIBILITY_ONLY_INVALIDATION: semantic writes keep full validation.
   IF TG_OP=''UPDATE'' AND
      (to_jsonb(NEW)-ARRAY[''eligibility_revision'',''updated_at'']) =
      (to_jsonb(OLD)-ARRAY[''eligibility_revision'',''updated_at'']) THEN
     RETURN NULL;
   END IF;');
END $patch$;

-- Adding a genuine HR assignment must not invalidate an otherwise exact
-- source timetable. Only the remaining verified source groups are exempt;
-- no new missing group is allowed, and the original 46-group ceiling remains.
DO $patch$
DECLARE d text:=pg_get_functiondef('public.schedule_version_delivery_coverage(uuid,uuid)'::regprocedure);
 needle text:='unassigned_groups=46 AND provisional_source_groups=46';
BEGIN
 IF position('unassigned_groups<=46 AND provisional_source_groups=unassigned_groups' in d)>0 THEN RETURN; END IF;
 IF (length(d)-length(replace(d,needle,'')))/length(needle)<>2
    OR position('public.education_source_revision_verified(p_schedule_version_id)' in d)=0 THEN
  RAISE EXCEPTION 'SOURCE_COMPLETION_FUNCTION_DRIFT'; END IF;
 EXECUTE replace(d,needle,'unassigned_groups<=46 AND provisional_source_groups=unassigned_groups');
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;

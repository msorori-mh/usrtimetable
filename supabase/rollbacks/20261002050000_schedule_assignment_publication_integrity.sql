BEGIN;
-- Emergency rollback: remove only this migration's injected forward-transition
-- call. Retain every other live lifecycle check, its body and existing ACL.
DO $rollback$
DECLARE
  v_definition text := pg_get_functiondef(
    'public.transition_schedule_version(uuid,uuid,text,text,text)'::regprocedure
  );
  v_helper text := '_assert_schedule_version_assignment_integrity';
  v_injected text := E'    IF (p_expected_status, p_target_status) IN (\n'
    || E'      (''draft'', ''review''), (''review'', ''approved''), (''approved'', ''published'')\n'
    || E'    ) THEN\n'
    || E'      PERFORM public._assert_schedule_version_assignment_integrity(p_college_id, p_schedule_version_id);\n'
    || E'    END IF;\n';
BEGIN
  IF (length(v_definition) - length(replace(v_definition, v_injected, ''))) / length(v_injected) <> 1
     OR (length(v_definition) - length(replace(v_definition, v_helper, ''))) / length(v_helper) <> 1 THEN
    RAISE EXCEPTION 'SCHEDULE_ASSIGNMENT_INTEGRITY_ROLLBACK_DRIFT';
  END IF;
  EXECUTE replace(v_definition, v_injected, '');
END;
$rollback$;
DROP FUNCTION public._assert_schedule_version_assignment_integrity(uuid,uuid);
COMMIT;

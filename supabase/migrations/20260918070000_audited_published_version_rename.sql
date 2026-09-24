-- Published names are display metadata. Permit audited, name-only maintenance
-- by the direct database administrator; application roles retain the original lock.
CREATE OR REPLACE FUNCTION public.enforce_schedule_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'published' AND NEW.name IS DISTINCT FROM OLD.name THEN
    IF current_user <> 'postgres' OR session_user <> 'postgres'
       OR auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'PUBLISHED_RENAME_ADMIN_REQUIRED' USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['name','updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['name','updated_at']) THEN
      RAISE EXCEPTION 'PUBLISHED_RENAME_NAME_ONLY' USING ERRCODE = '23514';
    END IF;
    IF NEW.name IS NULL OR length(btrim(NEW.name)) = 0 OR length(NEW.name) > 200 THEN
      RAISE EXCEPTION 'INVALID_SCHEDULE_VERSION_NAME' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
    VALUES (NULL,'schedule_version.renamed','schedule_versions',OLD.id,OLD.college_id,
      jsonb_build_object('old_name',OLD.name,'new_name',NEW.name,
        'status',OLD.status,'database_role',current_user,'session_role',session_user));
    RETURN NEW;
  END IF;
  IF OLD.status IN ('published', 'archived') AND
     (NEW.id, NEW.college_id, NEW.academic_term_id, NEW.name, NEW.notes,
      NEW.created_by, NEW.created_at) IS DISTINCT FROM
     (OLD.id, OLD.college_id, OLD.academic_term_id, OLD.name, OLD.notes,
      OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'IMMUTABLE_SCHEDULE_VERSION:%', OLD.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

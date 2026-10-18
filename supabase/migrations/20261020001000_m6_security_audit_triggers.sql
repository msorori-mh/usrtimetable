-- M-6: database-level audit trail for privilege and publication changes.
-- AFTER INSERT/UPDATE/DELETE on user_roles and user_colleges, and status
-- changes / deletes on schedule_versions, write a row to public.audit_logs with
-- the acting user (auth.uid()) and the database/JWT role
-- (coalesce(auth.role(), session_user)). This complements the client-side
-- record_audit_log calls, which are optional and can be skipped by a caller.
--
-- NOTE: public.capture_security_audit(), public.capture_security_membership(),
-- public.security_mfa_required() and public.security_access_status() are
-- referenced by migrations (20260921145509, 20260921145225) and src/ but are not
-- defined anywhere in this repository: they exist only in production. They are
-- intentionally NOT re-created here; dump them from production into a
-- migration so the repository can rebuild the schema.

CREATE SCHEMA IF NOT EXISTS security_private;
REVOKE ALL ON SCHEMA security_private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION security_private.audit_security_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_actor uuid;
  v_row jsonb;
  v_old jsonb;
  v_new jsonb;
  v_college uuid;
  v_entity_id uuid;
  v_action text;
BEGIN
  v_old := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  v_new := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  v_row := coalesce(v_new, v_old);

  IF TG_TABLE_NAME = 'schedule_versions' THEN
    v_entity_id := (v_row->>'id')::uuid;
    v_action := CASE TG_OP WHEN 'DELETE' THEN 'schedule_version_deleted'
                           ELSE 'schedule_version_status_changed' END;
    v_old := CASE WHEN v_old IS NOT NULL THEN jsonb_build_object(
               'status', v_old->>'status', 'name', v_old->>'name',
               'academic_term_id', v_old->>'academic_term_id', 'retired_at', v_old->>'retired_at') END;
    v_new := CASE WHEN v_new IS NOT NULL THEN jsonb_build_object(
               'status', v_new->>'status', 'name', v_new->>'name',
               'academic_term_id', v_new->>'academic_term_id', 'retired_at', v_new->>'retired_at') END;
  ELSE
    -- user_roles / user_colleges: the affected user is the entity
    v_entity_id := (v_row->>'user_id')::uuid;
    v_action := TG_TABLE_NAME || '_' || lower(TG_OP);
  END IF;

  v_college := nullif(v_row->>'college_id', '')::uuid;
  -- During cascades the parent college may already be gone; keep the id in details.
  IF v_college IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.colleges c WHERE c.id = v_college) THEN
    v_college := NULL;
  END IF;
  IF v_uid IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_uid) THEN
    v_actor := v_uid;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (v_actor, v_action, TG_TABLE_NAME, v_entity_id, v_college,
          jsonb_build_object(
            'source', 'db_trigger',
            'op', TG_OP,
            'actor_uid', v_uid,
            'db_role', coalesce(auth.role(), session_user::text),
            'old', v_old,
            'new', v_new));
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION security_private.audit_security_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS zz_audit_user_roles ON public.user_roles;
CREATE TRIGGER zz_audit_user_roles
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION security_private.audit_security_change();

DROP TRIGGER IF EXISTS zz_audit_user_colleges ON public.user_colleges;
CREATE TRIGGER zz_audit_user_colleges
  AFTER INSERT OR UPDATE OR DELETE ON public.user_colleges
  FOR EACH ROW EXECUTE FUNCTION security_private.audit_security_change();

DROP TRIGGER IF EXISTS zz_audit_schedule_version_status ON public.schedule_versions;
CREATE TRIGGER zz_audit_schedule_version_status
  AFTER UPDATE OF status ON public.schedule_versions
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION security_private.audit_security_change();

DROP TRIGGER IF EXISTS zz_audit_schedule_version_delete ON public.schedule_versions;
CREATE TRIGGER zz_audit_schedule_version_delete
  AFTER DELETE ON public.schedule_versions
  FOR EACH ROW EXECUTE FUNCTION security_private.audit_security_change();

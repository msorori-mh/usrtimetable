-- Recoverable removal of old archived versions from operational lists.
-- Historical sessions, reports and provenance remain intact.
BEGIN;
ALTER TABLE public.schedule_versions
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS retired_by uuid;

CREATE OR REPLACE FUNCTION public.set_archived_schedule_version_retired(
  p_version_id uuid, p_retire boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE v public.schedule_versions%ROWTYPE;
BEGIN
  IF p_version_id IS NULL OR p_retire IS NULL THEN
    RAISE EXCEPTION 'VERSION_RETIRE_ARGUMENT_REQUIRED' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_version_id::text, 9174));
  SELECT * INTO v FROM public.schedule_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT public.can_manage_college(auth.uid(), v.college_id) THEN
    RAISE EXCEPTION 'VERSION_NOT_FOUND_OR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v.status <> 'archived' OR v.is_coordination THEN
    RAISE EXCEPTION 'VERSION_RETIRE_REQUIRES_ARCHIVED_NON_COORDINATION' USING ERRCODE = '23514';
  END IF;
  UPDATE public.schedule_versions
    SET retired_at = CASE WHEN p_retire THEN coalesce(retired_at, now()) ELSE NULL END,
        retired_by = CASE WHEN p_retire THEN coalesce(retired_by, auth.uid()) ELSE NULL END
    WHERE id = v.id AND status = 'archived';
  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
  VALUES (auth.uid(), CASE WHEN p_retire THEN 'retire_archived' ELSE 'restore_archived' END,
          'schedule_versions', v.id, v.college_id,
          jsonb_build_object('name', v.name, 'term_id', v.academic_term_id));
  RETURN jsonb_build_object('version_id', v.id, 'retired', p_retire);
END;
$$;

-- The immutable-version guard permits only this bookkeeping change on an
-- archived version. It continues to forbid changes to its content and status.
CREATE OR REPLACE FUNCTION public.enforce_schedule_version_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF OLD.status IN ('published', 'archived') AND
     (NEW.id, NEW.college_id, NEW.academic_term_id, NEW.name, NEW.notes,
      NEW.created_by, NEW.created_at) IS DISTINCT FROM
     (OLD.id, OLD.college_id, OLD.academic_term_id, OLD.name, OLD.notes,
      OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'IMMUTABLE_SCHEDULE_VERSION:%', OLD.status USING ERRCODE = '23514';
  END IF;
  IF (NEW.retired_at, NEW.retired_by) IS DISTINCT FROM (OLD.retired_at, OLD.retired_by)
     AND (OLD.status <> 'archived' OR NEW.status <> 'archived') THEN
    RAISE EXCEPTION 'VERSION_RETIRE_REQUIRES_ARCHIVED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_archived_schedule_version_retired(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_archived_schedule_version_retired(uuid, boolean)
  TO authenticated;

COMMIT;

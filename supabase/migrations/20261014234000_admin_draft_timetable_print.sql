BEGIN;
-- Explicit authorization for all timetable print entry points. Keeping the
-- editor's existing draft-read access does not grant permission to print it.
CREATE OR REPLACE FUNCTION public.get_timetable_print_version(p_version_id uuid)
RETURNS TABLE(id uuid,name text,status text,college_id uuid,academic_term_id uuid,notes text,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE caller uuid:=auth.uid(); version public.schedule_versions%ROWTYPE;
BEGIN
  IF caller IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  SELECT * INTO version FROM public.schedule_versions WHERE schedule_versions.id=p_version_id;
  IF NOT FOUND OR version.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'PRINT_VERSION_NOT_FOUND' USING ERRCODE='P0002';
  END IF;
  IF NOT public.can_view_college(caller,version.college_id) THEN
    RAISE EXCEPTION 'PRINT_COLLEGE_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF version.status<>'published' AND NOT public.is_super_admin(caller) THEN
    RAISE EXCEPTION 'DRAFT_PRINT_SUPER_ADMIN_ONLY' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT version.id,version.name,version.status,version.college_id,
    version.academic_term_id,version.notes,version.updated_at;
END $function$;
REVOKE ALL ON FUNCTION public.get_timetable_print_version(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_timetable_print_version(uuid) TO authenticated,service_role;
COMMIT;

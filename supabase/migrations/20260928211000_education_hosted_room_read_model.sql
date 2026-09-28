BEGIN;
CREATE FUNCTION public.get_verified_hosted_schedule_sessions(p_version uuid)
RETURNS SETOF public.schedule_sessions
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='pg_catalog','public' AS $$
DECLARE c uuid;
BEGIN
 SELECT college_id INTO c FROM public.schedule_versions WHERE id=p_version;
 IF auth.uid() IS NULL OR c IS NULL OR NOT public.can_view_college(auth.uid(),c) THEN
   RAISE EXCEPTION 'HOSTED_SESSION_READ_FORBIDDEN' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT s.* FROM public.schedule_sessions s JOIN public.rooms r ON r.id=s.room_id
 WHERE s.schedule_version_id=p_version AND r.college_id<>s.college_id
 AND p_version='badcb000-9280-4260-8000-000000000001'::uuid
 AND public.education_source_revision_session_allowed(s);
END;
$$;
REVOKE ALL ON FUNCTION public.get_verified_hosted_schedule_sessions(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_verified_hosted_schedule_sessions(uuid) TO authenticated;
COMMIT;

-- Academic ownership stays on the program; a facility is never duplicated.
CREATE SCHEMA IF NOT EXISTS hosting_private;
REVOKE ALL ON SCHEMA hosting_private FROM PUBLIC, anon, authenticated;

CREATE TABLE hosting_private.program_rooms (
 program_id uuid NOT NULL REFERENCES public.academic_programs(id),
 room_id uuid NOT NULL REFERENCES public.rooms(id),
 evidence text NOT NULL CHECK (length(btrim(evidence)) >= 10),
 granted_by uuid NOT NULL,
 granted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (program_id, room_id)
);
ALTER TABLE hosting_private.program_rooms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hosting_private.program_rooms FROM PUBLIC, anon, authenticated;

CREATE FUNCTION hosting_private.room_allowed(p_program uuid, p_room uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = '' AS $$
 SELECT EXISTS (
  SELECT 1 FROM public.academic_programs p
  JOIN public.colleges owner ON owner.id = p.college_id
  JOIN public.rooms r ON r.id = p_room AND r.is_active
  JOIN public.colleges host ON host.id = r.college_id
  WHERE p.id = p_program AND NOT coalesce(p.is_archived, false)
   AND owner.university_id = host.university_id
   AND (r.college_id = p.college_id OR EXISTS (
    SELECT 1 FROM hosting_private.program_rooms g
    WHERE g.program_id = p.id AND g.room_id = r.id
   ))
 );
$$;

CREATE FUNCTION public.set_hosted_program_room(
 p_program_id uuid, p_room_id uuid, p_enabled boolean, p_evidence text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_college uuid; v_host uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
 END IF;
 IF p_enabled IS NULL OR length(btrim(coalesce(p_evidence, ''))) < 10 THEN
  RAISE EXCEPTION 'HOSTING_EVIDENCE_REQUIRED' USING ERRCODE = '23514';
 END IF;
 -- Same gate as schedule writers: grant/revocation cannot race a placement.
 UPDATE schedule_coordination_private.write_gate SET revision = revision + 1 WHERE id;
 SELECT p.college_id, r.college_id INTO v_college, v_host
 FROM public.academic_programs p
 JOIN public.colleges owner ON owner.id = p.college_id
 JOIN public.rooms r ON r.id = p_room_id
 JOIN public.colleges host ON host.id = r.college_id
 WHERE p.id = p_program_id AND owner.university_id = host.university_id
  AND p.college_id <> r.college_id AND NOT coalesce(p.is_archived, false)
  AND (NOT p_enabled OR r.is_active)
 FOR UPDATE OF p, r;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'HOSTING_SCOPE_INVALID' USING ERRCODE = '23514';
 END IF;
 IF p_enabled THEN
  INSERT INTO hosting_private.program_rooms(program_id, room_id, evidence, granted_by)
  VALUES (p_program_id, p_room_id, btrim(p_evidence), auth.uid())
  ON CONFLICT (program_id, room_id) DO UPDATE SET
   evidence = excluded.evidence, granted_by = excluded.granted_by, granted_at = now();
 ELSE
  IF EXISTS (
   SELECT 1 FROM public.schedule_sessions s
   JOIN public.course_offerings o ON o.id = s.course_offering_id
   JOIN public.schedule_versions v ON v.id = s.schedule_version_id
   WHERE o.program_id = p_program_id AND s.room_id = p_room_id
    AND v.status <> 'archived' AND NOT coalesce(s.replaced_by_split, false)
  ) THEN
   RAISE EXCEPTION 'HOSTING_ROOM_IN_USE' USING ERRCODE = '23514';
  END IF;
  DELETE FROM hosting_private.program_rooms
  WHERE program_id = p_program_id AND room_id = p_room_id;
 END IF;
 INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
 VALUES (auth.uid(), CASE WHEN p_enabled THEN 'program_room_granted' ELSE 'program_room_revoked' END,
  'academic_programs', p_program_id, v_college,
  jsonb_build_object('room_id', p_room_id, 'host_college_id', v_host, 'evidence', btrim(p_evidence)));
END;
$$;

CREATE FUNCTION public.list_hosted_program_rooms(p_college_id uuid, p_program_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_view_college(auth.uid(), p_college_id) THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.academic_programs
  WHERE id = p_program_id AND college_id = p_college_id AND NOT coalesce(is_archived, false)) THEN
  RAISE EXCEPTION 'HOSTING_PROGRAM_SCOPE_INVALID' USING ERRCODE = '42501';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id', r.id, 'code', r.code, 'name', r.name, 'room_type', r.room_type,
  'capacity', r.capacity, 'host_college_id', r.college_id,
  'host_college_name', c.name, 'is_hosted', r.college_id <> p_college_id
 ) ORDER BY c.name, r.code), '[]'::jsonb) INTO v_result
 FROM public.rooms r JOIN public.colleges c ON c.id = r.college_id
 WHERE hosting_private.room_allowed(p_program_id, r.id);
 RETURN v_result;
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hosting_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_hosted_program_room(uuid, uuid, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_hosted_program_rooms(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_hosted_program_room(uuid, uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_hosted_program_rooms(uuid, uuid) TO authenticated;

-- No program/assignment/session or live grant is changed by this foundation migration.
-- Existing placement guards remain in force until the complete transfer is validated.

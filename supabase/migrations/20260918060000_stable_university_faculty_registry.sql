-- Additive registry: never rewrites instructors, assignments, or schedules.
CREATE SEQUENCE public.faculty_number_seq;
CREATE TABLE public.faculty_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid NOT NULL REFERENCES public.universities(id),
  issuing_college_id uuid NOT NULL REFERENCES public.colleges(id),
  university_number text NOT NULL UNIQUE,
  serial bigint NOT NULL UNIQUE DEFAULT nextval('public.faculty_number_seq'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.faculty_identity_links (
  instructor_id uuid PRIMARY KEY REFERENCES public.instructors(id) ON DELETE CASCADE,
  identity_id uuid NOT NULL REFERENCES public.faculty_identities(id),
  linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX faculty_identity_links_identity_idx ON public.faculty_identity_links(identity_id);
ALTER TABLE public.faculty_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty_identity_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.faculty_identities, public.faculty_identity_links FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.faculty_number_seq FROM anon, authenticated;

CREATE FUNCTION public.register_instructor_faculty_identity(p_instructor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_instructor public.instructors%ROWTYPE;
  v_college public.colleges%ROWTYPE;
  v_university public.universities%ROWTYPE;
  v_serial bigint;
  v_identity uuid;
  v_university_code text;
  v_college_code text;
BEGIN
  -- Serialize only registration of this instructor; sequence allocates safely across colleges.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_instructor_id::text, 180600));
  IF EXISTS (SELECT 1 FROM public.faculty_identity_links WHERE instructor_id=p_instructor_id) THEN RETURN; END IF;
  SELECT * INTO STRICT v_instructor FROM public.instructors WHERE id=p_instructor_id;
  SELECT * INTO STRICT v_college FROM public.colleges
    WHERE id=coalesce(v_instructor.affiliation_college_id,v_instructor.college_id);
  SELECT * INTO STRICT v_university FROM public.universities WHERE id=v_college.university_id;
  IF v_university.id <> (SELECT university_id FROM public.colleges WHERE id=v_instructor.college_id) THEN
    RAISE EXCEPTION 'FACULTY_AFFILIATION_UNIVERSITY_MISMATCH';
  END IF;
  v_university_code := CASE WHEN v_university.id='447f6cef-4584-4299-83e0-be2254232375'::uuid
    THEN 'USABA' ELSE coalesce(nullif(regexp_replace(upper(trim(v_university.code)), '[^A-Z0-9]', '', 'g'),''),
      'U'||upper(replace(v_university.id::text,'-',''))) END;
  v_college_code := coalesce(nullif(regexp_replace(upper(trim(v_college.code)), '[^A-Z0-9]', '', 'g'),''),
    'C'||upper(replace(v_college.id::text,'-','')));
  v_serial := nextval('public.faculty_number_seq');
  INSERT INTO public.faculty_identities(university_id,issuing_college_id,university_number,serial)
  VALUES (v_university.id,v_college.id,v_university_code||'-'||v_college_code||'-'||
    lpad(v_serial::text,greatest(6,length(v_serial::text)),'0'),v_serial)
  RETURNING id INTO v_identity;
  INSERT INTO public.faculty_identity_links(instructor_id,identity_id) VALUES (p_instructor_id,v_identity);
END;
$$;
REVOKE ALL ON FUNCTION public.register_instructor_faculty_identity(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.register_new_instructor_faculty_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.register_instructor_faculty_identity(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.register_new_instructor_faculty_identity() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_register_faculty_identity AFTER INSERT ON public.instructors
FOR EACH ROW EXECUTE FUNCTION public.register_new_instructor_faculty_identity();

DO $$ DECLARE v_id uuid; BEGIN
  FOR v_id IN SELECT id FROM public.instructors ORDER BY created_at,id LOOP
    PERFORM public.register_instructor_faculty_identity(v_id);
  END LOOP;
END $$;

-- College access is checked for every link, including a shared identity.
CREATE FUNCTION public.get_instructor_university_numbers(p_instructor_ids uuid[])
RETURNS TABLE(instructor_id uuid,identity_id uuid,university_number text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT l.instructor_id,l.identity_id,f.university_number
  FROM public.faculty_identity_links l JOIN public.faculty_identities f ON f.id=l.identity_id
  JOIN public.instructors i ON i.id=l.instructor_id
  WHERE auth.uid() IS NOT NULL AND i.id=ANY(p_instructor_ids)
    AND public.can_view_college(auth.uid(),i.college_id)
$$;
REVOKE ALL ON FUNCTION public.get_instructor_university_numbers(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_instructor_university_numbers(uuid[]) TO authenticated;

-- Verified linking is explicit and institution-admin only. Old codes are retained as aliases.
CREATE TABLE public.faculty_identity_aliases (
  old_identity_id uuid PRIMARY KEY REFERENCES public.faculty_identities(id),
  identity_id uuid NOT NULL REFERENCES public.faculty_identities(id),
  linked_by uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CHECK(old_identity_id<>identity_id)
);
ALTER TABLE public.faculty_identity_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.faculty_identity_aliases FROM anon,authenticated;

CREATE FUNCTION public.link_verified_faculty_identity(p_instructor_id uuid,p_university_number text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_old uuid; v_target uuid; v_university uuid; v_target_university uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501';
  END IF;
  -- A single lock avoids cycles and opposite concurrent merge requests.
  PERFORM pg_advisory_xact_lock(180600,1);
  SELECT l.identity_id,f.university_id INTO STRICT v_old,v_university
    FROM public.faculty_identity_links l JOIN public.faculty_identities f ON f.id=l.identity_id
    WHERE l.instructor_id=p_instructor_id;
  SELECT f.id,f.university_id INTO STRICT v_target,v_target_university
    FROM public.faculty_identities f WHERE f.university_number=upper(trim(p_university_number));
  SELECT coalesce((SELECT a.identity_id FROM public.faculty_identity_aliases a WHERE a.old_identity_id=v_target),v_target) INTO v_target;
  IF v_university<>v_target_university THEN RAISE EXCEPTION 'FACULTY_UNIVERSITY_MISMATCH'; END IF;
  IF v_old=v_target THEN RETURN; END IF;
  UPDATE public.faculty_identity_links SET identity_id=v_target,linked_at=now() WHERE identity_id=v_old;
  UPDATE public.faculty_identity_aliases SET identity_id=v_target WHERE identity_id=v_old;
  INSERT INTO public.faculty_identity_aliases(old_identity_id,identity_id,linked_by)
    VALUES(v_old,v_target,auth.uid());
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,details)
    VALUES(auth.uid(),'faculty_identity_linked','instructors',p_instructor_id,
      jsonb_build_object('previous_identity',v_old,'identity',v_target));
END;
$$;
REVOKE ALL ON FUNCTION public.link_verified_faculty_identity(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_verified_faculty_identity(uuid,text) TO authenticated;

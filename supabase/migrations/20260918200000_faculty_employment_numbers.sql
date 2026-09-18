-- Employment codes are display identifiers; identity UUIDs and operational rows remain stable.
CREATE TABLE public.faculty_number_history (
  university_number text PRIMARY KEY,
  identity_id uuid NOT NULL REFERENCES public.faculty_identities(id),
  replaced_at timestamptz NOT NULL DEFAULT now(),
  replaced_by uuid
);
ALTER TABLE public.faculty_number_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.faculty_number_history FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.register_instructor_faculty_identity(p_instructor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_instructor public.instructors%ROWTYPE;
  v_college public.colleges%ROWTYPE;
  v_university public.universities%ROWTYPE;
  v_serial bigint;
  v_identity uuid;
  v_university_code text;
  v_college_code text;
  v_type_code text;
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
  SELECT lower(code) INTO v_type_code FROM public.instructor_types WHERE id=v_instructor.instructor_type_id;
  v_college_code := CASE v_type_code WHEN 'permanent' THEN 'P' WHEN 'annual_contract' THEN 'C' WHEN 'con' THEN 'H' ELSE v_college_code END;
  v_serial := nextval('public.faculty_number_seq');
  INSERT INTO public.faculty_identities(university_id,issuing_college_id,university_number,serial)
  VALUES (v_university.id,v_college.id,v_university_code||'-'||v_college_code||'-'||
    lpad(v_serial::text,greatest(6,length(v_serial::text)),'0'),v_serial)
  RETURNING id INTO v_identity;
  INSERT INTO public.faculty_identity_links(instructor_id,identity_id) VALUES (p_instructor_id,v_identity);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.academic_affairs_update_instructor(p_instructor_id uuid, p_full_name text, p_full_name_ar text, p_employee_number text, p_specialization text, p_academic_rank text, p_email text, p_phone text, p_employment_type text, p_max_weekly_hours integer, p_administrative_release_hours integer, p_is_active boolean, p_instructor_type_id uuid, p_affiliation_college_id uuid, p_affiliation_department_id uuid, p_administrative_position text, p_administrative_department_id uuid, p_administrative_support_department_id uuid)
 RETURNS instructors
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_current public.instructors%ROWTYPE;
  v_updated public.instructors%ROWTYPE;
  v_type_code text;
  v_hourly boolean := false;
  v_release integer;
  v_admin_position text;
  v_admin_department uuid;
  v_admin_support_department uuid;
  v_employee_number text;
  v_operational_department uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  SELECT * INTO v_current
  FROM public.instructors
  WHERE id = p_instructor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_FOUND';
  END IF;

  IF NOT public.has_role(v_actor, 'institutional_viewer')
     OR NOT public.is_viewer_only(v_actor)
     OR NOT public.user_in_college(v_actor, v_current.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege';
  END IF;

  IF btrim(COALESCE(p_full_name, '')) = '' THEN
    RAISE EXCEPTION 'INSTRUCTOR_NAME_REQUIRED';
  END IF;
  IF p_affiliation_college_id IS NULL OR p_affiliation_department_id IS NULL THEN
    RAISE EXCEPTION 'INSTRUCTOR_AFFILIATION_REQUIRED';
  END IF;
  IF NOT public.user_in_college(v_actor, p_affiliation_college_id) THEN
    RAISE EXCEPTION 'AFFILIATION_COLLEGE_FORBIDDEN';
  END IF;
  IF COALESCE(p_max_weekly_hours, -1) < 0 OR COALESCE(p_administrative_release_hours, -1) < 0 THEN
    RAISE EXCEPTION 'INSTRUCTOR_HOURS_MUST_BE_NONNEGATIVE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.departments d
    WHERE d.id = p_affiliation_department_id
      AND d.college_id = p_affiliation_college_id
  ) THEN
    RAISE EXCEPTION 'AFFILIATION_DEPARTMENT_COLLEGE_MISMATCH';
  END IF;

  IF p_instructor_type_id IS NOT NULL THEN
    SELECT it.code INTO v_type_code
    FROM public.instructor_types it
    WHERE it.id = p_instructor_type_id
      AND it.college_id = v_current.college_id
      AND it.is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INSTRUCTOR_TYPE_INVALID';
    END IF;
  END IF;

  v_hourly := lower(COALESCE(v_type_code, '')) = 'con';
  v_release := CASE WHEN v_hourly THEN 0 ELSE p_administrative_release_hours END;
  v_admin_position := CASE WHEN v_hourly THEN NULL ELSE NULLIF(btrim(COALESCE(p_administrative_position, '')), '') END;
  v_employee_number := CASE
    WHEN v_hourly THEN v_current.employee_number
    ELSE NULLIF(btrim(COALESCE(p_employee_number, '')), '')
  END;



  IF v_admin_position = 'department_head' THEN
    IF (p_administrative_department_id IS NULL) = (p_administrative_support_department_id IS NULL) THEN
      RAISE EXCEPTION 'ADMINISTRATIVE_DEPARTMENT_REQUIRED';
    END IF;
    IF p_administrative_department_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.departments d
      WHERE d.id = p_administrative_department_id
        AND d.college_id = p_affiliation_college_id
    ) THEN
      RAISE EXCEPTION 'ADMINISTRATIVE_DEPARTMENT_COLLEGE_MISMATCH';
    END IF;
    IF p_administrative_support_department_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.support_departments d
      WHERE d.id = p_administrative_support_department_id
        AND d.college_id = p_affiliation_college_id
    ) THEN
      RAISE EXCEPTION 'ADMINISTRATIVE_SUPPORT_DEPARTMENT_COLLEGE_MISMATCH';
    END IF;
    v_admin_department := p_administrative_department_id;
    v_admin_support_department := p_administrative_support_department_id;
  ELSE
    v_admin_department := NULL;
    v_admin_support_department := NULL;
  END IF;

  v_operational_department := CASE
    WHEN p_affiliation_college_id = v_current.college_id THEN p_affiliation_department_id
    ELSE v_current.department_id
  END;

  UPDATE public.instructors
  SET
    full_name = btrim(p_full_name),
    full_name_ar = COALESCE(NULLIF(btrim(COALESCE(p_full_name_ar, '')), ''), btrim(p_full_name)),
    employee_number = v_employee_number,
    specialization = NULLIF(btrim(COALESCE(p_specialization, '')), ''),
    academic_rank = NULLIF(btrim(COALESCE(p_academic_rank, '')), ''),
    email = NULLIF(btrim(COALESCE(p_email, '')), ''),
    phone = NULLIF(btrim(COALESCE(p_phone, '')), ''),
    employment_type = COALESCE(NULLIF(btrim(COALESCE(p_employment_type, '')), ''), 'unknown'),
    max_weekly_hours = p_max_weekly_hours,
    administrative_release_hours = v_release,
    is_active = p_is_active,
    instructor_type_id = p_instructor_type_id,
    affiliation_college_id = p_affiliation_college_id,
    affiliation_department_id = p_affiliation_department_id,
    administrative_position = v_admin_position,
    administrative_department_id = v_admin_department,
    administrative_support_department_id = v_admin_support_department,
    department_id = v_operational_department,
    updated_at = now()
  WHERE id = p_instructor_id
  RETURNING * INTO v_updated;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_actor,
    'academic_affairs_update',
    'instructors',
    p_instructor_id,
    v_current.college_id,
    jsonb_build_object(
      'scope', 'basic_instructor_data',
      'role', 'institutional_viewer',
      'affiliation_college_id', p_affiliation_college_id,
      'affiliation_department_id', p_affiliation_department_id
    )
  );

  RETURN v_updated;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.link_verified_faculty_identity(p_instructor_id uuid, p_university_number text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    FROM public.faculty_identities f WHERE f.id=(
      SELECT id FROM public.faculty_identities WHERE university_number=upper(trim(p_university_number))
      UNION ALL
      SELECT identity_id FROM public.faculty_number_history WHERE university_number=upper(trim(p_university_number))
      LIMIT 1
    );
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
$function$
;

CREATE FUNCTION public.update_faculty_employment_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_kind text; v_identity uuid; v_old text; v_new text; v_serial bigint;
BEGIN
  IF NEW.instructor_type_id IS NOT DISTINCT FROM OLD.instructor_type_id THEN RETURN NEW; END IF;
  SELECT CASE lower(code) WHEN 'permanent' THEN 'P' WHEN 'annual_contract' THEN 'C'
    WHEN 'con' THEN 'H' END INTO v_kind FROM public.instructor_types WHERE id=NEW.instructor_type_id;
  -- Unresolved/legacy categories never imply permanent employment.
  IF v_kind IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(180600,1);
  SELECT l.identity_id,f.university_number INTO v_identity,v_old
    FROM public.faculty_identity_links l JOIN public.faculty_identities f ON f.id=l.identity_id
    WHERE l.instructor_id=NEW.id FOR UPDATE OF f;
  IF v_identity IS NULL THEN RETURN NEW; END IF;
  -- A secondary college must not change the university-wide employment classification.
  IF NEW.college_id<>NEW.affiliation_college_id AND EXISTS (
    SELECT 1 FROM public.faculty_identity_links l JOIN public.instructors i ON i.id=l.instructor_id
    WHERE l.identity_id=v_identity AND i.id<>NEW.id
  ) THEN
    RAISE EXCEPTION 'غيّر الفئة الوظيفية من سجل الكلية الأصلية';
  END IF;
  IF split_part(v_old,'-',2)=v_kind THEN RETURN NEW; END IF;
  v_serial:=nextval('public.faculty_number_seq');
  v_new:=split_part(v_old,'-',1)||'-'||v_kind||'-'||lpad(v_serial::text,greatest(6,length(v_serial::text)),'0');
  INSERT INTO public.faculty_number_history(university_number,identity_id,replaced_by)
    VALUES(v_old,v_identity,auth.uid());
  UPDATE public.faculty_identities SET university_number=v_new WHERE id=v_identity;
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
    VALUES(auth.uid(),'faculty_employment_number_changed','instructors',NEW.id,NEW.college_id,
      jsonb_build_object('identity_id',v_identity,'previous_number',v_old,'university_number',v_new));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.update_faculty_employment_number() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER trg_update_faculty_employment_number AFTER UPDATE OF instructor_type_id ON public.instructors
FOR EACH ROW EXECUTE FUNCTION public.update_faculty_employment_number();

-- Supply missing explicit employment categories without reclassifying any existing person.
INSERT INTO public.instructor_types(college_id,code,name_ar,display_order)
SELECT c.id,t.code,t.label,t.ord FROM public.colleges c CROSS JOIN
 (VALUES ('permanent','مثبت',10),('annual_contract','متعاقد سنوي',20),('con','متعاقد بالساعات',30)) t(code,label,ord)
WHERE NOT EXISTS(SELECT 1 FROM public.instructor_types it WHERE it.college_id=c.id AND lower(it.code)=t.code);


CREATE FUNCTION public.get_instructor_number_aliases(p_instructor_ids uuid[])
RETURNS TABLE(instructor_id uuid,university_number text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT DISTINCT l.instructor_id,n.university_number
 FROM public.faculty_identity_links l JOIN public.instructors i ON i.id=l.instructor_id
 CROSS JOIN LATERAL (
   SELECT h.university_number FROM public.faculty_number_history h WHERE h.identity_id=l.identity_id
   UNION
   SELECT f.university_number FROM public.faculty_identity_aliases a
     JOIN public.faculty_identities f ON f.id=a.old_identity_id WHERE a.identity_id=l.identity_id
   UNION
   SELECT h.university_number FROM public.faculty_identity_aliases a
     JOIN public.faculty_number_history h ON h.identity_id=a.old_identity_id WHERE a.identity_id=l.identity_id
 ) n
 WHERE auth.uid() IS NOT NULL AND i.id=ANY(p_instructor_ids) AND public.can_view_college(auth.uid(),i.college_id)
$$;
REVOKE ALL ON FUNCTION public.get_instructor_number_aliases(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_instructor_number_aliases(uuid[]) TO authenticated;

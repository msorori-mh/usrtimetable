-- Home affiliation defines the college directory for every role, including administrators.
-- Physical instructor IDs/college ownership and all operational schedules remain unchanged.
CREATE FUNCTION public.get_college_faculty_roster(p_college_id uuid,p_scope text DEFAULT 'home')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_university uuid; v_result jsonb; v_visitors jsonb := '[]'::jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_college_id IS NULL
  OR NOT public.can_view_college(auth.uid(),p_college_id) THEN
  RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF p_scope IS NULL OR p_scope NOT IN ('home','visiting','pending') THEN RAISE EXCEPTION 'INVALID_ROSTER_SCOPE'; END IF;
 SELECT university_id INTO v_university FROM public.colleges
 WHERE id=p_college_id AND name !~* 'TEST_ONLY';
 IF NOT FOUND THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_scope='visiting' THEN
   v_visitors := public.get_college_instructor_schedule_directory(p_college_id);
 END IF;
 SELECT coalesce(jsonb_agg(
   jsonb_build_object(
    'id',i.id,'college_id',i.college_id,'identity_id',h.identity_id,
    'university_number',h.university_number,'full_name',h.full_name,
    'full_name_ar',i.full_name_ar,'full_name_en',i.full_name_en,
    'academic_rank',i.academic_rank,'specialization',i.specialization,
    'employment_type',i.employment_type,'is_active',i.is_active,
    'max_weekly_hours',i.max_weekly_hours,
    'administrative_release_hours',i.administrative_release_hours,
    'authoritative_quota',h.quota,
    'home_college_id',h.home_college_id,'home_college_name',h.home_college_name,
    'department_id',d.id,'home_department',d.name,
    'affiliation_college_id',h.home_college_id,'affiliation_department_id',d.id,
    'instructor_type_id',coalesce(it.id,i.instructor_type_id),'instructor_type_code',h.type_code,
    'type_name',source_type.name_ar,'updated_at',i.updated_at,
    'can_edit',coalesce(h.home_college_id=p_college_id AND (
       public.can_manage_college(auth.uid(),p_college_id) OR (
       public.has_role(auth.uid(),'institutional_viewer') AND public.is_viewer_only(auth.uid())
       AND public.user_in_college(auth.uid(),p_college_id))),false),
    'can_delete',coalesce(h.home_college_id=p_college_id AND i.college_id=p_college_id
       AND public.can_manage_college(auth.uid(),p_college_id),false)
   ) || CASE WHEN h.home_college_id=p_college_id THEN
    jsonb_build_object('email',i.email,'phone',i.phone,'employee_number',i.employee_number,
      'notes',i.notes,'admin_tasks',i.admin_tasks,'administrative_position',i.administrative_position,
      'administrative_department_id',i.administrative_department_id,
      'administrative_support_department_id',i.administrative_support_department_id)
   ELSE jsonb_build_object('email',null,'phone',null,'employee_number',null,
      'notes',null,'admin_tasks',null,'administrative_position',null,
      'administrative_department_id',null,'administrative_support_department_id',null) END
 ORDER BY h.full_name,h.identity_id),'[]'::jsonb) INTO v_result
 FROM faculty_private.home_profiles h
 JOIN public.instructors i ON i.id=h.source_instructor_id
 LEFT JOIN public.departments d ON d.id=i.affiliation_department_id AND d.college_id=h.home_college_id
 LEFT JOIN public.instructor_types source_type ON source_type.id=i.instructor_type_id
 LEFT JOIN LATERAL (
   SELECT t.id FROM public.instructor_types t
   WHERE t.college_id=p_college_id AND lower(t.code)=lower(h.type_code) AND t.is_active
   ORDER BY t.id LIMIT 1
 ) it ON true
 WHERE h.university_id=v_university AND h.full_name !~* 'TEST_ONLY' AND (
   (p_scope='home' AND h.home_college_id=p_college_id)
   OR (p_scope='visiting' AND h.home_college_id<>p_college_id
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(v_visitors) v WHERE (v->>'identity_id')::uuid=h.identity_id))
   OR (p_scope='pending' AND h.home_college_id IS NULL AND EXISTS(
     SELECT 1 FROM public.faculty_identity_links l JOIN public.instructors local_i ON local_i.id=l.instructor_id
     WHERE l.identity_id=h.identity_id AND local_i.college_id=p_college_id))
 );
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.get_college_faculty_roster(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_college_faculty_roster(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_home_college_instructor(p_college_id uuid, p_expected_updated_at timestamptz, p_instructor_id uuid, p_full_name text, p_full_name_ar text, p_employee_number text, p_specialization text, p_academic_rank text, p_email text, p_phone text, p_employment_type text, p_max_weekly_hours integer, p_administrative_release_hours integer, p_is_active boolean, p_instructor_type_id uuid, p_affiliation_college_id uuid, p_affiliation_department_id uuid, p_administrative_position text, p_administrative_department_id uuid, p_administrative_support_department_id uuid)
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
  v_source_type uuid;
  v_home uuid;
  v_identity uuid;
  v_source uuid;
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

  PERFORM pg_advisory_xact_lock(180600,1);

  SELECT * INTO v_current
  FROM public.instructors
  WHERE id = p_instructor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_FOUND';
  END IF;

  SELECT h.home_college_id,h.identity_id,h.source_instructor_id
  INTO v_home,v_identity,v_source
  FROM faculty_private.home_profiles h
  JOIN public.faculty_identity_links l ON l.identity_id=h.identity_id
  WHERE l.instructor_id=p_instructor_id;
  IF p_college_id IS NULL OR v_home IS DISTINCT FROM p_college_id
     OR v_source IS DISTINCT FROM p_instructor_id
     OR NOT (public.can_manage_college(v_actor,p_college_id)
       OR (public.has_role(v_actor,'institutional_viewer') AND public.is_viewer_only(v_actor)
         AND public.user_in_college(v_actor,p_college_id))) THEN
    RAISE EXCEPTION 'تعديل بيانات المحاضر من كليته الأصلية فقط' USING ERRCODE='42501';
  END IF;
  IF p_expected_updated_at IS NULL OR v_current.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'تغيرت بيانات المحاضر؛ أعد تحميل القائمة قبل الحفظ';
  END IF;

  IF btrim(COALESCE(p_full_name, '')) = '' THEN
    RAISE EXCEPTION 'INSTRUCTOR_NAME_REQUIRED';
  END IF;
  IF p_affiliation_college_id IS NULL OR p_affiliation_department_id IS NULL THEN
    RAISE EXCEPTION 'INSTRUCTOR_AFFILIATION_REQUIRED';
  END IF;
  IF p_affiliation_college_id IS DISTINCT FROM p_college_id THEN
    RAISE EXCEPTION 'تغيير الكلية الأصلية يتم من تسوية التبعية' USING ERRCODE='42501';
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

  v_source_type := v_current.instructor_type_id;
  IF p_instructor_type_id IS DISTINCT FROM v_current.instructor_type_id THEN
    SELECT it.code INTO v_type_code FROM public.instructor_types it
    WHERE it.id=p_instructor_type_id AND it.college_id=p_college_id AND it.is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'INSTRUCTOR_TYPE_INVALID'; END IF;
    -- A college-local type ID is presentation metadata, not a new employment category.
    IF NOT EXISTS(SELECT 1 FROM public.instructor_types it
       WHERE it.id=v_current.instructor_type_id AND lower(it.code)=lower(v_type_code)) THEN
      IF lower(coalesce(v_type_code,'')) NOT IN ('permanent','annual_contract','con') THEN
        RAISE EXCEPTION 'اختر مثبت أو متعاقد سنوي أو متعاقد بالساعات';
      END IF;
      SELECT it.id INTO v_source_type FROM public.instructor_types it
      WHERE it.college_id=v_current.college_id AND lower(it.code)=lower(v_type_code) AND it.is_active
      ORDER BY it.id LIMIT 1;
      IF v_source_type IS NULL THEN RAISE EXCEPTION 'الفئة الوظيفية غير مهيأة؛ راجع الأدمن'; END IF;
    END IF;
  ELSE
    SELECT code INTO v_type_code FROM public.instructor_types WHERE id=v_source_type;
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

  IF v_employee_number IS DISTINCT FROM v_current.employee_number
     AND v_employee_number IS NOT NULL AND EXISTS(
       SELECT 1 FROM public.instructors other
       JOIN public.colleges oc ON oc.id=other.college_id
       JOIN public.colleges hc ON hc.id=p_college_id AND hc.university_id=oc.university_id
       LEFT JOIN public.faculty_identity_links l ON l.instructor_id=other.id
       WHERE btrim(other.employee_number)=v_employee_number
         AND l.identity_id IS DISTINCT FROM v_identity
     ) THEN RAISE EXCEPTION 'الرقم الوظيفي مرتبط بمحاضر آخر في الجامعة'; END IF;

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
    instructor_type_id = v_source_type,
    affiliation_college_id = p_affiliation_college_id,
    affiliation_department_id = p_affiliation_department_id,
    administrative_position = v_admin_position,
    administrative_department_id = v_admin_department,
    administrative_support_department_id = v_admin_support_department,
    department_id = v_operational_department,
    updated_at = clock_timestamp()
  WHERE id = p_instructor_id
  RETURNING * INTO v_updated;

  INSERT INTO public.audit_logs(actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_actor,
    'home_college_instructor_updated',
    'instructors',
    p_instructor_id,
    p_college_id,
    jsonb_build_object(
      'scope', 'basic_instructor_data',
      'source_college_id', v_current.college_id,
      'identity_id', v_identity,
      'affiliation_college_id', p_affiliation_college_id,
      'affiliation_department_id', p_affiliation_department_id
    )
  );

  RETURN v_updated;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_home_college_instructor(uuid,timestamptz,uuid,text,text,text,text,text,text,text,text,integer,integer,boolean,uuid,uuid,uuid,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_home_college_instructor(uuid,timestamptz,uuid,text,text,text,text,text,text,text,text,integer,integer,boolean,uuid,uuid,uuid,text,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION faculty_private.guard_instructor_home()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_home uuid; v_identity uuid; v_source uuid;
BEGIN
 IF TG_OP='INSERT' THEN
   PERFORM pg_advisory_xact_lock(180600,1);
   IF NEW.affiliation_college_id IS NOT NULL AND NEW.affiliation_college_id<>NEW.college_id THEN
     RAISE EXCEPTION 'أضف المحاضر في كليته الأصلية ثم اطلب تكليفه من صفحة الإسناد';
   END IF;
   IF nullif(btrim(NEW.employee_number),'') IS NOT NULL AND EXISTS(
     SELECT 1 FROM instructors i JOIN colleges c ON c.id=i.college_id JOIN colleges nc ON nc.id=NEW.college_id
     WHERE c.university_id=nc.university_id AND btrim(i.employee_number)=btrim(NEW.employee_number)) THEN
     RAISE EXCEPTION 'الرقم الوظيفي موجود؛ استخدم المحاضر المسجل أو راجع ربط الهوية';
   END IF;
 ELSE
   IF NEW.college_id IS DISTINCT FROM OLD.college_id THEN RAISE EXCEPTION 'استخدم تسوية التبعية مع الحفاظ على سجل الإسنادات'; END IF;
   IF auth.uid() IS NOT NULL AND NOT is_super_admin(auth.uid())
     AND NEW.affiliation_college_id IS DISTINCT FROM OLD.affiliation_college_id THEN
     RAISE EXCEPTION 'تغيير الكلية الأصلية يتم بواسطة الأدمن من تسوية التبعية' USING ERRCODE='42501';
   END IF;
   SELECT h.home_college_id,h.identity_id,h.source_instructor_id INTO v_home,v_identity,v_source FROM faculty_private.home_profiles h
     JOIN faculty_identity_links l ON l.identity_id=h.identity_id WHERE l.instructor_id=OLD.id;
   IF auth.uid() IS NOT NULL AND NOT is_super_admin(auth.uid()) AND v_identity IS NOT NULL
     AND (v_home IS NULL OR v_source IS DISTINCT FROM OLD.id OR NOT (
       can_manage_college(auth.uid(),v_home) OR
       (has_role(auth.uid(),'institutional_viewer') AND is_viewer_only(auth.uid())
         AND user_in_college(auth.uid(),v_home))
     )) THEN
     RAISE EXCEPTION 'تعديل بيانات المحاضر من الكلية الأصلية أو بواسطة الأدمن فقط' USING ERRCODE='42501';
   END IF;
   -- Reconfirm a borrowed quota after its source changes; never keep a stale approval.
   IF NEW.max_weekly_hours IS DISTINCT FROM OLD.max_weekly_hours
      OR NEW.administrative_release_hours IS DISTINCT FROM OLD.administrative_release_hours THEN
     UPDATE faculty_home_decisions SET quota_confirmed=false,updated_at=clock_timestamp()
     WHERE source_instructor_id=OLD.id AND quota_confirmed;
   END IF;
 END IF;
 RETURN NEW;
END $function$;

 

-- University-wide lookup is explicit, searched, bounded, and administrator-only.
CREATE FUNCTION public.search_faculty_identity_candidates(p_instructor_id uuid,p_search text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_university uuid; v_identity uuid; v_search text; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 SELECT f.university_id,l.identity_id INTO v_university,v_identity
 FROM public.faculty_identity_links l JOIN public.faculty_identities f ON f.id=l.identity_id
 WHERE l.instructor_id=p_instructor_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'FACULTY_IDENTITY_NOT_FOUND'; END IF;
 v_search:=translate(lower(btrim(coalesce(p_search,''))),'أإآى','اااي');
 IF length(v_search)<2 THEN RETURN '[]'::jsonb; END IF;
 SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO v_result FROM (
   SELECT h.source_instructor_id AS id,h.full_name,h.university_number,
     h.home_college_name AS home_college,h.specialization,
     i.employee_number
   FROM faculty_private.home_profiles h JOIN public.instructors i ON i.id=h.source_instructor_id
   WHERE h.university_id=v_university AND h.identity_id<>v_identity AND h.full_name !~* 'TEST_ONLY'
    AND (strpos(translate(lower(h.full_name),'أإآى','اااي'),v_search)>0
      OR strpos(lower(h.university_number),v_search)>0
      OR EXISTS(SELECT 1 FROM public.faculty_identity_links l JOIN public.instructors m ON m.id=l.instructor_id
        WHERE l.identity_id=h.identity_id AND (
          strpos(lower(coalesce(m.employee_number,'')),v_search)>0
          OR strpos(translate(lower(m.full_name),'أإآى','اااي'),v_search)>0))
      OR EXISTS(SELECT 1 FROM public.faculty_number_history n
        WHERE n.identity_id=h.identity_id AND strpos(lower(n.university_number),v_search)>0))
   ORDER BY h.full_name,h.identity_id LIMIT 30
 ) x;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.search_faculty_identity_candidates(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.search_faculty_identity_candidates(uuid,text) TO authenticated;


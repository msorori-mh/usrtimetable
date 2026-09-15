-- Academic affairs: reports + instructor basic-data editing only.
-- institutional_viewer remains denied by can_manage_college and all generic write policies.
-- The only write elevation is this SECURITY DEFINER RPC with an explicit field whitelist.

CREATE OR REPLACE FUNCTION public.academic_affairs_update_instructor(
  p_instructor_id uuid,
  p_full_name text,
  p_full_name_ar text,
  p_employee_number text,
  p_specialization text,
  p_academic_rank text,
  p_email text,
  p_phone text,
  p_employment_type text,
  p_max_weekly_hours integer,
  p_administrative_release_hours integer,
  p_is_active boolean,
  p_instructor_type_id uuid,
  p_affiliation_college_id uuid,
  p_affiliation_department_id uuid,
  p_administrative_position text,
  p_administrative_department_id uuid,
  p_administrative_support_department_id uuid
)
RETURNS public.instructors
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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

  IF NOT v_hourly AND v_employee_number IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_NUMBER_REQUIRED';
  END IF;

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
$$;

REVOKE ALL ON FUNCTION public.academic_affairs_update_instructor(
  uuid, text, text, text, text, text, text, text, text, integer, integer, boolean,
  uuid, uuid, uuid, text, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.academic_affairs_update_instructor(
  uuid, text, text, text, text, text, text, text, text, integer, integer, boolean,
  uuid, uuid, uuid, text, uuid, uuid
) TO authenticated;

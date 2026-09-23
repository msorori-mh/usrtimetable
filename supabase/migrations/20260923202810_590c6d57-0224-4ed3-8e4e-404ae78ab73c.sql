-- Instructor availability status: independent of employment_type and is_active.
ALTER TABLE public.instructors ADD COLUMN IF NOT EXISTS availability_status text;

-- Approved one-time initialization for existing rows only.
UPDATE public.instructors
SET availability_status = CASE WHEN is_active THEN 'available' ELSE 'unavailable' END
WHERE availability_status IS NULL;

ALTER TABLE public.instructors ALTER COLUMN availability_status SET DEFAULT 'available';
ALTER TABLE public.instructors ALTER COLUMN availability_status SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'instructors_availability_status_check') THEN
    ALTER TABLE public.instructors ADD CONSTRAINT instructors_availability_status_check
      CHECK (availability_status IN ('available','unavailable','sick_leave','sabbatical','external_scholarship','internal_scholarship'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.instructor_availability_label_ar(p_status text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_status
    WHEN 'available' THEN 'متوفر'
    WHEN 'unavailable' THEN 'غير متوفر'
    WHEN 'sick_leave' THEN 'إجازة مرضية'
    WHEN 'sabbatical' THEN 'تفرغ علمي'
    WHEN 'external_scholarship' THEN 'إبتعاث خارجي'
    WHEN 'internal_scholarship' THEN 'إبتعاث داخلي'
    ELSE 'غير معروفة' END
$$;

-- Guard: new assignment/session (or re-pointing to another instructor) requires an available instructor.
-- Existing rows keep working: updates that do not change instructor_id are never blocked.
CREATE OR REPLACE FUNCTION public.guard_new_work_requires_available_instructor()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_status text;
BEGIN
  IF NEW.instructor_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.instructor_id IS NOT DISTINCT FROM OLD.instructor_id THEN RETURN NEW; END IF;
  SELECT availability_status INTO v_status FROM public.instructors WHERE id = NEW.instructor_id;
  IF FOUND AND v_status <> 'available' THEN
    RAISE EXCEPTION 'لا يمكن % لهذا المحاضر لأن حالته: %',
      CASE WHEN TG_TABLE_NAME = 'teaching_assignments' THEN 'إنشاء إسناد تدريسي جديد' ELSE 'جدولة محاضرة جديدة' END,
      public.instructor_availability_label_ar(v_status)
      USING ERRCODE = '23514', DETAIL = 'INSTRUCTOR_NOT_AVAILABLE:' || v_status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ta_requires_available_instructor ON public.teaching_assignments;
CREATE TRIGGER trg_ta_requires_available_instructor
  BEFORE INSERT OR UPDATE OF instructor_id ON public.teaching_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_new_work_requires_available_instructor();

DROP TRIGGER IF EXISTS trg_ss_requires_available_instructor ON public.schedule_sessions;
CREATE TRIGGER trg_ss_requires_available_instructor
  BEFORE INSERT OR UPDATE OF instructor_id ON public.schedule_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_new_work_requires_available_instructor();

-- Roster returns the status (string-level patch of the current definition, idempotent).
DO $$
DECLARE d text := pg_get_functiondef('public.get_college_faculty_roster(uuid,text)'::regprocedure);
BEGIN
  IF position('availability_status' in d) = 0 THEN
    d := replace(d, '''is_active'',i.is_active,', '''is_active'',i.is_active,''availability_status'',i.availability_status,');
    IF position('availability_status' in d) = 0 THEN RAISE EXCEPTION 'roster patch anchor not found'; END IF;
    EXECUTE d;
  END IF;
END $$;

-- Overloads that save the status after the existing, fully-authorized update.
CREATE OR REPLACE FUNCTION public.update_home_college_instructor(p_college_id uuid, p_expected_updated_at timestamptz, p_instructor_id uuid, p_full_name text, p_full_name_ar text, p_employee_number text, p_specialization text, p_academic_rank text, p_email text, p_phone text, p_employment_type text, p_max_weekly_hours integer, p_administrative_release_hours integer, p_is_active boolean, p_instructor_type_id uuid, p_affiliation_college_id uuid, p_affiliation_department_id uuid, p_administrative_position text, p_administrative_department_id uuid, p_administrative_support_department_id uuid, p_availability_status text)
RETURNS public.instructors LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.instructors%ROWTYPE;
BEGIN
  IF p_availability_status IS NULL OR p_availability_status NOT IN ('available','unavailable','sick_leave','sabbatical','external_scholarship','internal_scholarship') THEN
    RAISE EXCEPTION 'قيمة الحالة غير صالحة' USING ERRCODE = '22023';
  END IF;
  v := public.update_home_college_instructor(p_college_id, p_expected_updated_at, p_instructor_id, p_full_name, p_full_name_ar, p_employee_number, p_specialization, p_academic_rank, p_email, p_phone, p_employment_type, p_max_weekly_hours, p_administrative_release_hours, p_is_active, p_instructor_type_id, p_affiliation_college_id, p_affiliation_department_id, p_administrative_position, p_administrative_department_id, p_administrative_support_department_id);
  UPDATE public.instructors SET availability_status = p_availability_status WHERE id = v.id RETURNING * INTO v;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.academic_affairs_update_instructor(p_instructor_id uuid, p_full_name text, p_full_name_ar text, p_employee_number text, p_specialization text, p_academic_rank text, p_email text, p_phone text, p_employment_type text, p_max_weekly_hours integer, p_administrative_release_hours integer, p_is_active boolean, p_instructor_type_id uuid, p_affiliation_college_id uuid, p_affiliation_department_id uuid, p_administrative_position text, p_administrative_department_id uuid, p_administrative_support_department_id uuid, p_availability_status text)
RETURNS public.instructors LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.instructors%ROWTYPE;
BEGIN
  IF p_availability_status IS NULL OR p_availability_status NOT IN ('available','unavailable','sick_leave','sabbatical','external_scholarship','internal_scholarship') THEN
    RAISE EXCEPTION 'قيمة الحالة غير صالحة' USING ERRCODE = '22023';
  END IF;
  v := public.academic_affairs_update_instructor(p_instructor_id, p_full_name, p_full_name_ar, p_employee_number, p_specialization, p_academic_rank, p_email, p_phone, p_employment_type, p_max_weekly_hours, p_administrative_release_hours, p_is_active, p_instructor_type_id, p_affiliation_college_id, p_affiliation_department_id, p_administrative_position, p_administrative_department_id, p_administrative_support_department_id);
  UPDATE public.instructors SET availability_status = p_availability_status WHERE id = v.id RETURNING * INTO v;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.update_home_college_instructor(uuid,timestamptz,uuid,text,text,text,text,text,text,text,text,integer,integer,boolean,uuid,uuid,uuid,text,uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.academic_affairs_update_instructor(uuid,text,text,text,text,text,text,text,text,integer,integer,boolean,uuid,uuid,uuid,text,uuid,uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_home_college_instructor(uuid,timestamptz,uuid,text,text,text,text,text,text,text,text,integer,integer,boolean,uuid,uuid,uuid,text,uuid,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.academic_affairs_update_instructor(uuid,text,text,text,text,text,text,text,text,integer,integer,boolean,uuid,uuid,uuid,text,uuid,uuid,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_new_work_requires_available_instructor() FROM PUBLIC, anon;

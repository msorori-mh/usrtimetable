
-- ============ INSTRUCTORS ============
CREATE TABLE public.instructors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  department_id uuid,
  full_name text NOT NULL,
  academic_rank text,
  email text,
  phone text,
  employment_type text NOT NULL DEFAULT 'full_time',
  max_weekly_hours integer NOT NULL DEFAULT 18,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX instructors_college_email_uniq ON public.instructors(college_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX instructors_college_idx ON public.instructors(college_id);
CREATE INDEX instructors_dept_idx ON public.instructors(department_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.instructors TO authenticated;
GRANT ALL ON public.instructors TO service_role;
ALTER TABLE public.instructors ENABLE ROW LEVEL SECURITY;
CREATE POLICY ins_select ON public.instructors FOR SELECT TO authenticated USING (can_view_college(auth.uid(), college_id));
CREATE POLICY ins_insert ON public.instructors FOR INSERT TO authenticated WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY ins_update ON public.instructors FOR UPDATE TO authenticated USING (can_manage_college(auth.uid(), college_id)) WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY ins_delete ON public.instructors FOR DELETE TO authenticated USING (can_manage_college(auth.uid(), college_id));

CREATE OR REPLACE FUNCTION public.ensure_instructor_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE dc uuid;
BEGIN
  IF NEW.department_id IS NOT NULL THEN
    SELECT college_id INTO dc FROM public.departments WHERE id = NEW.department_id;
    IF dc IS NULL OR dc <> NEW.college_id THEN RAISE EXCEPTION 'department/college mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_instructor_college BEFORE INSERT OR UPDATE ON public.instructors
FOR EACH ROW EXECUTE FUNCTION public.ensure_instructor_college();
CREATE TRIGGER trg_instructor_updated BEFORE UPDATE ON public.instructors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ INSTRUCTOR AVAILABILITY ============
CREATE TABLE public.instructor_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  instructor_id uuid NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  availability_type text NOT NULL DEFAULT 'available',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX ia_college_idx ON public.instructor_availability(college_id);
CREATE INDEX ia_instructor_idx ON public.instructor_availability(instructor_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.instructor_availability TO authenticated;
GRANT ALL ON public.instructor_availability TO service_role;
ALTER TABLE public.instructor_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY ia_select ON public.instructor_availability FOR SELECT TO authenticated USING (can_view_college(auth.uid(), college_id));
CREATE POLICY ia_insert ON public.instructor_availability FOR INSERT TO authenticated WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY ia_update ON public.instructor_availability FOR UPDATE TO authenticated USING (can_manage_college(auth.uid(), college_id)) WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY ia_delete ON public.instructor_availability FOR DELETE TO authenticated USING (can_manage_college(auth.uid(), college_id));

CREATE OR REPLACE FUNCTION public.ensure_ia_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE ic uuid;
BEGIN
  SELECT college_id INTO ic FROM public.instructors WHERE id = NEW.instructor_id;
  IF ic IS NULL OR ic <> NEW.college_id THEN RAISE EXCEPTION 'instructor/college mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ia_college BEFORE INSERT OR UPDATE ON public.instructor_availability
FOR EACH ROW EXECUTE FUNCTION public.ensure_ia_college();
CREATE TRIGGER trg_ia_updated BEFORE UPDATE ON public.instructor_availability FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ ROOMS ============
CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  room_type text NOT NULL DEFAULT 'lecture_room'
    CHECK (room_type IN ('lecture_room','computer_lab','network_lab','general_lab','auditorium')),
  capacity integer NOT NULL DEFAULT 30,
  building text,
  floor text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rooms_college_code_uniq ON public.rooms(college_id, lower(code));
CREATE INDEX rooms_college_idx ON public.rooms(college_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY rm_select ON public.rooms FOR SELECT TO authenticated USING (can_view_college(auth.uid(), college_id));
CREATE POLICY rm_insert ON public.rooms FOR INSERT TO authenticated WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY rm_update ON public.rooms FOR UPDATE TO authenticated USING (can_manage_college(auth.uid(), college_id)) WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY rm_delete ON public.rooms FOR DELETE TO authenticated USING (can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_rooms_updated BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ ROOM UNAVAILABILITY ============
CREATE TABLE public.room_unavailability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  room_id uuid NOT NULL,
  day_of_week smallint CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time,
  end_time time,
  start_date date,
  end_date date,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ru_college_idx ON public.room_unavailability(college_id);
CREATE INDEX ru_room_idx ON public.room_unavailability(room_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_unavailability TO authenticated;
GRANT ALL ON public.room_unavailability TO service_role;
ALTER TABLE public.room_unavailability ENABLE ROW LEVEL SECURITY;
CREATE POLICY ru_select ON public.room_unavailability FOR SELECT TO authenticated USING (can_view_college(auth.uid(), college_id));
CREATE POLICY ru_insert ON public.room_unavailability FOR INSERT TO authenticated WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY ru_update ON public.room_unavailability FOR UPDATE TO authenticated USING (can_manage_college(auth.uid(), college_id)) WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY ru_delete ON public.room_unavailability FOR DELETE TO authenticated USING (can_manage_college(auth.uid(), college_id));

CREATE OR REPLACE FUNCTION public.ensure_ru_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE rc uuid;
BEGIN
  SELECT college_id INTO rc FROM public.rooms WHERE id = NEW.room_id;
  IF rc IS NULL OR rc <> NEW.college_id THEN RAISE EXCEPTION 'room/college mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ru_college BEFORE INSERT OR UPDATE ON public.room_unavailability
FOR EACH ROW EXECUTE FUNCTION public.ensure_ru_college();
CREATE TRIGGER trg_ru_updated BEFORE UPDATE ON public.room_unavailability FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ TIME SLOTS ============
CREATE TABLE public.time_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  slot_order integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE UNIQUE INDEX ts_college_day_start_uniq ON public.time_slots(college_id, day_of_week, start_time);
CREATE UNIQUE INDEX ts_college_day_order_uniq ON public.time_slots(college_id, day_of_week, slot_order);
CREATE INDEX ts_college_idx ON public.time_slots(college_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_slots TO authenticated;
GRANT ALL ON public.time_slots TO service_role;
ALTER TABLE public.time_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY ts_select ON public.time_slots FOR SELECT TO authenticated USING (can_view_college(auth.uid(), college_id));
CREATE POLICY ts_insert ON public.time_slots FOR INSERT TO authenticated WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY ts_update ON public.time_slots FOR UPDATE TO authenticated USING (can_manage_college(auth.uid(), college_id)) WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY ts_delete ON public.time_slots FOR DELETE TO authenticated USING (can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_ts_updated BEFORE UPDATE ON public.time_slots FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ COURSE OFFERINGS ============
CREATE TABLE public.course_offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  term_id uuid NOT NULL,
  course_id uuid NOT NULL,
  program_id uuid,
  level_id uuid,
  expected_students integer NOT NULL DEFAULT 0,
  sections_count integer NOT NULL DEFAULT 1,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX co_unique ON public.course_offerings(college_id, term_id, course_id, COALESCE(program_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(level_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX co_college_idx ON public.course_offerings(college_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_offerings TO authenticated;
GRANT ALL ON public.course_offerings TO service_role;
ALTER TABLE public.course_offerings ENABLE ROW LEVEL SECURITY;
CREATE POLICY co_select ON public.course_offerings FOR SELECT TO authenticated USING (can_view_college(auth.uid(), college_id));
CREATE POLICY co_insert ON public.course_offerings FOR INSERT TO authenticated WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY co_update ON public.course_offerings FOR UPDATE TO authenticated USING (can_manage_college(auth.uid(), college_id)) WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY co_delete ON public.course_offerings FOR DELETE TO authenticated USING (can_manage_college(auth.uid(), college_id));

CREATE OR REPLACE FUNCTION public.ensure_co_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE tc uuid; cc uuid; pc uuid; lc uuid;
BEGIN
  SELECT college_id INTO tc FROM public.academic_terms WHERE id = NEW.term_id;
  SELECT college_id INTO cc FROM public.courses WHERE id = NEW.course_id;
  IF tc IS NULL OR cc IS NULL OR tc <> NEW.college_id OR cc <> NEW.college_id THEN
    RAISE EXCEPTION 'term/course/college mismatch';
  END IF;
  IF NEW.program_id IS NOT NULL THEN
    SELECT college_id INTO pc FROM public.academic_programs WHERE id = NEW.program_id;
    IF pc IS NULL OR pc <> NEW.college_id THEN RAISE EXCEPTION 'program/college mismatch'; END IF;
  END IF;
  IF NEW.level_id IS NOT NULL THEN
    SELECT college_id INTO lc FROM public.academic_levels WHERE id = NEW.level_id;
    IF lc IS NULL OR lc <> NEW.college_id THEN RAISE EXCEPTION 'level/college mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_co_college BEFORE INSERT OR UPDATE ON public.course_offerings
FOR EACH ROW EXECUTE FUNCTION public.ensure_co_college();
CREATE TRIGGER trg_co_updated BEFORE UPDATE ON public.course_offerings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ TEACHING ASSIGNMENTS ============
CREATE TABLE public.teaching_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  course_offering_id uuid NOT NULL,
  instructor_id uuid NOT NULL,
  section_number text,
  session_type text NOT NULL DEFAULT 'lecture'
    CHECK (session_type IN ('lecture','lab','tutorial','seminar')),
  weekly_hours numeric NOT NULL DEFAULT 3,
  required_room_type text
    CHECK (required_room_type IS NULL OR required_room_type IN ('lecture_room','computer_lab','network_lab','general_lab','auditorium')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ta_unique ON public.teaching_assignments(college_id, course_offering_id, instructor_id, session_type, COALESCE(section_number, ''));
CREATE INDEX ta_college_idx ON public.teaching_assignments(college_id);
CREATE INDEX ta_offering_idx ON public.teaching_assignments(course_offering_id);
CREATE INDEX ta_instructor_idx ON public.teaching_assignments(instructor_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teaching_assignments TO authenticated;
GRANT ALL ON public.teaching_assignments TO service_role;
ALTER TABLE public.teaching_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY ta_select ON public.teaching_assignments FOR SELECT TO authenticated USING (can_view_college(auth.uid(), college_id));
CREATE POLICY ta_insert ON public.teaching_assignments FOR INSERT TO authenticated WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY ta_update ON public.teaching_assignments FOR UPDATE TO authenticated USING (can_manage_college(auth.uid(), college_id)) WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY ta_delete ON public.teaching_assignments FOR DELETE TO authenticated USING (can_manage_college(auth.uid(), college_id));

CREATE OR REPLACE FUNCTION public.ensure_ta_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE oc uuid; ic uuid;
BEGIN
  SELECT college_id INTO oc FROM public.course_offerings WHERE id = NEW.course_offering_id;
  SELECT college_id INTO ic FROM public.instructors WHERE id = NEW.instructor_id;
  IF oc IS NULL OR ic IS NULL OR oc <> NEW.college_id OR ic <> NEW.college_id THEN
    RAISE EXCEPTION 'offering/instructor/college mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ta_college BEFORE INSERT OR UPDATE ON public.teaching_assignments
FOR EACH ROW EXECUTE FUNCTION public.ensure_ta_college();
CREATE TRIGGER trg_ta_updated BEFORE UPDATE ON public.teaching_assignments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

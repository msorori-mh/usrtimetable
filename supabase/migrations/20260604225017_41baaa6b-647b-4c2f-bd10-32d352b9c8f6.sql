
-- Helper: can a user manage academic data in a college?
CREATE OR REPLACE FUNCTION public.can_manage_college(_user_id uuid, _college_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id)
      OR (public.has_role(_user_id, 'college_admin') AND public.user_in_college(_user_id, _college_id));
$$;

CREATE OR REPLACE FUNCTION public.can_view_college(_user_id uuid, _college_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin(_user_id) OR public.user_in_college(_user_id, _college_id);
$$;

-- =========================================================
-- DEPARTMENTS
-- =========================================================
CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, code),
  UNIQUE (college_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments TO authenticated;
GRANT ALL ON public.departments TO service_role;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

CREATE POLICY dep_select ON public.departments FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY dep_insert ON public.departments FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY dep_update ON public.departments FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY dep_delete ON public.departments FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE TRIGGER dep_updated BEFORE UPDATE ON public.departments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- ACADEMIC PROGRAMS
-- =========================================================
CREATE TABLE public.academic_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  degree_type text NOT NULL DEFAULT 'bachelor',
  duration_years int NOT NULL DEFAULT 4,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, code),
  UNIQUE (college_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_programs TO authenticated;
GRANT ALL ON public.academic_programs TO service_role;
ALTER TABLE public.academic_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY prog_select ON public.academic_programs FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY prog_insert ON public.academic_programs FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY prog_update ON public.academic_programs FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY prog_delete ON public.academic_programs FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE OR REPLACE FUNCTION public.ensure_prog_college() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE pc uuid;
BEGIN
  SELECT college_id INTO pc FROM public.departments WHERE id = NEW.department_id;
  IF pc IS NULL OR pc <> NEW.college_id THEN
    RAISE EXCEPTION 'department/college mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prog_check_college BEFORE INSERT OR UPDATE ON public.academic_programs
  FOR EACH ROW EXECUTE FUNCTION public.ensure_prog_college();
CREATE TRIGGER prog_updated BEFORE UPDATE ON public.academic_programs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- STUDY PLANS
-- =========================================================
CREATE TABLE public.study_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.academic_programs(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  version text NOT NULL DEFAULT '1',
  effective_year int,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, code, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_plans TO authenticated;
GRANT ALL ON public.study_plans TO service_role;
ALTER TABLE public.study_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY sp_select ON public.study_plans FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY sp_insert ON public.study_plans FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY sp_update ON public.study_plans FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY sp_delete ON public.study_plans FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE OR REPLACE FUNCTION public.ensure_sp_college() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE pc uuid;
BEGIN
  SELECT college_id INTO pc FROM public.academic_programs WHERE id = NEW.program_id;
  IF pc IS NULL OR pc <> NEW.college_id THEN RAISE EXCEPTION 'program/college mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sp_check_college BEFORE INSERT OR UPDATE ON public.study_plans
  FOR EACH ROW EXECUTE FUNCTION public.ensure_sp_college();
CREATE TRIGGER sp_updated BEFORE UPDATE ON public.study_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- ACADEMIC LEVELS
-- =========================================================
CREATE TABLE public.academic_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  program_id uuid NOT NULL REFERENCES public.academic_programs(id) ON DELETE CASCADE,
  name text NOT NULL,
  level_number int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, level_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_levels TO authenticated;
GRANT ALL ON public.academic_levels TO service_role;
ALTER TABLE public.academic_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY lvl_select ON public.academic_levels FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY lvl_insert ON public.academic_levels FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY lvl_update ON public.academic_levels FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY lvl_delete ON public.academic_levels FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE OR REPLACE FUNCTION public.ensure_lvl_college() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE pc uuid;
BEGIN
  SELECT college_id INTO pc FROM public.academic_programs WHERE id = NEW.program_id;
  IF pc IS NULL OR pc <> NEW.college_id THEN RAISE EXCEPTION 'program/college mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lvl_check_college BEFORE INSERT OR UPDATE ON public.academic_levels
  FOR EACH ROW EXECUTE FUNCTION public.ensure_lvl_college();
CREATE TRIGGER lvl_updated BEFORE UPDATE ON public.academic_levels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- COURSES
-- =========================================================
CREATE TABLE public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  credit_hours numeric(4,2) NOT NULL DEFAULT 3,
  theory_hours int NOT NULL DEFAULT 0,
  practical_hours int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.courses TO authenticated;
GRANT ALL ON public.courses TO service_role;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY crs_select ON public.courses FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY crs_insert ON public.courses FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY crs_update ON public.courses FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY crs_delete ON public.courses FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE OR REPLACE FUNCTION public.ensure_crs_college() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE pc uuid;
BEGIN
  SELECT college_id INTO pc FROM public.departments WHERE id = NEW.department_id;
  IF pc IS NULL OR pc <> NEW.college_id THEN RAISE EXCEPTION 'department/college mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER crs_check_college BEFORE INSERT OR UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.ensure_crs_college();
CREATE TRIGGER crs_updated BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- PLAN COURSES
-- =========================================================
CREATE TABLE public.plan_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  study_plan_id uuid NOT NULL REFERENCES public.study_plans(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  level_id uuid REFERENCES public.academic_levels(id) ON DELETE SET NULL,
  semester int NOT NULL DEFAULT 1,
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_plan_id, course_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_courses TO authenticated;
GRANT ALL ON public.plan_courses TO service_role;
ALTER TABLE public.plan_courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY pc_select ON public.plan_courses FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY pc_insert ON public.plan_courses FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY pc_update ON public.plan_courses FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY pc_delete ON public.plan_courses FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE OR REPLACE FUNCTION public.ensure_pc_college() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE spc uuid; crc uuid; lvlc uuid;
BEGIN
  SELECT college_id INTO spc FROM public.study_plans WHERE id = NEW.study_plan_id;
  SELECT college_id INTO crc FROM public.courses WHERE id = NEW.course_id;
  IF spc IS NULL OR crc IS NULL OR spc <> NEW.college_id OR crc <> NEW.college_id THEN
    RAISE EXCEPTION 'plan/course/college mismatch';
  END IF;
  IF NEW.level_id IS NOT NULL THEN
    SELECT college_id INTO lvlc FROM public.academic_levels WHERE id = NEW.level_id;
    IF lvlc IS NULL OR lvlc <> NEW.college_id THEN RAISE EXCEPTION 'level/college mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pc_check_college BEFORE INSERT OR UPDATE ON public.plan_courses
  FOR EACH ROW EXECUTE FUNCTION public.ensure_pc_college();
CREATE TRIGGER pc_updated BEFORE UPDATE ON public.plan_courses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- ACADEMIC TERMS
-- =========================================================
CREATE TABLE public.academic_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  start_date date,
  end_date date,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, code),
  UNIQUE (college_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_terms TO authenticated;
GRANT ALL ON public.academic_terms TO service_role;
ALTER TABLE public.academic_terms ENABLE ROW LEVEL SECURITY;

CREATE POLICY trm_select ON public.academic_terms FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY trm_insert ON public.academic_terms FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY trm_update ON public.academic_terms FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY trm_delete ON public.academic_terms FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE TRIGGER trm_updated BEFORE UPDATE ON public.academic_terms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- SECTIONS
-- =========================================================
CREATE TABLE public.sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES public.academic_terms(id) ON DELETE CASCADE,
  section_number text NOT NULL,
  capacity int NOT NULL DEFAULT 30,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, term_id, section_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sections TO authenticated;
GRANT ALL ON public.sections TO service_role;
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY sec_select ON public.sections FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY sec_insert ON public.sections FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY sec_update ON public.sections FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY sec_delete ON public.sections FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE OR REPLACE FUNCTION public.ensure_sec_college() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE crc uuid; trc uuid;
BEGIN
  SELECT college_id INTO crc FROM public.courses WHERE id = NEW.course_id;
  SELECT college_id INTO trc FROM public.academic_terms WHERE id = NEW.term_id;
  IF crc IS NULL OR trc IS NULL OR crc <> NEW.college_id OR trc <> NEW.college_id THEN
    RAISE EXCEPTION 'course/term/college mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sec_check_college BEFORE INSERT OR UPDATE ON public.sections
  FOR EACH ROW EXECUTE FUNCTION public.ensure_sec_college();
CREATE TRIGGER sec_updated BEFORE UPDATE ON public.sections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

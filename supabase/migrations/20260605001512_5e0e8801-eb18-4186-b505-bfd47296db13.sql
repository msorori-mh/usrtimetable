
-- =========================================================================
-- 1. Course Session Pattern on plan_courses
-- =========================================================================
ALTER TABLE public.plan_courses
  ADD COLUMN IF NOT EXISTS lecture_session_duration numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS lab_session_duration numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS lectures_per_week integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labs_per_week integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS required_room_type_for_lecture text,
  ADD COLUMN IF NOT EXISTS required_room_type_for_lab text;

-- Validation trigger
CREATE OR REPLACE FUNCTION public.validate_plan_course_pattern()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.lectures_per_week < 0 OR NEW.labs_per_week < 0 THEN
    RAISE EXCEPTION 'lectures_per_week and labs_per_week must be >= 0';
  END IF;
  IF NEW.lectures_per_week > 0 AND NEW.lecture_session_duration <= 0 THEN
    RAISE EXCEPTION 'lecture_session_duration must be positive when lectures_per_week > 0';
  END IF;
  IF NEW.labs_per_week > 0 AND NEW.lab_session_duration <= 0 THEN
    RAISE EXCEPTION 'lab_session_duration must be positive when labs_per_week > 0';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_plan_course_pattern ON public.plan_courses;
CREATE TRIGGER trg_validate_plan_course_pattern
  BEFORE INSERT OR UPDATE ON public.plan_courses
  FOR EACH ROW EXECUTE FUNCTION public.validate_plan_course_pattern();

-- =========================================================================
-- 2. course_programs (Course to Programs Mapping)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.course_programs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  college_id uuid NOT NULL,
  course_id uuid NOT NULL,
  program_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, course_id, program_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_programs TO authenticated;
GRANT ALL ON public.course_programs TO service_role;
ALTER TABLE public.course_programs ENABLE ROW LEVEL SECURITY;

CREATE POLICY cp_select ON public.course_programs FOR SELECT TO authenticated
  USING (can_view_college(auth.uid(), college_id));
CREATE POLICY cp_insert ON public.course_programs FOR INSERT TO authenticated
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY cp_update ON public.course_programs FOR UPDATE TO authenticated
  USING (can_manage_college(auth.uid(), college_id))
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY cp_delete ON public.course_programs FOR DELETE TO authenticated
  USING (can_manage_college(auth.uid(), college_id));

CREATE INDEX IF NOT EXISTS idx_cp_course ON public.course_programs(course_id);
CREATE INDEX IF NOT EXISTS idx_cp_program ON public.course_programs(program_id);

CREATE OR REPLACE FUNCTION public.ensure_cp_college()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE cc uuid; pc uuid;
BEGIN
  SELECT college_id INTO cc FROM public.courses WHERE id = NEW.course_id;
  SELECT college_id INTO pc FROM public.academic_programs WHERE id = NEW.program_id;
  IF cc IS NULL OR pc IS NULL OR cc <> NEW.college_id OR pc <> NEW.college_id THEN
    RAISE EXCEPTION 'course/program/college mismatch';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cp_college ON public.course_programs;
CREATE TRIGGER trg_cp_college BEFORE INSERT OR UPDATE ON public.course_programs
  FOR EACH ROW EXECUTE FUNCTION public.ensure_cp_college();

DROP TRIGGER IF EXISTS trg_cp_updated_at ON public.course_programs;
CREATE TRIGGER trg_cp_updated_at BEFORE UPDATE ON public.course_programs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 3. section_groups and section_group_members
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.section_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  college_id uuid NOT NULL,
  academic_term_id uuid NOT NULL,
  course_id uuid NOT NULL,
  group_name text NOT NULL,
  expected_students_total integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (college_id, academic_term_id, course_id, group_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.section_groups TO authenticated;
GRANT ALL ON public.section_groups TO service_role;
ALTER TABLE public.section_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY sg_select ON public.section_groups FOR SELECT TO authenticated
  USING (can_view_college(auth.uid(), college_id));
CREATE POLICY sg_insert ON public.section_groups FOR INSERT TO authenticated
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY sg_update ON public.section_groups FOR UPDATE TO authenticated
  USING (can_manage_college(auth.uid(), college_id))
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY sg_delete ON public.section_groups FOR DELETE TO authenticated
  USING (can_manage_college(auth.uid(), college_id));

CREATE INDEX IF NOT EXISTS idx_sg_term ON public.section_groups(academic_term_id);
CREATE INDEX IF NOT EXISTS idx_sg_course ON public.section_groups(course_id);

CREATE OR REPLACE FUNCTION public.ensure_sg_college()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE tc uuid; cc uuid;
BEGIN
  SELECT college_id INTO tc FROM public.academic_terms WHERE id = NEW.academic_term_id;
  SELECT college_id INTO cc FROM public.courses WHERE id = NEW.course_id;
  IF tc IS NULL OR cc IS NULL OR tc <> NEW.college_id OR cc <> NEW.college_id THEN
    RAISE EXCEPTION 'term/course/college mismatch';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sg_college ON public.section_groups;
CREATE TRIGGER trg_sg_college BEFORE INSERT OR UPDATE ON public.section_groups
  FOR EACH ROW EXECUTE FUNCTION public.ensure_sg_college();

DROP TRIGGER IF EXISTS trg_sg_updated_at ON public.section_groups;
CREATE TRIGGER trg_sg_updated_at BEFORE UPDATE ON public.section_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.section_group_members (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  college_id uuid NOT NULL,
  section_group_id uuid NOT NULL,
  section_id uuid NOT NULL,
  expected_students integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_group_id, section_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.section_group_members TO authenticated;
GRANT ALL ON public.section_group_members TO service_role;
ALTER TABLE public.section_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY sgm_select ON public.section_group_members FOR SELECT TO authenticated
  USING (can_view_college(auth.uid(), college_id));
CREATE POLICY sgm_insert ON public.section_group_members FOR INSERT TO authenticated
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY sgm_update ON public.section_group_members FOR UPDATE TO authenticated
  USING (can_manage_college(auth.uid(), college_id))
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY sgm_delete ON public.section_group_members FOR DELETE TO authenticated
  USING (can_manage_college(auth.uid(), college_id));

CREATE INDEX IF NOT EXISTS idx_sgm_group ON public.section_group_members(section_group_id);
CREATE INDEX IF NOT EXISTS idx_sgm_section ON public.section_group_members(section_id);

CREATE OR REPLACE FUNCTION public.ensure_sgm_college()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE gc uuid; sc uuid;
BEGIN
  SELECT college_id INTO gc FROM public.section_groups WHERE id = NEW.section_group_id;
  SELECT college_id INTO sc FROM public.sections WHERE id = NEW.section_id;
  IF gc IS NULL OR sc IS NULL OR gc <> NEW.college_id OR sc <> NEW.college_id THEN
    RAISE EXCEPTION 'group/section/college mismatch';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sgm_college ON public.section_group_members;
CREATE TRIGGER trg_sgm_college BEFORE INSERT OR UPDATE ON public.section_group_members
  FOR EACH ROW EXECUTE FUNCTION public.ensure_sgm_college();

-- =========================================================================
-- 4. course_offering_sections (bridge) + teaching_assignments.section_id
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.course_offering_sections (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  college_id uuid NOT NULL,
  course_offering_id uuid NOT NULL,
  section_id uuid NOT NULL,
  expected_students integer NOT NULL DEFAULT 0,
  section_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_offering_id, section_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_offering_sections TO authenticated;
GRANT ALL ON public.course_offering_sections TO service_role;
ALTER TABLE public.course_offering_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY cos_select ON public.course_offering_sections FOR SELECT TO authenticated
  USING (can_view_college(auth.uid(), college_id));
CREATE POLICY cos_insert ON public.course_offering_sections FOR INSERT TO authenticated
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY cos_update ON public.course_offering_sections FOR UPDATE TO authenticated
  USING (can_manage_college(auth.uid(), college_id))
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY cos_delete ON public.course_offering_sections FOR DELETE TO authenticated
  USING (can_manage_college(auth.uid(), college_id));

CREATE INDEX IF NOT EXISTS idx_cos_offering ON public.course_offering_sections(course_offering_id);
CREATE INDEX IF NOT EXISTS idx_cos_section ON public.course_offering_sections(section_id);

CREATE OR REPLACE FUNCTION public.ensure_cos_college()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE oc uuid; sc uuid;
BEGIN
  SELECT college_id INTO oc FROM public.course_offerings WHERE id = NEW.course_offering_id;
  SELECT college_id INTO sc FROM public.sections WHERE id = NEW.section_id;
  IF oc IS NULL OR sc IS NULL OR oc <> NEW.college_id OR sc <> NEW.college_id THEN
    RAISE EXCEPTION 'offering/section/college mismatch';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_cos_college ON public.course_offering_sections;
CREATE TRIGGER trg_cos_college BEFORE INSERT OR UPDATE ON public.course_offering_sections
  FOR EACH ROW EXECUTE FUNCTION public.ensure_cos_college();

DROP TRIGGER IF EXISTS trg_cos_updated_at ON public.course_offering_sections;
CREATE TRIGGER trg_cos_updated_at BEFORE UPDATE ON public.course_offering_sections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Add nullable section_id to teaching_assignments (do NOT remove section_number)
ALTER TABLE public.teaching_assignments
  ADD COLUMN IF NOT EXISTS section_id uuid;

CREATE INDEX IF NOT EXISTS idx_ta_section ON public.teaching_assignments(section_id);

-- =========================================================================
-- 5. course_offerings: study_plan_id, plan_course_id, status
-- =========================================================================
ALTER TABLE public.course_offerings
  ADD COLUMN IF NOT EXISTS study_plan_id uuid,
  ADD COLUMN IF NOT EXISTS plan_course_id uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'co_status_check') THEN
    ALTER TABLE public.course_offerings
      ADD CONSTRAINT co_status_check CHECK (status IN ('draft','approved','scheduled','cancelled'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ensure_co_plan_links()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE spc uuid; pcc uuid; pcsp uuid;
BEGIN
  IF NEW.study_plan_id IS NOT NULL THEN
    SELECT college_id INTO spc FROM public.study_plans WHERE id = NEW.study_plan_id;
    IF spc IS NULL OR spc <> NEW.college_id THEN
      RAISE EXCEPTION 'study_plan/college mismatch';
    END IF;
  END IF;
  IF NEW.plan_course_id IS NOT NULL THEN
    SELECT college_id, study_plan_id INTO pcc, pcsp FROM public.plan_courses WHERE id = NEW.plan_course_id;
    IF pcc IS NULL OR pcc <> NEW.college_id THEN
      RAISE EXCEPTION 'plan_course/college mismatch';
    END IF;
    IF NEW.study_plan_id IS NOT NULL AND pcsp <> NEW.study_plan_id THEN
      RAISE EXCEPTION 'plan_course does not belong to provided study_plan';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_co_plan_links ON public.course_offerings;
CREATE TRIGGER trg_co_plan_links BEFORE INSERT OR UPDATE ON public.course_offerings
  FOR EACH ROW EXECUTE FUNCTION public.ensure_co_plan_links();

-- =========================================================================
-- 6. academic_terms: academic_year, term_type, teaching_weeks_count
-- =========================================================================
ALTER TABLE public.academic_terms
  ADD COLUMN IF NOT EXISTS academic_year text,
  ADD COLUMN IF NOT EXISTS term_type text,
  ADD COLUMN IF NOT EXISTS teaching_weeks_count integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'at_term_type_check') THEN
    ALTER TABLE public.academic_terms
      ADD CONSTRAINT at_term_type_check CHECK (term_type IS NULL OR term_type IN ('fall','spring','summer'));
  END IF;
END $$;

-- =========================================================================
-- 7. scheduling_settings: allowed_session_durations + daily_breaks table
-- =========================================================================
ALTER TABLE public.scheduling_settings
  ADD COLUMN IF NOT EXISTS allowed_session_durations integer[] NOT NULL DEFAULT ARRAY[1,2,3];

CREATE TABLE IF NOT EXISTS public.daily_breaks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  college_id uuid NOT NULL,
  name text NOT NULL,
  days integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  start_time time NOT NULL,
  end_time time NOT NULL,
  affects_scheduling boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_breaks TO authenticated;
GRANT ALL ON public.daily_breaks TO service_role;
ALTER TABLE public.daily_breaks ENABLE ROW LEVEL SECURITY;

CREATE POLICY db_select ON public.daily_breaks FOR SELECT TO authenticated
  USING (can_view_college(auth.uid(), college_id));
CREATE POLICY db_insert ON public.daily_breaks FOR INSERT TO authenticated
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY db_update ON public.daily_breaks FOR UPDATE TO authenticated
  USING (can_manage_college(auth.uid(), college_id))
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY db_delete ON public.daily_breaks FOR DELETE TO authenticated
  USING (can_manage_college(auth.uid(), college_id));

CREATE INDEX IF NOT EXISTS idx_db_college ON public.daily_breaks(college_id);

DROP TRIGGER IF EXISTS trg_db_updated_at ON public.daily_breaks;
CREATE TRIGGER trg_db_updated_at BEFORE UPDATE ON public.daily_breaks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 8. courses.course_nature CHECK constraint (normalize first)
-- =========================================================================
UPDATE public.courses
  SET course_nature = 'department'
  WHERE course_nature IS NULL
     OR course_nature NOT IN ('department','college','university');

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'courses_course_nature_check') THEN
    ALTER TABLE public.courses
      ADD CONSTRAINT courses_course_nature_check CHECK (course_nature IN ('department','college','university'));
  END IF;
END $$;

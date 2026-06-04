
-- =====================================================================
-- Phase 4: Academic Configuration & Scheduling Foundation
-- =====================================================================

-- ---------- 1. instructor_types -------------------------------------------------
CREATE TABLE public.instructor_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  is_external boolean NOT NULL DEFAULT false,
  description text,
  color text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX instructor_types_college_code_key ON public.instructor_types(college_id, lower(code));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.instructor_types TO authenticated;
GRANT ALL ON public.instructor_types TO service_role;
ALTER TABLE public.instructor_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY it_select ON public.instructor_types FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY it_insert ON public.instructor_types FOR INSERT TO authenticated WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY it_update ON public.instructor_types FOR UPDATE TO authenticated USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY it_delete ON public.instructor_types FOR DELETE TO authenticated USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_it_updated BEFORE UPDATE ON public.instructor_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 2. room_types -------------------------------------------------------
CREATE TABLE public.room_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  default_capacity integer NOT NULL DEFAULT 30,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  color text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX room_types_college_code_key ON public.room_types(college_id, lower(code));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_types TO authenticated;
GRANT ALL ON public.room_types TO service_role;
ALTER TABLE public.room_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY rt_select ON public.room_types FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY rt_insert ON public.room_types FOR INSERT TO authenticated WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY rt_update ON public.room_types FOR UPDATE TO authenticated USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY rt_delete ON public.room_types FOR DELETE TO authenticated USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_rt_updated BEFORE UPDATE ON public.room_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 3. academic_buildings -----------------------------------------------
CREATE TABLE public.academic_buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  address text,
  floors_count integer,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX academic_buildings_college_code_key ON public.academic_buildings(college_id, lower(code));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_buildings TO authenticated;
GRANT ALL ON public.academic_buildings TO service_role;
ALTER TABLE public.academic_buildings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ab_select ON public.academic_buildings FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY ab_insert ON public.academic_buildings FOR INSERT TO authenticated WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ab_update ON public.academic_buildings FOR UPDATE TO authenticated USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ab_delete ON public.academic_buildings FOR DELETE TO authenticated USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_ab_updated BEFORE UPDATE ON public.academic_buildings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 4. session_types ----------------------------------------------------
CREATE TABLE public.session_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  default_duration_hours numeric(3,1) NOT NULL DEFAULT 2,
  color text,
  requires_lab boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX session_types_college_code_key ON public.session_types(college_id, lower(code));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_types TO authenticated;
GRANT ALL ON public.session_types TO service_role;
ALTER TABLE public.session_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY st_select ON public.session_types FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY st_insert ON public.session_types FOR INSERT TO authenticated WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY st_update ON public.session_types FOR UPDATE TO authenticated USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY st_delete ON public.session_types FOR DELETE TO authenticated USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_st_updated BEFORE UPDATE ON public.session_types FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 5. scheduling_settings ---------------------------------------------
CREATE TABLE public.scheduling_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL UNIQUE,
  week_start_day smallint NOT NULL DEFAULT 6,  -- 0=Sun..6=Sat (default Saturday for Arab universities)
  working_days smallint[] NOT NULL DEFAULT ARRAY[6,0,1,2,3,4]::smallint[], -- Sat..Thu
  day_start_time time NOT NULL DEFAULT '08:00',
  day_end_time time NOT NULL DEFAULT '14:00',
  slot_minutes integer NOT NULL DEFAULT 60,
  min_session_hours numeric(3,1) NOT NULL DEFAULT 1,
  max_session_hours numeric(3,1) NOT NULL DEFAULT 3,
  allow_3h_sessions boolean NOT NULL DEFAULT true,
  max_daily_hours_per_instructor integer NOT NULL DEFAULT 6,
  max_daily_hours_per_section integer NOT NULL DEFAULT 6,
  break_between_sessions_min integer NOT NULL DEFAULT 0,
  allow_back_to_back boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduling_settings TO authenticated;
GRANT ALL ON public.scheduling_settings TO service_role;
ALTER TABLE public.scheduling_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ss_select ON public.scheduling_settings FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY ss_insert ON public.scheduling_settings FOR INSERT TO authenticated WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ss_update ON public.scheduling_settings FOR UPDATE TO authenticated USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ss_delete ON public.scheduling_settings FOR DELETE TO authenticated USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_ss_updated BEFORE UPDATE ON public.scheduling_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------- 6. academic_calendar -----------------------------------------------
CREATE TABLE public.academic_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  term_id uuid,
  title text NOT NULL,
  event_kind text NOT NULL DEFAULT 'holiday',   -- holiday | exam | event | break | deadline
  start_date date NOT NULL,
  end_date date,
  start_time time,
  end_time time,
  all_day boolean NOT NULL DEFAULT true,
  affects_scheduling boolean NOT NULL DEFAULT true,
  color text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX academic_calendar_college_idx ON public.academic_calendar(college_id, start_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_calendar TO authenticated;
GRANT ALL ON public.academic_calendar TO service_role;
ALTER TABLE public.academic_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY ac_select ON public.academic_calendar FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY ac_insert ON public.academic_calendar FOR INSERT TO authenticated WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ac_update ON public.academic_calendar FOR UPDATE TO authenticated USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ac_delete ON public.academic_calendar FOR DELETE TO authenticated USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_ac_updated BEFORE UPDATE ON public.academic_calendar FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_ac_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE tc uuid;
BEGIN
  IF NEW.term_id IS NOT NULL THEN
    SELECT college_id INTO tc FROM public.academic_terms WHERE id = NEW.term_id;
    IF tc IS NULL OR tc <> NEW.college_id THEN RAISE EXCEPTION 'term/college mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ac_college BEFORE INSERT OR UPDATE ON public.academic_calendar FOR EACH ROW EXECUTE FUNCTION public.ensure_ac_college();

-- ---------- 7. Shared / common courses across departments ---------------------
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS course_nature text NOT NULL DEFAULT 'department',  -- department | college | university
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;

CREATE TABLE public.course_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  course_id uuid NOT NULL,
  department_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, department_id)
);
CREATE INDEX course_departments_course_idx ON public.course_departments(course_id);
CREATE INDEX course_departments_dept_idx ON public.course_departments(department_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_departments TO authenticated;
GRANT ALL ON public.course_departments TO service_role;
ALTER TABLE public.course_departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY cd_select ON public.course_departments FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY cd_insert ON public.course_departments FOR INSERT TO authenticated WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY cd_update ON public.course_departments FOR UPDATE TO authenticated USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY cd_delete ON public.course_departments FOR DELETE TO authenticated USING (public.can_manage_college(auth.uid(), college_id));

CREATE OR REPLACE FUNCTION public.ensure_cd_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE cc uuid; dc uuid;
BEGIN
  SELECT college_id INTO cc FROM public.courses WHERE id = NEW.course_id;
  SELECT college_id INTO dc FROM public.departments WHERE id = NEW.department_id;
  IF cc IS NULL OR dc IS NULL OR cc <> NEW.college_id OR dc <> NEW.college_id THEN
    RAISE EXCEPTION 'course/department/college mismatch';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cd_college BEFORE INSERT OR UPDATE ON public.course_departments FOR EACH ROW EXECUTE FUNCTION public.ensure_cd_college();

-- ---------- 8. Import template definitions ------------------------------------
CREATE TABLE public.import_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  template_key text NOT NULL,        -- e.g. 'study_plan_full', 'teaching_assignments', 'instructors', 'rooms'
  name_ar text NOT NULL,
  description text,
  version integer NOT NULL DEFAULT 1,
  target_entity text NOT NULL,        -- target table family
  sheet_name text,
  sample_file_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX import_templates_key_ver_key ON public.import_templates(college_id, lower(template_key), version);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_templates TO authenticated;
GRANT ALL ON public.import_templates TO service_role;
ALTER TABLE public.import_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY imt_select ON public.import_templates FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY imt_insert ON public.import_templates FOR INSERT TO authenticated WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY imt_update ON public.import_templates FOR UPDATE TO authenticated USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY imt_delete ON public.import_templates FOR DELETE TO authenticated USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_imt_updated BEFORE UPDATE ON public.import_templates FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.import_template_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  template_id uuid NOT NULL,
  column_order integer NOT NULL DEFAULT 0,
  header_ar text NOT NULL,
  field_key text NOT NULL,
  data_type text NOT NULL DEFAULT 'text', -- text | number | integer | boolean | date | enum | uuid
  is_required boolean NOT NULL DEFAULT false,
  enum_values jsonb,
  example text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_template_columns_tpl_idx ON public.import_template_columns(template_id, column_order);
CREATE UNIQUE INDEX import_template_columns_tpl_field_key ON public.import_template_columns(template_id, lower(field_key));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_template_columns TO authenticated;
GRANT ALL ON public.import_template_columns TO service_role;
ALTER TABLE public.import_template_columns ENABLE ROW LEVEL SECURITY;
CREATE POLICY itc_select ON public.import_template_columns FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY itc_insert ON public.import_template_columns FOR INSERT TO authenticated WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY itc_update ON public.import_template_columns FOR UPDATE TO authenticated USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY itc_delete ON public.import_template_columns FOR DELETE TO authenticated USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_itc_updated BEFORE UPDATE ON public.import_template_columns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_itc_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE tc uuid;
BEGIN
  SELECT college_id INTO tc FROM public.import_templates WHERE id = NEW.template_id;
  IF tc IS NULL OR tc <> NEW.college_id THEN RAISE EXCEPTION 'template/college mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_itc_college BEFORE INSERT OR UPDATE ON public.import_template_columns FOR EACH ROW EXECUTE FUNCTION public.ensure_itc_college();

-- ---------- 9. Linking columns on existing tables (nullable, non-breaking) ----
ALTER TABLE public.instructors
  ADD COLUMN IF NOT EXISTS instructor_type_id uuid,
  ADD COLUMN IF NOT EXISTS external_source text,
  ADD COLUMN IF NOT EXISTS academic_degree text,
  ADD COLUMN IF NOT EXISTS admin_tasks text,
  ADD COLUMN IF NOT EXISTS max_hours_per_day integer;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS building_id uuid,
  ADD COLUMN IF NOT EXISTS room_type_id uuid,
  ADD COLUMN IF NOT EXISTS available_days smallint[],
  ADD COLUMN IF NOT EXISTS available_start_time time,
  ADD COLUMN IF NOT EXISTS available_end_time time;

-- Cross-college guards for the new FK columns
CREATE OR REPLACE FUNCTION public.ensure_instructor_links_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE tc uuid;
BEGIN
  IF NEW.instructor_type_id IS NOT NULL THEN
    SELECT college_id INTO tc FROM public.instructor_types WHERE id = NEW.instructor_type_id;
    IF tc IS NULL OR tc <> NEW.college_id THEN RAISE EXCEPTION 'instructor_type/college mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_instr_type_college BEFORE INSERT OR UPDATE ON public.instructors FOR EACH ROW EXECUTE FUNCTION public.ensure_instructor_links_college();

CREATE OR REPLACE FUNCTION public.ensure_room_links_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE bc uuid; rtc uuid;
BEGIN
  IF NEW.building_id IS NOT NULL THEN
    SELECT college_id INTO bc FROM public.academic_buildings WHERE id = NEW.building_id;
    IF bc IS NULL OR bc <> NEW.college_id THEN RAISE EXCEPTION 'building/college mismatch'; END IF;
  END IF;
  IF NEW.room_type_id IS NOT NULL THEN
    SELECT college_id INTO rtc FROM public.room_types WHERE id = NEW.room_type_id;
    IF rtc IS NULL OR rtc <> NEW.college_id THEN RAISE EXCEPTION 'room_type/college mismatch'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_room_links_college BEFORE INSERT OR UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.ensure_room_links_college();

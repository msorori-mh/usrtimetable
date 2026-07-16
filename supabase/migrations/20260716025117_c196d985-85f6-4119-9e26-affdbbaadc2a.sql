-- PHASE-9.1-ACADEMIC-DELIVERY-MODEL-V2-SCHEMA-CORE
-- Additive schema only. No data mutation. No drops.

BEGIN;

-- 1) academic_cohorts
CREATE TABLE public.academic_cohorts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id UUID NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  program_id UUID NOT NULL REFERENCES public.academic_programs(id) ON DELETE RESTRICT,
  level_id UUID NOT NULL REFERENCES public.academic_levels(id) ON DELETE RESTRICT,
  study_system TEXT NOT NULL,
  entry_year INTEGER NOT NULL,
  term_id UUID NOT NULL REFERENCES public.academic_terms(id) ON DELETE RESTRICT,
  expected_students INTEGER NOT NULL DEFAULT 0,
  count_status TEXT NOT NULL DEFAULT 'estimated',
  code TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ac_study_system_chk CHECK (study_system IN ('regular','parallel','evening','distance','other')),
  CONSTRAINT ac_count_status_chk CHECK (count_status IN ('estimated','confirmed','locked')),
  CONSTRAINT ac_unique UNIQUE (program_id, level_id, study_system, entry_year, term_id)
);
CREATE INDEX idx_ac_college ON public.academic_cohorts(college_id);
CREATE INDEX idx_ac_term ON public.academic_cohorts(term_id);
CREATE INDEX idx_ac_program_level ON public.academic_cohorts(program_id, level_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_cohorts TO authenticated;
GRANT ALL ON public.academic_cohorts TO service_role;
ALTER TABLE public.academic_cohorts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ac_select ON public.academic_cohorts FOR SELECT USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY ac_insert ON public.academic_cohorts FOR INSERT WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ac_update ON public.academic_cohorts FOR UPDATE USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ac_delete ON public.academic_cohorts FOR DELETE USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_ac_updated_at BEFORE UPDATE ON public.academic_cohorts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) plan_course_components
CREATE TABLE public.plan_course_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id UUID NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  plan_course_id UUID NOT NULL REFERENCES public.plan_courses(id) ON DELETE RESTRICT,
  component_type TEXT NOT NULL,
  weekly_contact_hours NUMERIC(5,2) NOT NULL DEFAULT 0,
  required_room_type_id UUID REFERENCES public.room_types(id) ON DELETE RESTRICT,
  is_timetabled BOOLEAN NOT NULL DEFAULT TRUE,
  counts_toward_regular_load BOOLEAN NOT NULL DEFAULT TRUE,
  counts_toward_overtime BOOLEAN NOT NULL DEFAULT TRUE,
  compensation_mode TEXT NOT NULL DEFAULT 'per_hour',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pcc_component_type_chk CHECK (component_type IN ('theory','practical','tutorial','project','summer_training')),
  CONSTRAINT pcc_compensation_mode_chk CHECK (compensation_mode IN ('per_hour','per_group_flat','none')),
  CONSTRAINT pcc_unique UNIQUE (plan_course_id, component_type)
);
CREATE INDEX idx_pcc_college ON public.plan_course_components(college_id);
CREATE INDEX idx_pcc_plan_course ON public.plan_course_components(plan_course_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_course_components TO authenticated;
GRANT ALL ON public.plan_course_components TO service_role;
ALTER TABLE public.plan_course_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY pcc_select ON public.plan_course_components FOR SELECT USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY pcc_insert ON public.plan_course_components FOR INSERT WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY pcc_update ON public.plan_course_components FOR UPDATE USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY pcc_delete ON public.plan_course_components FOR DELETE USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_pcc_updated_at BEFORE UPDATE ON public.plan_course_components
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3a) elective_slots
CREATE TABLE public.elective_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id UUID NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  study_plan_id UUID NOT NULL REFERENCES public.study_plans(id) ON DELETE RESTRICT,
  level_id UUID REFERENCES public.academic_levels(id) ON DELETE RESTRICT,
  semester INTEGER NOT NULL,
  slot_code TEXT NOT NULL,
  label TEXT,
  required_component_type TEXT NOT NULL DEFAULT 'theory',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT es_required_component_chk CHECK (required_component_type IN ('theory','practical','tutorial','project','summer_training')),
  CONSTRAINT es_unique UNIQUE (study_plan_id, semester, slot_code)
);
CREATE INDEX idx_es_college ON public.elective_slots(college_id);
CREATE INDEX idx_es_plan ON public.elective_slots(study_plan_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.elective_slots TO authenticated;
GRANT ALL ON public.elective_slots TO service_role;
ALTER TABLE public.elective_slots ENABLE ROW LEVEL SECURITY;
CREATE POLICY es_select ON public.elective_slots FOR SELECT USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY es_insert ON public.elective_slots FOR INSERT WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY es_update ON public.elective_slots FOR UPDATE USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY es_delete ON public.elective_slots FOR DELETE USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_es_updated_at BEFORE UPDATE ON public.elective_slots
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3b) elective_slot_courses
CREATE TABLE public.elective_slot_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id UUID NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  elective_slot_id UUID NOT NULL REFERENCES public.elective_slots(id) ON DELETE RESTRICT,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT esc_unique UNIQUE (elective_slot_id, course_id)
);
CREATE INDEX idx_esc_college ON public.elective_slot_courses(college_id);
CREATE INDEX idx_esc_slot ON public.elective_slot_courses(elective_slot_id);
CREATE INDEX idx_esc_course ON public.elective_slot_courses(course_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.elective_slot_courses TO authenticated;
GRANT ALL ON public.elective_slot_courses TO service_role;
ALTER TABLE public.elective_slot_courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY esc_select ON public.elective_slot_courses FOR SELECT USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY esc_insert ON public.elective_slot_courses FOR INSERT WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY esc_update ON public.elective_slot_courses FOR UPDATE USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY esc_delete ON public.elective_slot_courses FOR DELETE USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_esc_updated_at BEFORE UPDATE ON public.elective_slot_courses
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3c) cohort_elective_selections
CREATE TABLE public.cohort_elective_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id UUID NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  cohort_id UUID NOT NULL REFERENCES public.academic_cohorts(id) ON DELETE RESTRICT,
  elective_slot_id UUID NOT NULL REFERENCES public.elective_slots(id) ON DELETE RESTRICT,
  selected_course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE RESTRICT,
  decided_at TIMESTAMPTZ,
  decided_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ces_unique UNIQUE (cohort_id, elective_slot_id)
);
CREATE INDEX idx_ces_college ON public.cohort_elective_selections(college_id);
CREATE INDEX idx_ces_cohort ON public.cohort_elective_selections(cohort_id);
CREATE INDEX idx_ces_slot ON public.cohort_elective_selections(elective_slot_id);
CREATE INDEX idx_ces_course ON public.cohort_elective_selections(selected_course_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cohort_elective_selections TO authenticated;
GRANT ALL ON public.cohort_elective_selections TO service_role;
ALTER TABLE public.cohort_elective_selections ENABLE ROW LEVEL SECURITY;
CREATE POLICY ces_select ON public.cohort_elective_selections FOR SELECT USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY ces_insert ON public.cohort_elective_selections FOR INSERT WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ces_update ON public.cohort_elective_selections FOR UPDATE USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ces_delete ON public.cohort_elective_selections FOR DELETE USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_ces_updated_at BEFORE UPDATE ON public.cohort_elective_selections
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) delivery_groups
CREATE TABLE public.delivery_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id UUID NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  cohort_id UUID NOT NULL REFERENCES public.academic_cohorts(id) ON DELETE RESTRICT,
  plan_course_id UUID NOT NULL REFERENCES public.plan_courses(id) ON DELETE RESTRICT,
  component_id UUID NOT NULL REFERENCES public.plan_course_components(id) ON DELETE RESTRICT,
  group_code TEXT NOT NULL,
  expected_students INTEGER NOT NULL DEFAULT 0,
  capacity_limit INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dg_unique UNIQUE (component_id, cohort_id, group_code)
);
CREATE INDEX idx_dg_college ON public.delivery_groups(college_id);
CREATE INDEX idx_dg_cohort ON public.delivery_groups(cohort_id);
CREATE INDEX idx_dg_plan_course ON public.delivery_groups(plan_course_id);
CREATE INDEX idx_dg_component ON public.delivery_groups(component_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_groups TO authenticated;
GRANT ALL ON public.delivery_groups TO service_role;
ALTER TABLE public.delivery_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY dg_select ON public.delivery_groups FOR SELECT USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY dg_insert ON public.delivery_groups FOR INSERT WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY dg_update ON public.delivery_groups FOR UPDATE USING (public.can_manage_college(auth.uid(), college_id)) WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY dg_delete ON public.delivery_groups FOR DELETE USING (public.can_manage_college(auth.uid(), college_id));
CREATE TRIGGER trg_dg_updated_at BEFORE UPDATE ON public.delivery_groups
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) teaching_assignments — additive nullable columns (keep course_offering_id)
ALTER TABLE public.teaching_assignments
  ADD COLUMN cohort_id UUID,
  ADD COLUMN plan_course_component_id UUID,
  ADD COLUMN delivery_group_id UUID,
  ADD CONSTRAINT teaching_assignments_cohort_id_fkey
    FOREIGN KEY (cohort_id) REFERENCES public.academic_cohorts(id) ON DELETE RESTRICT,
  ADD CONSTRAINT teaching_assignments_plan_course_component_id_fkey
    FOREIGN KEY (plan_course_component_id) REFERENCES public.plan_course_components(id) ON DELETE RESTRICT,
  ADD CONSTRAINT teaching_assignments_delivery_group_id_fkey
    FOREIGN KEY (delivery_group_id) REFERENCES public.delivery_groups(id) ON DELETE RESTRICT;
CREATE INDEX idx_ta_cohort ON public.teaching_assignments(cohort_id);
CREATE INDEX idx_ta_component ON public.teaching_assignments(plan_course_component_id);
CREATE INDEX idx_ta_delivery_group ON public.teaching_assignments(delivery_group_id);

-- 6) schedule_sessions — additive nullable columns (keep course_offering_id + section_subgroup_id)
ALTER TABLE public.schedule_sessions
  ADD COLUMN cohort_id UUID,
  ADD COLUMN plan_course_component_id UUID,
  ADD COLUMN delivery_group_id UUID,
  ADD CONSTRAINT schedule_sessions_cohort_id_fkey
    FOREIGN KEY (cohort_id) REFERENCES public.academic_cohorts(id) ON DELETE RESTRICT,
  ADD CONSTRAINT schedule_sessions_plan_course_component_id_fkey
    FOREIGN KEY (plan_course_component_id) REFERENCES public.plan_course_components(id) ON DELETE RESTRICT,
  ADD CONSTRAINT schedule_sessions_delivery_group_id_fkey
    FOREIGN KEY (delivery_group_id) REFERENCES public.delivery_groups(id) ON DELETE RESTRICT;
CREATE INDEX idx_ss_cohort ON public.schedule_sessions(cohort_id);
CREATE INDEX idx_ss_component ON public.schedule_sessions(plan_course_component_id);
CREATE INDEX idx_ss_delivery_group ON public.schedule_sessions(delivery_group_id);

-- 7) room_types.strict_capacity
ALTER TABLE public.room_types
  ADD COLUMN strict_capacity BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
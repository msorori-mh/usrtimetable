
-- =========================================================
-- Phase 6A: Hard Conflict Validation Engine
-- =========================================================

-- 1) schedule_versions
CREATE TABLE public.schedule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  academic_term_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','published','archived')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_versions TO authenticated;
GRANT ALL ON public.schedule_versions TO service_role;
ALTER TABLE public.schedule_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sv_select ON public.schedule_versions FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY sv_insert ON public.schedule_versions FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY sv_update ON public.schedule_versions FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY sv_delete ON public.schedule_versions FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE INDEX idx_sv_college_term ON public.schedule_versions(college_id, academic_term_id);

CREATE TRIGGER trg_sv_updated BEFORE UPDATE ON public.schedule_versions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_sv_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE tc uuid;
BEGIN
  SELECT college_id INTO tc FROM public.academic_terms WHERE id = NEW.academic_term_id;
  IF tc IS NULL OR tc <> NEW.college_id THEN RAISE EXCEPTION 'term/college mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_sv_college BEFORE INSERT OR UPDATE ON public.schedule_versions
  FOR EACH ROW EXECUTE FUNCTION public.ensure_sv_college();

-- 2) schedule_sessions
CREATE TABLE public.schedule_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  course_offering_id uuid NOT NULL,
  teaching_assignment_id uuid,
  instructor_id uuid NOT NULL,
  room_id uuid,
  section_id uuid,
  section_group_id uuid,
  study_system text NOT NULL DEFAULT 'regular' CHECK (study_system IN ('regular','parallel','both')),
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL CHECK (end_time > start_time),
  session_type text NOT NULL DEFAULT 'lecture',
  expected_students integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_sessions TO authenticated;
GRANT ALL ON public.schedule_sessions TO service_role;
ALTER TABLE public.schedule_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ss_select ON public.schedule_sessions FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY ss_insert ON public.schedule_sessions FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ss_update ON public.schedule_sessions FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY ss_delete ON public.schedule_sessions FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE INDEX idx_ss_version_day_time ON public.schedule_sessions(schedule_version_id, day_of_week, start_time, end_time);
CREATE INDEX idx_ss_instructor_day ON public.schedule_sessions(schedule_version_id, instructor_id, day_of_week);
CREATE INDEX idx_ss_room_day ON public.schedule_sessions(schedule_version_id, room_id, day_of_week);
CREATE INDEX idx_ss_section_day ON public.schedule_sessions(schedule_version_id, section_id, day_of_week);

CREATE TRIGGER trg_ss_updated BEFORE UPDATE ON public.schedule_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.ensure_ss_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE vc uuid; oc uuid; ic uuid; rc uuid; sc uuid; gc uuid; tac uuid;
BEGIN
  SELECT college_id INTO vc FROM public.schedule_versions WHERE id = NEW.schedule_version_id;
  IF vc IS NULL OR vc <> NEW.college_id THEN RAISE EXCEPTION 'version/college mismatch'; END IF;

  SELECT college_id INTO oc FROM public.course_offerings WHERE id = NEW.course_offering_id;
  IF oc IS NULL OR oc <> NEW.college_id THEN RAISE EXCEPTION 'offering/college mismatch'; END IF;

  SELECT college_id INTO ic FROM public.instructors WHERE id = NEW.instructor_id;
  IF ic IS NULL OR ic <> NEW.college_id THEN RAISE EXCEPTION 'instructor/college mismatch'; END IF;

  IF NEW.room_id IS NOT NULL THEN
    SELECT college_id INTO rc FROM public.rooms WHERE id = NEW.room_id;
    IF rc IS NULL OR rc <> NEW.college_id THEN RAISE EXCEPTION 'room/college mismatch'; END IF;
  END IF;

  IF NEW.section_id IS NOT NULL THEN
    SELECT college_id INTO sc FROM public.sections WHERE id = NEW.section_id;
    IF sc IS NULL OR sc <> NEW.college_id THEN RAISE EXCEPTION 'section/college mismatch'; END IF;
  END IF;

  IF NEW.section_group_id IS NOT NULL THEN
    SELECT college_id INTO gc FROM public.section_groups WHERE id = NEW.section_group_id;
    IF gc IS NULL OR gc <> NEW.college_id THEN RAISE EXCEPTION 'section_group/college mismatch'; END IF;
  END IF;

  IF NEW.teaching_assignment_id IS NOT NULL THEN
    SELECT college_id INTO tac FROM public.teaching_assignments WHERE id = NEW.teaching_assignment_id;
    IF tac IS NULL OR tac <> NEW.college_id THEN RAISE EXCEPTION 'teaching_assignment/college mismatch'; END IF;
  END IF;

  RETURN NEW;
END $$;
CREATE TRIGGER trg_ss_college BEFORE INSERT OR UPDATE ON public.schedule_sessions
  FOR EACH ROW EXECUTE FUNCTION public.ensure_ss_college();

-- 3) conflict_checks
CREATE TABLE public.conflict_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  check_type text NOT NULL DEFAULT 'hard' CHECK (check_type IN ('hard','soft','full','dry_run')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
  total_conflicts integer NOT NULL DEFAULT 0,
  checked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conflict_checks TO authenticated;
GRANT ALL ON public.conflict_checks TO service_role;
ALTER TABLE public.conflict_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY cc_select ON public.conflict_checks FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY cc_insert ON public.conflict_checks FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY cc_update ON public.conflict_checks FOR UPDATE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY cc_delete ON public.conflict_checks FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE INDEX idx_cc_version ON public.conflict_checks(schedule_version_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.ensure_cc_check_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE vc uuid;
BEGIN
  SELECT college_id INTO vc FROM public.schedule_versions WHERE id = NEW.schedule_version_id;
  IF vc IS NULL OR vc <> NEW.college_id THEN RAISE EXCEPTION 'version/college mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cc_college BEFORE INSERT OR UPDATE ON public.conflict_checks
  FOR EACH ROW EXECUTE FUNCTION public.ensure_cc_check_college();

-- 4) conflict_results
CREATE TABLE public.conflict_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  conflict_check_id uuid NOT NULL REFERENCES public.conflict_checks(id) ON DELETE CASCADE,
  schedule_session_id uuid,
  related_session_id uuid,
  conflict_type_id uuid REFERENCES public.constraint_types(id) ON DELETE SET NULL,
  conflict_code text NOT NULL,
  severity text NOT NULL DEFAULT 'hard' CHECK (severity IN ('hard','soft','info')),
  message_ar text NOT NULL,
  message_en text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conflict_results TO authenticated;
GRANT ALL ON public.conflict_results TO service_role;
ALTER TABLE public.conflict_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY cr_select ON public.conflict_results FOR SELECT TO authenticated
  USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY cr_insert ON public.conflict_results FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY cr_delete ON public.conflict_results FOR DELETE TO authenticated
  USING (public.can_manage_college(auth.uid(), college_id));

CREATE INDEX idx_cr_check ON public.conflict_results(conflict_check_id);
CREATE INDEX idx_cr_session ON public.conflict_results(schedule_session_id);

CREATE OR REPLACE FUNCTION public.ensure_cr_college()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE chc uuid;
BEGIN
  SELECT college_id INTO chc FROM public.conflict_checks WHERE id = NEW.conflict_check_id;
  IF chc IS NULL OR chc <> NEW.college_id THEN RAISE EXCEPTION 'check/college mismatch'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cr_college BEFORE INSERT OR UPDATE ON public.conflict_results
  FOR EACH ROW EXECUTE FUNCTION public.ensure_cr_college();

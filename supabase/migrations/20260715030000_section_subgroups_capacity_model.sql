-- PHASE-6: within-section capacity subgroups (SCHEMA ONLY — do not apply to production in this phase)
-- section_groups remains multi-section aggregation; do NOT reuse it for student capacity splits.

-- 1) section_subgroups
CREATE TABLE IF NOT EXISTS public.section_subgroups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  section_id uuid NOT NULL,
  course_id uuid NOT NULL,
  academic_term_id uuid NOT NULL,
  teaching_assignment_id uuid NULL,
  subgroup_code text NOT NULL,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 4),
  expected_students integer NOT NULL DEFAULT 0 CHECK (expected_students >= 0),
  study_system text NOT NULL DEFAULT 'regular',
  is_active boolean NOT NULL DEFAULT true,
  source_policy text NOT NULL,
  owner_approval_ref text NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_id, subgroup_code),
  UNIQUE (section_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_section_subgroups_section
  ON public.section_subgroups (section_id);
CREATE INDEX IF NOT EXISTS idx_section_subgroups_college_term
  ON public.section_subgroups (college_id, academic_term_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.section_subgroups TO authenticated;
GRANT ALL ON public.section_subgroups TO service_role;
ALTER TABLE public.section_subgroups ENABLE ROW LEVEL SECURITY;

CREATE POLICY section_subgroups_select ON public.section_subgroups
  FOR SELECT TO authenticated
  USING (can_view_college(auth.uid(), college_id));
CREATE POLICY section_subgroups_insert ON public.section_subgroups
  FOR INSERT TO authenticated
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY section_subgroups_update ON public.section_subgroups
  FOR UPDATE TO authenticated
  USING (can_manage_college(auth.uid(), college_id))
  WITH CHECK (can_manage_college(auth.uid(), college_id));
CREATE POLICY section_subgroups_delete ON public.section_subgroups
  FOR DELETE TO authenticated
  USING (can_manage_college(auth.uid(), college_id));

CREATE OR REPLACE FUNCTION public.ensure_section_subgroup_college()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  sc uuid;
  cc uuid;
  tc uuid;
BEGIN
  SELECT college_id INTO sc FROM public.sections WHERE id = NEW.section_id;
  SELECT college_id INTO cc FROM public.courses WHERE id = NEW.course_id;
  SELECT college_id INTO tc FROM public.academic_terms WHERE id = NEW.academic_term_id;
  IF sc IS NULL OR cc IS NULL OR tc IS NULL
     OR sc <> NEW.college_id OR cc <> NEW.college_id OR tc <> NEW.college_id THEN
    RAISE EXCEPTION 'section_subgroups college/section/course/term mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_section_subgroups_college ON public.section_subgroups;
CREATE TRIGGER trg_section_subgroups_college
  BEFORE INSERT OR UPDATE ON public.section_subgroups
  FOR EACH ROW EXECUTE FUNCTION public.ensure_section_subgroup_college();

DROP TRIGGER IF EXISTS trg_section_subgroups_updated_at ON public.section_subgroups;
CREATE TRIGGER trg_section_subgroups_updated_at
  BEFORE UPDATE ON public.section_subgroups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) schedule_sessions linkage + retire flag
ALTER TABLE public.schedule_sessions
  ADD COLUMN IF NOT EXISTS section_subgroup_id uuid NULL,
  ADD COLUMN IF NOT EXISTS replaced_by_split boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS split_source_session_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_ss_section_subgroup
  ON public.schedule_sessions (section_subgroup_id)
  WHERE section_subgroup_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ss_replaced_by_split
  ON public.schedule_sessions (schedule_version_id)
  WHERE replaced_by_split = true;
CREATE INDEX IF NOT EXISTS idx_ss_split_source
  ON public.schedule_sessions (split_source_session_id)
  WHERE split_source_session_id IS NOT NULL;

-- Extend source_type for subgroup children
ALTER TABLE public.schedule_sessions
  DROP CONSTRAINT IF EXISTS schedule_sessions_source_type_chk;
ALTER TABLE public.schedule_sessions
  ADD CONSTRAINT schedule_sessions_source_type_chk
  CHECK (source_type IN ('manual', 'auto_generated', 'cloned', 'capacity_subgroup_child'));

COMMENT ON TABLE public.section_subgroups IS
  'Within-section capacity subgroups (A/B/C/D). Distinct from section_groups (multi-section join).';
COMMENT ON COLUMN public.schedule_sessions.replaced_by_split IS
  'True when this session was superseded by capacity-subgroup child sessions; exclude from active scheduling/conflicts.';
COMMENT ON COLUMN public.schedule_sessions.section_subgroup_id IS
  'Optional FK-style link to section_subgroups for child sessions.';

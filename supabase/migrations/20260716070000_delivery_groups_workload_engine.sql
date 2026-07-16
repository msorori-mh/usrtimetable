-- PHASE-9.3: Delivery Groups generator + standard workload engine
-- SOURCE ONLY — CREATED / NOT APPLIED. Do not auto-apply.
-- Additive schema + RPCs only. No backfill. No generator invocation. No data seed.
-- Auth: SECURITY DEFINER with auth.uid + can_manage_college (college from cohort row).
--
-- Remediation-01 notes:
-- A) Workload view uses security_invoker=true so underlying RLS (can_view_college) applies.
--    PUBLIC/anon revoked. App path remains college-gated RPC.
-- B) V2 assigned_component_hours (nullable) is the explicit co-teaching hour source;
--    legacy weekly_hours DEFAULT 3 is ignored by V2 workload math.
-- C) Offering↔ delivery_group plan_course integrity enforced on V2 writes.
-- D) Generator pre-validates all components; validation errors abort before any DML (atomic).
-- E) is_obsolete marks surplus groups; blocks new assignments/sessions; never deletes.
-- F) Components keyed by cohort+plan_course+component; one deterministic offering per component.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Schema readiness: delivery_groups identity + workload + obsolete flag
-- ---------------------------------------------------------------------------
ALTER TABLE public.delivery_groups
  ADD COLUMN IF NOT EXISTS group_number INTEGER,
  ADD COLUMN IF NOT EXISTS excluded_from_standard_workload BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_obsolete BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.delivery_groups.group_number IS
  'Stable 1-based group index per (cohort, component). Never renumbered by generator.';
COMMENT ON COLUMN public.delivery_groups.excluded_from_standard_workload IS
  'True for project (and similar) groups excluded from standard weekly load.';
COMMENT ON COLUMN public.delivery_groups.is_obsolete IS
  'True when group_number exceeds required count after reconciliation. Not deleted. Blocks new V2 assignments/sessions.';

ALTER TABLE public.delivery_groups
  DROP CONSTRAINT IF EXISTS dg_group_number_positive_chk;
ALTER TABLE public.delivery_groups
  ADD CONSTRAINT dg_group_number_positive_chk
  CHECK (group_number IS NULL OR group_number >= 1);

-- Unique identity: cohort + component + group_number (component implies plan_course + type)
CREATE UNIQUE INDEX IF NOT EXISTS dg_cohort_component_group_number_uniq
  ON public.delivery_groups (cohort_id, component_id, group_number)
  WHERE group_number IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Explicit group size on components (tutorial/project); never invent in SQL
-- ---------------------------------------------------------------------------
ALTER TABLE public.plan_course_components
  ADD COLUMN IF NOT EXISTS explicit_group_size INTEGER;

ALTER TABLE public.plan_course_components
  DROP CONSTRAINT IF EXISTS pcc_explicit_group_size_chk;
ALTER TABLE public.plan_course_components
  ADD CONSTRAINT pcc_explicit_group_size_chk
  CHECK (explicit_group_size IS NULL OR explicit_group_size > 0);

COMMENT ON COLUMN public.plan_course_components.explicit_group_size IS
  'Optional explicit group size for tutorial/project. Generator must not invent capacity.';

-- ---------------------------------------------------------------------------
-- 2b) V2 explicit assignment hours (nullable) — do not use legacy weekly_hours DEFAULT 3
-- ---------------------------------------------------------------------------
ALTER TABLE public.teaching_assignments
  ADD COLUMN IF NOT EXISTS assigned_component_hours NUMERIC(5,2);

ALTER TABLE public.teaching_assignments
  DROP CONSTRAINT IF EXISTS ta_assigned_component_hours_chk;
ALTER TABLE public.teaching_assignments
  ADD CONSTRAINT ta_assigned_component_hours_chk
  CHECK (assigned_component_hours IS NULL OR assigned_component_hours >= 0);

COMMENT ON COLUMN public.teaching_assignments.assigned_component_hours IS
  'V2 explicit hours for this instructor on the delivery group. NULL = unspecified. Legacy weekly_hours DEFAULT 3 must not drive V2 workload.';

-- ---------------------------------------------------------------------------
-- 3) Extensible faculty workload policy (locale-neutral rank_code + aliases)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.faculty_workload_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id UUID NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  rank_code TEXT NOT NULL,
  rank_aliases TEXT[] NOT NULL DEFAULT '{}'::text[],
  required_load_hours NUMERIC(5,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fwp_rank_code_chk CHECK (rank_code ~ '^[a-z][a-z0-9_]*$'),
  CONSTRAINT fwp_required_load_chk CHECK (required_load_hours > 0),
  CONSTRAINT fwp_unique UNIQUE (college_id, rank_code)
);

CREATE INDEX IF NOT EXISTS idx_fwp_college ON public.faculty_workload_policies(college_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.faculty_workload_policies TO authenticated;
GRANT ALL ON public.faculty_workload_policies TO service_role;

ALTER TABLE public.faculty_workload_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fwp_select ON public.faculty_workload_policies;
CREATE POLICY fwp_select ON public.faculty_workload_policies
  FOR SELECT USING (public.can_view_college(auth.uid(), college_id));
DROP POLICY IF EXISTS fwp_insert ON public.faculty_workload_policies;
CREATE POLICY fwp_insert ON public.faculty_workload_policies
  FOR INSERT WITH CHECK (public.can_manage_college(auth.uid(), college_id));
DROP POLICY IF EXISTS fwp_update ON public.faculty_workload_policies;
CREATE POLICY fwp_update ON public.faculty_workload_policies
  FOR UPDATE USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
DROP POLICY IF EXISTS fwp_delete ON public.faculty_workload_policies;
CREATE POLICY fwp_delete ON public.faculty_workload_policies
  FOR DELETE USING (public.can_manage_college(auth.uid(), college_id));

DROP TRIGGER IF EXISTS trg_fwp_updated_at ON public.faculty_workload_policies;
CREATE TRIGGER trg_fwp_updated_at BEFORE UPDATE ON public.faculty_workload_policies
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.faculty_workload_policies IS
  'College-scoped required teaching load by rank_code. No Arabic-only hardcoding; use rank_aliases for match.';

-- Suggested reference codes (documentation only — no seed/backfill):
-- assistant_professor → 12h, associate_professor → 9h, associate_dean → 6h

-- ---------------------------------------------------------------------------
-- 4) Teaching assignment V2 integrity helper (extends existing trg_ta_college)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_ta_college()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  oc uuid;
  ic uuid;
  dg_college uuid;
  dg_cohort uuid;
  dg_component uuid;
  dg_plan_course uuid;
  dg_obsolete boolean;
  co_plan_course uuid;
  co_term uuid;
  co_program uuid;
  co_level uuid;
  co_study_system text;
  co_college uuid;
  pcc_type text;
  pcc_plan_course uuid;
  pcc_hours numeric;
  pcc_college uuid;
  v_co_count integer;
  v_null_split_count integer;
  v_sum_assigned numeric;
  v_cohort_term uuid;
  v_cohort_program uuid;
  v_cohort_level uuid;
  v_cohort_study text;
  v_cohort_college uuid;
BEGIN
  SELECT college_id, plan_course_id, term_id, program_id, level_id, study_system
    INTO oc, co_plan_course, co_term, co_program, co_level, co_study_system
  FROM public.course_offerings WHERE id = NEW.course_offering_id;
  co_college := oc;

  SELECT college_id INTO ic FROM public.instructors WHERE id = NEW.instructor_id;
  IF oc IS NULL OR ic IS NULL OR oc <> NEW.college_id OR ic <> NEW.college_id THEN
    RAISE EXCEPTION 'offering/instructor/college mismatch' USING ERRCODE = 'check_violation';
  END IF;

  -- V2 optional links: when present, must align cohort/component/group/college
  IF NEW.delivery_group_id IS NOT NULL THEN
    SELECT dg.college_id, dg.cohort_id, dg.component_id, dg.plan_course_id, dg.is_obsolete
      INTO dg_college, dg_cohort, dg_component, dg_plan_course, dg_obsolete
    FROM public.delivery_groups dg
    WHERE dg.id = NEW.delivery_group_id;

    IF dg_college IS NULL THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF dg_college <> NEW.college_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(dg_obsolete, false) THEN
      RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.cohort_id IS NOT NULL AND NEW.cohort_id IS DISTINCT FROM dg_cohort THEN
      RAISE EXCEPTION 'ASSIGNMENT_COHORT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.plan_course_component_id IS NOT NULL
       AND NEW.plan_course_component_id IS DISTINCT FROM dg_component THEN
      RAISE EXCEPTION 'ASSIGNMENT_COMPONENT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    -- Default cohort/component from delivery group when omitted
    IF NEW.cohort_id IS NULL THEN
      NEW.cohort_id := dg_cohort;
    END IF;
    IF NEW.plan_course_component_id IS NULL THEN
      NEW.plan_course_component_id := dg_component;
    END IF;

    -- Offering ↔ delivery group plan_course / cohort context integrity (V2 only)
    IF co_plan_course IS NULL OR co_plan_course IS DISTINCT FROM dg_plan_course THEN
      RAISE EXCEPTION 'OFFERING_PLAN_COURSE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;

    SELECT ac.college_id, ac.term_id, ac.program_id, ac.level_id, ac.study_system
      INTO v_cohort_college, v_cohort_term, v_cohort_program, v_cohort_level, v_cohort_study
    FROM public.academic_cohorts ac
    WHERE ac.id = dg_cohort;

    IF v_cohort_college IS NULL OR v_cohort_college <> NEW.college_id THEN
      RAISE EXCEPTION 'ASSIGNMENT_COHORT_COLLEGE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF co_college <> v_cohort_college
       OR co_term IS DISTINCT FROM v_cohort_term
       OR COALESCE(co_program, v_cohort_program) IS DISTINCT FROM v_cohort_program
       OR COALESCE(co_level, v_cohort_level) IS DISTINCT FROM v_cohort_level
       OR co_study_system IS DISTINCT FROM v_cohort_study THEN
      RAISE EXCEPTION 'OFFERING_COHORT_CONTEXT_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.plan_course_component_id IS NOT NULL THEN
    SELECT pcc.component_type, pcc.plan_course_id, pcc.weekly_contact_hours, pcc.college_id
      INTO pcc_type, pcc_plan_course, pcc_hours, pcc_college
    FROM public.plan_course_components pcc
    WHERE pcc.id = NEW.plan_course_component_id
      AND pcc.college_id = NEW.college_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ASSIGNMENT_COMPONENT_COLLEGE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
    IF pcc_type = 'summer_training' THEN
      RAISE EXCEPTION 'SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.delivery_group_id IS NOT NULL THEN
      IF pcc_plan_course IS DISTINCT FROM dg_plan_course THEN
        RAISE EXCEPTION 'COMPONENT_PLAN_COURSE_MISMATCH' USING ERRCODE = 'check_violation';
      END IF;

      -- Co-teaching hour contract (V2): never trust legacy weekly_hours DEFAULT 3
      IF NEW.assigned_component_hours IS NOT NULL
         AND pcc_hours IS NOT NULL
         AND NEW.assigned_component_hours > pcc_hours THEN
        RAISE EXCEPTION 'CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
      END IF;

      SELECT COUNT(*)::integer,
             COUNT(*) FILTER (WHERE ta.assigned_component_hours IS NULL
                               AND ta.id IS DISTINCT FROM NEW.id)::integer
               + CASE WHEN NEW.assigned_component_hours IS NULL THEN 1 ELSE 0 END,
             COALESCE(SUM(ta.assigned_component_hours) FILTER (WHERE ta.id IS DISTINCT FROM NEW.id), 0)
               + COALESCE(NEW.assigned_component_hours, 0)
        INTO v_co_count, v_null_split_count, v_sum_assigned
      FROM public.teaching_assignments ta
      WHERE ta.delivery_group_id = NEW.delivery_group_id;

      -- Include NEW in co-count when inserting (UPDATE row already in set)
      IF TG_OP = 'INSERT' THEN
        v_co_count := v_co_count + 1;
      ELSIF TG_OP = 'UPDATE' AND OLD.delivery_group_id IS DISTINCT FROM NEW.delivery_group_id THEN
        v_co_count := v_co_count + 1;
      END IF;

      IF v_co_count > 1 AND v_null_split_count > 0 THEN
        RAISE EXCEPTION 'CO_TEACHING_HOURS_SPLIT_REQUIRED' USING ERRCODE = 'check_violation';
      END IF;

      IF pcc_hours IS NOT NULL AND v_sum_assigned > pcc_hours THEN
        RAISE EXCEPTION 'CO_TEACHING_HOURS_OVER_ALLOCATED' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  IF NEW.cohort_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.academic_cohorts ac
      WHERE ac.id = NEW.cohort_id AND ac.college_id = NEW.college_id
    ) THEN
      RAISE EXCEPTION 'ASSIGNMENT_COHORT_COLLEGE_MISMATCH' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Helpful uniqueness for V2 delivery-group assignments (nullable-safe; legacy rows untouched)
CREATE UNIQUE INDEX IF NOT EXISTS ta_v2_delivery_group_instructor_uniq
  ON public.teaching_assignments (college_id, delivery_group_id, instructor_id)
  WHERE delivery_group_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4b) Schedule sessions: block new links to obsolete delivery groups (V2 only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_ss_college()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  vc uuid;
  oc uuid;
  ic uuid;
  rc uuid;
  sc uuid;
  gc uuid;
  tac uuid;
  dg_college uuid;
  dg_obsolete boolean;
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

  -- V2: new/updated session may not target an obsolete delivery group
  IF NEW.delivery_group_id IS NOT NULL THEN
    SELECT dg.college_id, dg.is_obsolete
      INTO dg_college, dg_obsolete
    FROM public.delivery_groups dg
    WHERE dg.id = NEW.delivery_group_id;
    IF dg_college IS NULL THEN
      RAISE EXCEPTION 'DELIVERY_GROUP_NOT_FOUND' USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF dg_college <> NEW.college_id THEN
      RAISE EXCEPTION 'SESSION_DELIVERY_GROUP_CROSS_COLLEGE_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
    IF COALESCE(dg_obsolete, false)
       AND (TG_OP = 'INSERT' OR OLD.delivery_group_id IS DISTINCT FROM NEW.delivery_group_id) THEN
      RAISE EXCEPTION 'OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5a) Compatibility offering resolution helper (deterministic vs ambiguous)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_compatibility_offering_set(p_offerings jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_plan_ids text[];
  v_chosen jsonb;
BEGIN
  IF p_offerings IS NULL OR jsonb_typeof(p_offerings) <> 'array' OR jsonb_array_length(p_offerings) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_COMPATIBILITY_OFFERING');
  END IF;

  SELECT array_agg(DISTINCT e->>'plan_course_id')
    INTO v_plan_ids
  FROM jsonb_array_elements(p_offerings) e
  WHERE COALESCE((e->>'is_active')::boolean, true) = true;

  IF v_plan_ids IS NULL OR cardinality(v_plan_ids) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NO_COMPATIBILITY_OFFERING');
  END IF;

  IF cardinality(v_plan_ids) > 1 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'AMBIGUOUS_COMPATIBILITY_OFFERINGS',
      'message', 'offerings resolve to multiple plan_course_id values for one generation key'
    );
  END IF;

  SELECT e
    INTO v_chosen
  FROM jsonb_array_elements(p_offerings) e
  WHERE COALESCE((e->>'is_active')::boolean, true) = true
  ORDER BY COALESCE(e->>'created_at', '') DESC, COALESCE(e->>'id', '') ASC
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'course_offering_id', v_chosen->>'id',
    'plan_course_id', v_chosen->>'plan_course_id'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_compatibility_offering_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_compatibility_offering_set(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_compatibility_offering_set(jsonb) IS
  'PHASE-9.3: resolve one compatibility offering. Same plan_course → newest created_at then id. Multiple plan_course_id → AMBIGUOUS_COMPATIBILITY_OFFERINGS.';

-- ---------------------------------------------------------------------------
-- 5) generate_cohort_delivery_groups — idempotent, non-destructive, atomic validate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_cohort_delivery_groups(p_cohort_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cohort public.academic_cohorts%ROWTYPE;
  v_components_processed integer := 0;
  v_groups_created integer := 0;
  v_groups_updated integer := 0;
  v_groups_unchanged integer := 0;
  v_groups_obsolete integer := 0;
  v_warnings jsonb := '[]'::jsonb;
  v_validation_errors jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  r record;
  v_student_count integer;
  v_capacity integer;
  v_required integer;
  v_group_num integer;
  v_has_links boolean;
  v_expected_for_group integer;
  v_group_code text;
  v_excluded boolean;
  v_row public.delivery_groups%ROWTYPE;
  v_changed boolean;
  v_base integer;
  v_rem integer;
  v_status text;
BEGIN
  IF p_cohort_id IS NULL THEN
    RAISE EXCEPTION 'COHORT_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_cohort FROM public.academic_cohorts WHERE id = p_cohort_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'COHORT_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_manage_college(v_uid, v_cohort.college_id) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  v_student_count := COALESCE(v_cohort.expected_students, 0);
  IF v_student_count < 0 THEN
    RAISE EXCEPTION 'INVALID_STUDENT_COUNT' USING ERRCODE = 'check_violation';
  END IF;

  -- Materialize one row per component (deterministic offering). Source of truth:
  -- cohort + actual plan_course + plan_course_component.
  CREATE TEMP TABLE IF NOT EXISTS _dg_gen_components (
    component_id uuid PRIMARY KEY,
    plan_course_id uuid NOT NULL,
    component_type text NOT NULL,
    weekly_contact_hours numeric,
    required_room_type_id uuid,
    explicit_group_size integer,
    is_timetabled boolean,
    counts_toward_regular_load boolean,
    room_default_capacity integer,
    strict_capacity boolean,
    course_offering_id uuid,
    offering_count integer NOT NULL DEFAULT 1
  ) ON COMMIT DROP;

  TRUNCATE _dg_gen_components;

  INSERT INTO _dg_gen_components (
    component_id, plan_course_id, component_type, weekly_contact_hours,
    required_room_type_id, explicit_group_size, is_timetabled, counts_toward_regular_load,
    room_default_capacity, strict_capacity, course_offering_id, offering_count
  )
  SELECT
    x.component_id,
    x.plan_course_id,
    x.component_type,
    x.weekly_contact_hours,
    x.required_room_type_id,
    x.explicit_group_size,
    x.is_timetabled,
    x.counts_toward_regular_load,
    x.room_default_capacity,
    x.strict_capacity,
    x.course_offering_id,
    x.offering_count
  FROM (
    SELECT DISTINCT ON (pcc.id)
      pcc.id AS component_id,
      pcc.plan_course_id,
      pcc.component_type,
      pcc.weekly_contact_hours,
      pcc.required_room_type_id,
      pcc.explicit_group_size,
      pcc.is_timetabled,
      pcc.counts_toward_regular_load,
      rt.default_capacity AS room_default_capacity,
      COALESCE(rt.strict_capacity, false) AS strict_capacity,
      co.id AS course_offering_id,
      COUNT(*) OVER (PARTITION BY pcc.id) AS offering_count
    FROM public.course_offerings co
    JOIN public.plan_course_components pcc
      ON pcc.plan_course_id = co.plan_course_id
     AND pcc.college_id = co.college_id
    LEFT JOIN public.room_types rt
      ON rt.id = pcc.required_room_type_id
     AND rt.college_id = pcc.college_id
    WHERE co.college_id = v_cohort.college_id
      AND co.term_id = v_cohort.term_id
      AND COALESCE(co.program_id, v_cohort.program_id) = v_cohort.program_id
      AND COALESCE(co.level_id, v_cohort.level_id) = v_cohort.level_id
      AND co.study_system = v_cohort.study_system
      AND co.plan_course_id IS NOT NULL
      AND COALESCE(co.is_active, true) = true
    ORDER BY pcc.id, co.created_at DESC NULLS LAST, co.id ASC
  ) x;

  -- ---- Pass 1: pre-validate all components (no DML) ----
  FOR r IN
    SELECT * FROM _dg_gen_components
    ORDER BY plan_course_id, component_type, component_id
  LOOP
    v_components_processed := v_components_processed + 1;

    -- offering_count > 1: deterministic pick already applied (newest created_at, then id).
    -- Duplicate same-plan_course offerings are resolvable → do not fail; pass-2 will not
    -- multiply groups because components are keyed by component_id uniquely.

    IF r.component_type = 'summer_training' THEN
      CONTINUE;
    END IF;

    IF r.component_type = 'project' THEN
      IF COALESCE(r.weekly_contact_hours, 0) <= 0 THEN
        CONTINUE;
      END IF;
      IF r.explicit_group_size IS NULL OR r.explicit_group_size <= 0 THEN
        v_validation_errors := v_validation_errors || jsonb_build_array(
          jsonb_build_object(
            'code', 'MISSING_PROJECT_GROUP_SIZE',
            'component_id', r.component_id,
            'component_type', r.component_type,
            'message', 'project requires explicit_group_size; capacity must not be guessed'
          )
        );
      END IF;
      CONTINUE;
    END IF;

    IF r.component_type = 'tutorial' AND r.explicit_group_size IS NOT NULL AND r.explicit_group_size > 0 THEN
      CONTINUE;
    END IF;

    IF r.required_room_type_id IS NULL
       OR r.room_default_capacity IS NULL
       OR r.room_default_capacity <= 0 THEN
      v_validation_errors := v_validation_errors || jsonb_build_array(
        jsonb_build_object(
          'code', 'MISSING_CAPACITY',
          'component_id', r.component_id,
          'component_type', r.component_type,
          'message', 'missing room type capacity reference; refuse to guess'
        )
      );
    END IF;
  END LOOP;

  IF jsonb_array_length(v_validation_errors) > 0 THEN
    RETURN jsonb_build_object(
      'status', 'VALIDATION_FAILED',
      'cohorts_processed', 1,
      'cohort_id', p_cohort_id,
      'college_id', v_cohort.college_id,
      'student_count', v_student_count,
      'components_processed', v_components_processed,
      'groups_created', 0,
      'groups_updated', 0,
      'groups_unchanged', 0,
      'groups_obsolete', 0,
      'skipped_components', '[]'::jsonb,
      'warnings', '[]'::jsonb,
      'validation_errors', v_validation_errors
    );
  END IF;

  -- Reset processed counter for pass 2 accounting
  v_components_processed := 0;

  -- ---- Pass 2: atomic DML (only when validation passed) ----
  FOR r IN
    SELECT * FROM _dg_gen_components
    ORDER BY plan_course_id, component_type, component_id
  LOOP
    v_components_processed := v_components_processed + 1;

    IF r.offering_count > 1 THEN
      v_warnings := v_warnings || jsonb_build_array(
        jsonb_build_object(
          'code', 'COMPATIBILITY_OFFERING_RESOLVED_DETERMINISTICALLY',
          'component_id', r.component_id,
          'plan_course_id', r.plan_course_id,
          'offering_count', r.offering_count,
          'chosen_course_offering_id', r.course_offering_id,
          'message', 'multiple compatibility offerings; chose newest created_at then id; one component pass only'
        )
      );
    END IF;

    IF r.component_type = 'summer_training' THEN
      v_skipped := v_skipped || jsonb_build_array(
        jsonb_build_object(
          'code', 'skipped_non_weekly_component',
          'component_id', r.component_id,
          'component_type', r.component_type,
          'course_offering_id', r.course_offering_id
        )
      );
      CONTINUE;
    END IF;

    v_excluded := (r.component_type = 'project')
      OR (COALESCE(r.counts_toward_regular_load, true) = false);
    v_capacity := NULL;
    v_required := NULL;

    IF r.component_type = 'project' THEN
      IF COALESCE(r.weekly_contact_hours, 0) <= 0 THEN
        v_skipped := v_skipped || jsonb_build_array(
          jsonb_build_object(
            'code', 'project_zero_hours',
            'component_id', r.component_id,
            'component_type', r.component_type
          )
        );
        CONTINUE;
      END IF;
      v_capacity := r.explicit_group_size;
      IF v_student_count = 0 THEN
        v_required := 1;
      ELSE
        v_required := CEIL(v_student_count::numeric / v_capacity::numeric)::integer;
      END IF;
    ELSIF r.component_type = 'tutorial' AND r.explicit_group_size IS NOT NULL AND r.explicit_group_size > 0 THEN
      v_capacity := r.explicit_group_size;
      IF v_student_count = 0 THEN
        v_required := 1;
      ELSE
        v_required := CEIL(v_student_count::numeric / v_capacity::numeric)::integer;
      END IF;
    ELSE
      v_capacity := r.room_default_capacity;
      IF r.component_type = 'theory' THEN
        IF v_student_count <= v_capacity THEN
          v_required := 1;
        ELSE
          v_required := CEIL(v_student_count::numeric / v_capacity::numeric)::integer;
        END IF;
      ELSE
        IF v_student_count = 0 THEN
          v_required := 1;
        ELSE
          v_required := CEIL(v_student_count::numeric / v_capacity::numeric)::integer;
        END IF;
      END IF;
    END IF;

    v_base := CASE WHEN v_required > 0 THEN v_student_count / v_required ELSE 0 END;
    v_rem := CASE WHEN v_required > 0 THEN v_student_count % v_required ELSE 0 END;

    FOR v_group_num IN 1..v_required LOOP
      v_expected_for_group := v_base + CASE WHEN v_group_num <= v_rem THEN 1 ELSE 0 END;
      v_group_code := 'G' || v_group_num::text;

      SELECT * INTO v_row
      FROM public.delivery_groups dg
      WHERE dg.cohort_id = p_cohort_id
        AND dg.component_id = r.component_id
        AND dg.group_number = v_group_num;

      IF NOT FOUND THEN
        INSERT INTO public.delivery_groups (
          college_id, cohort_id, plan_course_id, component_id,
          group_code, group_number, expected_students, capacity_limit,
          active, excluded_from_standard_workload, is_obsolete
        ) VALUES (
          v_cohort.college_id, p_cohort_id, r.plan_course_id, r.component_id,
          v_group_code, v_group_num, v_expected_for_group, v_capacity,
          true, v_excluded, false
        );
        v_groups_created := v_groups_created + 1;
      ELSE
        v_changed := (
          v_row.expected_students IS DISTINCT FROM v_expected_for_group
          OR v_row.capacity_limit IS DISTINCT FROM v_capacity
          OR v_row.excluded_from_standard_workload IS DISTINCT FROM v_excluded
          OR v_row.active IS DISTINCT FROM true
          OR COALESCE(v_row.is_obsolete, false) IS DISTINCT FROM false
        );
        IF v_changed THEN
          UPDATE public.delivery_groups
          SET expected_students = v_expected_for_group,
              capacity_limit = v_capacity,
              excluded_from_standard_workload = v_excluded,
              active = true,
              is_obsolete = false,
              group_code = COALESCE(NULLIF(v_row.group_code, ''), v_group_code)
          WHERE id = v_row.id;
          v_groups_updated := v_groups_updated + 1;
        ELSE
          v_groups_unchanged := v_groups_unchanged + 1;
        END IF;
      END IF;
    END LOOP;

    -- Obsolete groups (required decreased): mark is_obsolete, never delete
    FOR v_row IN
      SELECT *
      FROM public.delivery_groups dg
      WHERE dg.cohort_id = p_cohort_id
        AND dg.component_id = r.component_id
        AND dg.group_number IS NOT NULL
        AND dg.group_number > v_required
    LOOP
      v_groups_obsolete := v_groups_obsolete + 1;

      IF NOT COALESCE(v_row.is_obsolete, false) THEN
        UPDATE public.delivery_groups
        SET is_obsolete = true
        WHERE id = v_row.id;
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM public.teaching_assignments ta WHERE ta.delivery_group_id = v_row.id
      ) OR EXISTS (
        SELECT 1 FROM public.schedule_sessions ss WHERE ss.delivery_group_id = v_row.id
      ) INTO v_has_links;

      IF v_has_links THEN
        v_warnings := v_warnings || jsonb_build_array(
          jsonb_build_object(
            'code', 'OBSOLETE_GROUP_LINKED',
            'delivery_group_id', v_row.id,
            'group_number', v_row.group_number,
            'component_id', r.component_id,
            'message', 'obsolete group has operational links; marked obsolete, not deleted'
          )
        );
      ELSE
        v_warnings := v_warnings || jsonb_build_array(
          jsonb_build_object(
            'code', 'OBSOLETE_GROUP_UNUSED',
            'delivery_group_id', v_row.id,
            'group_number', v_row.group_number,
            'component_id', r.component_id,
            'message', 'obsolete unused group marked obsolete and retained (non-destructive)'
          )
        );
      END IF;
    END LOOP;
  END LOOP;

  IF v_groups_created = 0 AND v_groups_updated = 0 AND v_groups_obsolete = 0 THEN
    v_status := 'NO_CHANGES';
  ELSE
    v_status := 'SUCCESS';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'cohorts_processed', 1,
    'cohort_id', p_cohort_id,
    'college_id', v_cohort.college_id,
    'student_count', v_student_count,
    'components_processed', v_components_processed,
    'groups_created', v_groups_created,
    'groups_updated', v_groups_updated,
    'groups_unchanged', v_groups_unchanged,
    'groups_obsolete', v_groups_obsolete,
    'skipped_components', v_skipped,
    'warnings', v_warnings,
    'validation_errors', v_validation_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION public.generate_cohort_delivery_groups(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_cohort_delivery_groups(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.generate_cohort_delivery_groups(uuid) IS
  'PHASE-9.3 idempotent delivery-group generator for one academic_cohort. Pre-validates then atomic DML. Non-destructive. NOT auto-invoked.';

-- ---------------------------------------------------------------------------
-- 6) Workload view + RPC
--    Isolation: security_invoker=true so SELECT uses caller privileges + RLS on
--    teaching_assignments / instructors / delivery_groups / plan_course_components /
--    academic_cohorts (all college-scoped via can_view_college).
--    Do not rely on security_barrier owner bypass. PUBLIC/anon have no SELECT.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.v_instructor_delivery_workload;

CREATE VIEW public.v_instructor_delivery_workload
WITH (security_invoker = true)
AS
SELECT
  ta.college_id,
  ta.instructor_id,
  i.academic_rank,
  ta.cohort_id,
  ac.term_id,
  SUM(
    CASE
      WHEN pcc.component_type = 'summer_training' THEN 0
      WHEN pcc.component_type = 'project' OR COALESCE(dg.excluded_from_standard_workload, false)
           OR COALESCE(pcc.counts_toward_regular_load, true) = false THEN 0
      -- Sole instructor: explicit assigned_component_hours or component weekly hours.
      -- Co-teaching: only explicit assigned_component_hours (never legacy weekly_hours DEFAULT 3).
      WHEN (
        SELECT COUNT(*)::integer FROM public.teaching_assignments ta2
        WHERE ta2.delivery_group_id = ta.delivery_group_id
          AND ta2.delivery_group_id IS NOT NULL
      ) > 1
      THEN COALESCE(ta.assigned_component_hours, 0)
      ELSE COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0)
    END
  )::numeric AS standard_assigned_hours,
  SUM(
    CASE
      WHEN pcc.component_type = 'project' THEN
        CASE
          WHEN (
            SELECT COUNT(*)::integer FROM public.teaching_assignments ta2
            WHERE ta2.delivery_group_id = ta.delivery_group_id
              AND ta2.delivery_group_id IS NOT NULL
          ) > 1 THEN COALESCE(ta.assigned_component_hours, 0)
          ELSE COALESCE(ta.assigned_component_hours, pcc.weekly_contact_hours, 0)
        END
      ELSE 0
    END
  )::numeric AS project_supervision_hours
FROM public.teaching_assignments ta
JOIN public.instructors i ON i.id = ta.instructor_id
LEFT JOIN public.delivery_groups dg ON dg.id = ta.delivery_group_id
LEFT JOIN public.plan_course_components pcc
  ON pcc.id = COALESCE(ta.plan_course_component_id, dg.component_id)
LEFT JOIN public.academic_cohorts ac ON ac.id = COALESCE(ta.cohort_id, dg.cohort_id)
WHERE ta.delivery_group_id IS NOT NULL
GROUP BY ta.college_id, ta.instructor_id, i.academic_rank, ta.cohort_id, ac.term_id;

REVOKE ALL ON public.v_instructor_delivery_workload FROM PUBLIC, anon;
GRANT SELECT ON public.v_instructor_delivery_workload TO authenticated, service_role;

COMMENT ON VIEW public.v_instructor_delivery_workload IS
  'PHASE-9.3 standard/project hours from delivery-group assignments. security_invoker=true; college isolation via base-table RLS. Ignores legacy weekly_hours DEFAULT 3.';

CREATE OR REPLACE FUNCTION public.compute_instructor_standard_workload(
  p_instructor_id uuid,
  p_term_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_instructor public.instructors%ROWTYPE;
  v_required numeric;
  v_rank_code text;
  v_standard numeric := 0;
  v_project numeric := 0;
  v_status text;
  v_deficit numeric := 0;
  v_overload numeric := 0;
BEGIN
  IF p_instructor_id IS NULL THEN
    RAISE EXCEPTION 'INSTRUCTOR_ID_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_instructor FROM public.instructors WHERE id = p_instructor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INSTRUCTOR_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- Permission gate before any sensitive aggregate read
  IF NOT (
    public.can_view_college(v_uid, v_instructor.college_id)
    OR public.can_manage_college(v_uid, v_instructor.college_id)
  ) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  SELECT fwp.required_load_hours, fwp.rank_code
    INTO v_required, v_rank_code
  FROM public.faculty_workload_policies fwp
  WHERE fwp.college_id = v_instructor.college_id
    AND fwp.active = true
    AND (
      lower(fwp.rank_code) = lower(COALESCE(v_instructor.academic_rank, ''))
      OR EXISTS (
        SELECT 1
        FROM unnest(fwp.rank_aliases) alias
        WHERE lower(alias) = lower(COALESCE(v_instructor.academic_rank, ''))
      )
    )
  ORDER BY fwp.rank_code
  LIMIT 1;

  SELECT
    COALESCE(SUM(w.standard_assigned_hours), 0),
    COALESCE(SUM(w.project_supervision_hours), 0)
  INTO v_standard, v_project
  FROM public.v_instructor_delivery_workload w
  WHERE w.instructor_id = p_instructor_id
    AND w.college_id = v_instructor.college_id
    AND (p_term_id IS NULL OR w.term_id = p_term_id);

  IF v_required IS NULL THEN
    v_status := 'policy_missing';
  ELSIF v_standard = 0 THEN
    v_status := 'unassigned';
    v_deficit := v_required;
  ELSIF v_standard > v_required THEN
    v_status := 'overload';
    v_overload := v_standard - v_required;
  ELSIF v_standard < v_required THEN
    v_status := 'deficit';
    v_deficit := v_required - v_standard;
  ELSE
    v_status := 'ok';
  END IF;

  RETURN jsonb_build_object(
    'instructor_id', p_instructor_id,
    'college_id', v_instructor.college_id,
    'term_id', p_term_id,
    'rank_code', v_rank_code,
    'academic_rank', v_instructor.academic_rank,
    'required_load_hours', v_required,
    'standard_assigned_hours', v_standard,
    'project_supervision_hours', v_project,
    'deficit_hours', v_deficit,
    'overload_hours', v_overload,
    'status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_instructor_standard_workload(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.compute_instructor_standard_workload(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.compute_instructor_standard_workload(uuid, uuid) IS
  'PHASE-9.3 standard workload from delivery-group assignments. Auth+college gate before read. Project separate. No summer_training. Uses assigned_component_hours for co-teaching.';

COMMIT;

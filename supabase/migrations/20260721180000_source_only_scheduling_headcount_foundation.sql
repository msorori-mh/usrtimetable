-- SOURCE ONLY — NOT APPLIED — waiting APPROVE_DB_MIGRATION_APPLY.
-- Scheduling headcount foundation. This file is intentionally not applied by this change.
-- A2 shared groups will later SUM scheduling_headcount for explicitly participating cohorts.
--
-- Apply prerequisites (also currently NOT APPLIED on Production until approved):
--   20260717050000_source_only_harden_cross_college_references.sql
--   must create UNIQUE(id, college_id) on academic_cohorts / academic_terms first,
--   because this migration uses composite FKs (cohort_id, college_id) and
--   (term_id, college_id).
-- No DML against operational business rows. No backfill. No default headcounts.

CREATE TABLE public.scheduling_cohort_term_headcounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  cohort_id uuid NOT NULL,
  term_id uuid NOT NULL,
  study_system text NOT NULL CHECK (study_system IN ('regular', 'parallel', 'evening', 'distance', 'other')),
  registered_student_count integer NOT NULL CHECK (registered_student_count >= 0),
  eligible_student_count integer NOT NULL CHECK (eligible_student_count >= 0),
  expected_attendance_count integer NOT NULL CHECK (expected_attendance_count >= 0),
  reserve_margin integer NOT NULL DEFAULT 0 CHECK (reserve_margin >= 0),
  scheduling_headcount integer NOT NULL CHECK (scheduling_headcount >= 0),
  exam_eligible_count integer NOT NULL CHECK (exam_eligible_count >= 0),
  approval_status text NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'approved', 'archived')),
  source text NOT NULL,
  notes text,
  approved_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_cohort_term_headcounts_cohort_term_key UNIQUE (cohort_id, term_id),
  CONSTRAINT scheduling_headcount_cohort_college_fkey
    FOREIGN KEY (cohort_id, college_id) REFERENCES public.academic_cohorts(id, college_id) ON DELETE RESTRICT,
  CONSTRAINT scheduling_headcount_term_college_fkey
    FOREIGN KEY (term_id, college_id) REFERENCES public.academic_terms(id, college_id) ON DELETE RESTRICT
);

CREATE TABLE public.scheduling_headcount_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  headcount_id uuid NOT NULL REFERENCES public.scheduling_cohort_term_headcounts(id) ON DELETE RESTRICT,
  course_offering_id uuid NULL REFERENCES public.course_offerings(id) ON DELETE RESTRICT,
  plan_course_component_id uuid NULL REFERENCES public.plan_course_components(id) ON DELETE RESTRICT,
  scheduling_headcount integer NOT NULL CHECK (scheduling_headcount >= 0),
  exam_eligible_count integer NULL CHECK (exam_eligible_count >= 0),
  reserve_margin integer NULL CHECK (reserve_margin >= 0),
  approval_status text NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'approved', 'archived')),
  source text NOT NULL,
  notes text,
  approved_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_headcount_override_target_required
    CHECK (course_offering_id IS NOT NULL OR plan_course_component_id IS NOT NULL)
);
CREATE UNIQUE INDEX scheduling_headcount_override_active_grain_key
  ON public.scheduling_headcount_overrides (
    headcount_id,
    COALESCE(course_offering_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(plan_course_component_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) WHERE active;

CREATE TABLE public.scheduling_headcount_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  headcount_id uuid NOT NULL REFERENCES public.scheduling_cohort_term_headcounts(id) ON DELETE RESTRICT,
  override_id uuid NULL REFERENCES public.scheduling_headcount_overrides(id) ON DELETE RESTRICT,
  revision_kind text NOT NULL CHECK (revision_kind IN ('create', 'update', 'approve', 'override_upsert', 'override_archive')),
  snapshot jsonb NOT NULL,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE INDEX scheduling_headcount_revisions_headcount_changed_idx
  ON public.scheduling_headcount_revisions (headcount_id, changed_at DESC);

CREATE TRIGGER trg_scheduling_cohort_term_headcounts_updated
  BEFORE UPDATE ON public.scheduling_cohort_term_headcounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_scheduling_headcount_overrides_updated
  BEFORE UPDATE ON public.scheduling_headcount_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.scheduling_cohort_term_headcounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_headcount_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduling_headcount_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY scheduling_headcounts_select ON public.scheduling_cohort_term_headcounts
  FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY scheduling_headcounts_insert ON public.scheduling_cohort_term_headcounts
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY scheduling_headcounts_update ON public.scheduling_cohort_term_headcounts
  FOR UPDATE TO authenticated USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY scheduling_headcounts_delete ON public.scheduling_cohort_term_headcounts
  FOR DELETE TO authenticated USING (public.can_manage_college(auth.uid(), college_id));

CREATE POLICY scheduling_headcount_overrides_select ON public.scheduling_headcount_overrides
  FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY scheduling_headcount_overrides_insert ON public.scheduling_headcount_overrides
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY scheduling_headcount_overrides_update ON public.scheduling_headcount_overrides
  FOR UPDATE TO authenticated USING (public.can_manage_college(auth.uid(), college_id))
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));
CREATE POLICY scheduling_headcount_overrides_delete ON public.scheduling_headcount_overrides
  FOR DELETE TO authenticated USING (public.can_manage_college(auth.uid(), college_id));

CREATE POLICY scheduling_headcount_revisions_select ON public.scheduling_headcount_revisions
  FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));

GRANT SELECT ON public.scheduling_cohort_term_headcounts, public.scheduling_headcount_overrides,
  public.scheduling_headcount_revisions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.scheduling_cohort_term_headcounts,
  public.scheduling_headcount_overrides, public.scheduling_headcount_revisions FROM authenticated, anon, PUBLIC;
GRANT ALL ON public.scheduling_cohort_term_headcounts, public.scheduling_headcount_overrides,
  public.scheduling_headcount_revisions TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_scheduling_cohort_term_headcount(
  p_cohort_id uuid, p_term_id uuid, p_registered_student_count integer,
  p_eligible_student_count integer, p_expected_attendance_count integer,
  p_reserve_margin integer DEFAULT 0, p_scheduling_headcount integer DEFAULT 0,
  p_exam_eligible_count integer DEFAULT 0, p_source text DEFAULT '',
  p_notes text DEFAULT NULL, p_allow_over_eligible boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_cohort public.academic_cohorts%ROWTYPE;
  v_row public.scheduling_cohort_term_headcounts%ROWTYPE; v_kind text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  SELECT * INTO v_cohort FROM public.academic_cohorts WHERE id = p_cohort_id;
  IF NOT FOUND OR v_cohort.term_id <> p_term_id THEN RETURN jsonb_build_object('ok', false, 'code', 'COHORT_TERM_NOT_FOUND', 'message', 'Cohort and term must match'); END IF;
  IF NOT public.can_manage_college(v_uid, v_cohort.college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College management permission required'); END IF;
  IF NULLIF(btrim(p_source), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SOURCE_REQUIRED', 'message', 'Headcount source is required');
  END IF;
  IF p_registered_student_count < 0 OR p_eligible_student_count < 0 OR p_expected_attendance_count < 0
    OR p_reserve_margin < 0 OR p_scheduling_headcount < 0 OR p_exam_eligible_count < 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NEGATIVE_COUNT', 'message', 'Counts cannot be negative');
  END IF;
  IF (p_scheduling_headcount > p_eligible_student_count OR p_expected_attendance_count > p_eligible_student_count)
    AND (NOT p_allow_over_eligible OR NULLIF(btrim(p_notes), '') IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'OVER_ELIGIBLE_REQUIRES_REASON', 'message', 'Over-eligible values require manager override and notes');
  END IF;
  SELECT * INTO v_row FROM public.scheduling_cohort_term_headcounts WHERE cohort_id = p_cohort_id AND term_id = p_term_id FOR UPDATE;
  v_kind := CASE WHEN FOUND THEN 'update' ELSE 'create' END;
  INSERT INTO public.scheduling_cohort_term_headcounts (
    college_id, cohort_id, term_id, study_system, registered_student_count, eligible_student_count,
    expected_attendance_count, reserve_margin, scheduling_headcount, exam_eligible_count, source, notes
  ) VALUES (
    v_cohort.college_id, p_cohort_id, p_term_id, v_cohort.study_system, p_registered_student_count,
    p_eligible_student_count, p_expected_attendance_count, p_reserve_margin, p_scheduling_headcount,
    p_exam_eligible_count, p_source, p_notes
  ) ON CONFLICT (cohort_id, term_id) DO UPDATE SET
    registered_student_count = EXCLUDED.registered_student_count, eligible_student_count = EXCLUDED.eligible_student_count,
    expected_attendance_count = EXCLUDED.expected_attendance_count, reserve_margin = EXCLUDED.reserve_margin,
    scheduling_headcount = EXCLUDED.scheduling_headcount, exam_eligible_count = EXCLUDED.exam_eligible_count,
    source = EXCLUDED.source, notes = EXCLUDED.notes, study_system = EXCLUDED.study_system,
    approval_status = 'draft', approved_by = NULL, approved_at = NULL
  RETURNING * INTO v_row;
  INSERT INTO public.scheduling_headcount_revisions (college_id, headcount_id, revision_kind, snapshot, changed_by, notes)
    VALUES (v_row.college_id, v_row.id, v_kind, to_jsonb(v_row), v_uid, p_notes);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'scheduling_headcount_upsert', 'scheduling_cohort_term_headcounts', v_row.id, v_row.college_id, jsonb_build_object('revision_kind', v_kind));
  RETURN jsonb_build_object('ok', true, 'headcount', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.approve_scheduling_cohort_term_headcount(p_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.scheduling_cohort_term_headcounts%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  SELECT * INTO v_row FROM public.scheduling_cohort_term_headcounts WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Headcount not found'); END IF;
  IF NOT public.can_manage_college(v_uid, v_row.college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College management permission required'); END IF;
  IF v_row.scheduling_headcount > v_row.eligible_student_count OR v_row.expected_attendance_count > v_row.eligible_student_count THEN
    IF NULLIF(btrim(coalesce(p_notes, v_row.notes)), '') IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'OVER_ELIGIBLE_REQUIRES_REASON', 'message', 'Approval requires notes for over-eligible values'); END IF;
  END IF;
  UPDATE public.scheduling_cohort_term_headcounts SET approval_status = 'approved', approved_by = v_uid,
    approved_at = now(), notes = coalesce(p_notes, notes) WHERE id = p_id RETURNING * INTO v_row;
  INSERT INTO public.scheduling_headcount_revisions (college_id, headcount_id, revision_kind, snapshot, changed_by, notes)
    VALUES (v_row.college_id, v_row.id, 'approve', to_jsonb(v_row), v_uid, p_notes);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'scheduling_headcount_approve', 'scheduling_cohort_term_headcounts', v_row.id, v_row.college_id, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'headcount', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.upsert_scheduling_headcount_override(
  p_headcount_id uuid, p_course_offering_id uuid DEFAULT NULL, p_plan_course_component_id uuid DEFAULT NULL,
  p_scheduling_headcount integer DEFAULT 0, p_exam_eligible_count integer DEFAULT NULL,
  p_reserve_margin integer DEFAULT NULL, p_source text DEFAULT '', p_notes text DEFAULT NULL,
  p_allow_over_eligible boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_base public.scheduling_cohort_term_headcounts%ROWTYPE;
  v_row public.scheduling_headcount_overrides%ROWTYPE; v_offering_college uuid; v_component_college uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  SELECT * INTO v_base FROM public.scheduling_cohort_term_headcounts WHERE id = p_headcount_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Headcount not found'); END IF;
  IF NOT public.can_manage_college(v_uid, v_base.college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College management permission required'); END IF;
  IF p_course_offering_id IS NULL AND p_plan_course_component_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'OVERRIDE_TARGET_REQUIRED', 'message', 'Offering or component is required'); END IF;
  IF p_scheduling_headcount < 0 OR p_exam_eligible_count < 0 OR p_reserve_margin < 0 THEN RETURN jsonb_build_object('ok', false, 'code', 'NEGATIVE_COUNT', 'message', 'Counts cannot be negative'); END IF;
  IF p_scheduling_headcount > v_base.eligible_student_count AND (NOT p_allow_over_eligible OR NULLIF(btrim(p_notes), '') IS NULL) THEN RETURN jsonb_build_object('ok', false, 'code', 'OVER_ELIGIBLE_REQUIRES_REASON', 'message', 'Over-eligible override requires manager override and notes'); END IF;
  IF NULLIF(btrim(p_source), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SOURCE_REQUIRED', 'message', 'Override source is required');
  END IF;
  IF p_course_offering_id IS NOT NULL THEN SELECT college_id INTO v_offering_college FROM public.course_offerings WHERE id = p_course_offering_id; END IF;
  IF p_plan_course_component_id IS NOT NULL THEN SELECT college_id INTO v_component_college FROM public.plan_course_components WHERE id = p_plan_course_component_id; END IF;
  IF (p_course_offering_id IS NOT NULL AND v_offering_college IS DISTINCT FROM v_base.college_id)
    OR (p_plan_course_component_id IS NOT NULL AND v_component_college IS DISTINCT FROM v_base.college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'COLLEGE_MISMATCH', 'message', 'Override target must belong to the same college'); END IF;
  -- Manual upsert against the partial unique index (expression ON CONFLICT is fragile).
  SELECT * INTO v_row
  FROM public.scheduling_headcount_overrides
  WHERE headcount_id = p_headcount_id
    AND active
    AND course_offering_id IS NOT DISTINCT FROM p_course_offering_id
    AND plan_course_component_id IS NOT DISTINCT FROM p_plan_course_component_id
  FOR UPDATE;
  IF FOUND THEN
    UPDATE public.scheduling_headcount_overrides SET
      scheduling_headcount = p_scheduling_headcount,
      exam_eligible_count = p_exam_eligible_count,
      reserve_margin = p_reserve_margin,
      source = p_source,
      notes = p_notes,
      approval_status = 'approved',
      approved_by = v_uid,
      approved_at = now()
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.scheduling_headcount_overrides (
      college_id, headcount_id, course_offering_id, plan_course_component_id,
      scheduling_headcount, exam_eligible_count, reserve_margin, approval_status,
      source, notes, approved_by, approved_at
    ) VALUES (
      v_base.college_id, p_headcount_id, p_course_offering_id, p_plan_course_component_id,
      p_scheduling_headcount, p_exam_eligible_count, p_reserve_margin, 'approved',
      p_source, p_notes, v_uid, now()
    ) RETURNING * INTO v_row;
  END IF;
  INSERT INTO public.scheduling_headcount_revisions (college_id, headcount_id, override_id, revision_kind, snapshot, changed_by, notes)
    VALUES (v_base.college_id, v_base.id, v_row.id, 'override_upsert', to_jsonb(v_row), v_uid, p_notes);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'scheduling_headcount_override_upsert', 'scheduling_headcount_overrides', v_row.id, v_base.college_id, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'override', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.archive_scheduling_headcount_override(p_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.scheduling_headcount_overrides%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  SELECT * INTO v_row FROM public.scheduling_headcount_overrides WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Override not found'); END IF;
  IF NOT public.can_manage_college(v_uid, v_row.college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College management permission required'); END IF;
  UPDATE public.scheduling_headcount_overrides SET active = false, approval_status = 'archived', notes = coalesce(p_notes, notes) WHERE id = p_id RETURNING * INTO v_row;
  INSERT INTO public.scheduling_headcount_revisions (college_id, headcount_id, override_id, revision_kind, snapshot, changed_by, notes)
    VALUES (v_row.college_id, v_row.headcount_id, v_row.id, 'override_archive', to_jsonb(v_row), v_uid, p_notes);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'scheduling_headcount_override_archive', 'scheduling_headcount_overrides', v_row.id, v_row.college_id, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'override', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.resolve_scheduling_headcount(
  p_college_id uuid, p_cohort_id uuid, p_term_id uuid,
  p_course_offering_id uuid DEFAULT NULL, p_plan_course_component_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_base public.scheduling_cohort_term_headcounts%ROWTYPE;
  v_override public.scheduling_headcount_overrides%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.can_view_college(v_uid, p_college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College view permission required'); END IF;
  SELECT * INTO v_base FROM public.scheduling_cohort_term_headcounts
    WHERE college_id = p_college_id AND cohort_id = p_cohort_id AND term_id = p_term_id AND approval_status = 'approved';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'SCHEDULING_HEADCOUNT_MISSING', 'blocker', true, 'message', 'Approved scheduling headcount is required before generation'); END IF;
  SELECT * INTO v_override FROM public.scheduling_headcount_overrides
    WHERE headcount_id = v_base.id AND active AND approval_status = 'approved'
      AND (course_offering_id IS NULL OR course_offering_id = p_course_offering_id)
      AND (plan_course_component_id IS NULL OR plan_course_component_id = p_plan_course_component_id)
    ORDER BY (course_offering_id IS NOT NULL)::int + (plan_course_component_id IS NOT NULL)::int DESC
    LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'source', 'override', 'headcount_id', v_base.id, 'override_id', v_override.id, 'scheduling_headcount', v_override.scheduling_headcount, 'exam_eligible_count', coalesce(v_override.exam_eligible_count, v_base.exam_eligible_count), 'reserve_margin', coalesce(v_override.reserve_margin, v_base.reserve_margin)); END IF;
  RETURN jsonb_build_object('ok', true, 'source', 'base', 'headcount_id', v_base.id, 'scheduling_headcount', v_base.scheduling_headcount, 'exam_eligible_count', v_base.exam_eligible_count, 'reserve_margin', v_base.reserve_margin);
END; $$;

CREATE OR REPLACE FUNCTION public.list_scheduling_headcount_revisions(p_headcount_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_college uuid;
BEGIN
  SELECT college_id INTO v_college FROM public.scheduling_cohort_term_headcounts WHERE id = p_headcount_id;
  IF v_college IS NULL OR v_uid IS NULL OR NOT public.can_view_college(v_uid, v_college) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College view permission required'); END IF;
  RETURN jsonb_build_object('ok', true, 'revisions', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.changed_at DESC) FROM public.scheduling_headcount_revisions r WHERE r.headcount_id = p_headcount_id), '[]'::jsonb));
END; $$;

REVOKE ALL ON FUNCTION public.upsert_scheduling_cohort_term_headcount(uuid, uuid, integer, integer, integer, integer, integer, integer, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_scheduling_cohort_term_headcount(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_scheduling_headcount_override(uuid, uuid, uuid, integer, integer, integer, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archive_scheduling_headcount_override(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_scheduling_headcount(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_scheduling_headcount_revisions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_scheduling_cohort_term_headcount(uuid, uuid, integer, integer, integer, integer, integer, integer, text, text, boolean), public.approve_scheduling_cohort_term_headcount(uuid, text), public.upsert_scheduling_headcount_override(uuid, uuid, uuid, integer, integer, integer, text, text, boolean), public.archive_scheduling_headcount_override(uuid, text), public.resolve_scheduling_headcount(uuid, uuid, uuid, uuid, uuid), public.list_scheduling_headcount_revisions(uuid) TO authenticated, service_role;

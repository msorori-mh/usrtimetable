-- SOURCE ONLY — NOT APPLIED — gate APPROVE_DB_MIGRATION_APPLY.
-- A3 / TRACK 4: Faculty workload policies (النصاب حسب الدرجة الأكاديمية) — extension + hardening.
-- This file is intentionally not applied by this change.
--
-- IMPORTANT: this migration EXTENDS, it does NOT recreate.
-- public.faculty_workload_policies already exists (created SOURCE ONLY / NOT APPLIED) by:
--   20260716233716_73dc0ba0-e4ba-43be-8628-ef2c36564a62.sql  (PHASE-9.3)
--
-- Verified assigned-hours source on main (teaching assignments V2):
--   public.v_instructor_delivery_workload + public.compute_instructor_standard_workload
--   (20260716233716 PHASE-9.3; refreshed to active-only V2 by 20260717035611 PHASE-9.4)
--   computed from public.teaching_assignments V2 columns
--   (delivery_group_id, plan_course_component_id, cohort_id, assigned_component_hours, is_active).
--   Table name is public.teaching_assignments (there is no physical teaching_assignments_v2 table;
--   "teaching_assignments_v2" is the V2 import/runtime contract name).
--
-- Apply prerequisites (all currently SOURCE ONLY / NOT APPLIED — apply order matters):
--   20260716233716 (faculty_workload_policies table + workload view + compute RPC)
--   20260717035611 (teaching_assignments.is_active + active-only workload view)
--   20260717050000 (UNIQUE(id, college_id) on academic_terms for the composite term FK)
--
-- Additive-only: ALTER TABLE ADD COLUMN IF NOT EXISTS + index + RPCs. No backfill.
-- No seed policies. No generator invocation. No sessions. No DML against operational business rows.
-- Auth model: RLS via can_view_college / can_manage_college; writes only via gated SECURITY DEFINER RPCs.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Extend faculty_workload_policies (النصاب حسب الدرجة الأكاديمية)
-- ---------------------------------------------------------------------------
ALTER TABLE public.faculty_workload_policies
  ADD COLUMN IF NOT EXISTS rank_label_ar text;

COMMENT ON COLUMN public.faculty_workload_policies.rank_label_ar IS
  'A3: Arabic display label of the academic rank (الدرجة الأكاديمية), e.g. أستاذ مساعد.';

ALTER TABLE public.faculty_workload_policies
  ADD COLUMN IF NOT EXISTS study_system text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.faculty_workload_policies'::regclass
      AND conname = 'fwp_study_system_check'
  ) THEN
    ALTER TABLE public.faculty_workload_policies
      ADD CONSTRAINT fwp_study_system_check
      CHECK (study_system IN ('regular','parallel','evening','distance','other'));
  END IF;
END $$;

COMMENT ON COLUMN public.faculty_workload_policies.study_system IS
  'A3: optional study-system scope (انتظام/انتساب/مسائي/عن بعد). NULL = applies to all study systems. Same value set as scheduling-headcount foundation.';

ALTER TABLE public.faculty_workload_policies
  ADD COLUMN IF NOT EXISTS min_load_hours numeric(5,2);

ALTER TABLE public.faculty_workload_policies
  ADD COLUMN IF NOT EXISTS max_load_hours numeric(5,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.faculty_workload_policies'::regclass
      AND conname = 'fwp_load_bounds_check'
  ) THEN
    ALTER TABLE public.faculty_workload_policies
      ADD CONSTRAINT fwp_load_bounds_check CHECK (
        (min_load_hours IS NULL OR min_load_hours >= 0)
        AND (max_load_hours IS NULL OR max_load_hours >= 0)
        AND (min_load_hours IS NULL OR max_load_hours IS NULL OR max_load_hours >= min_load_hours)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.faculty_workload_policies.min_load_hours IS
  'A3: optional lower bound of the teaching load (الحد الأدنى للنصاب). NULL = required_load_hours is the single target.';

COMMENT ON COLUMN public.faculty_workload_policies.max_load_hours IS
  'A3: optional hard upper bound of the teaching load (الحد الأعلى للنصاب). Exceeding it raises WORKLOAD_OVER_MAX.';

ALTER TABLE public.faculty_workload_policies
  ADD COLUMN IF NOT EXISTS overload_allowed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.faculty_workload_policies.overload_allowed IS
  'A3: whether exceeding required_load_hours is tolerated for this rank (إمكانية تجاوز النصاب). Overload is advisory (warning), never a hard write block.';

ALTER TABLE public.faculty_workload_policies
  ADD COLUMN IF NOT EXISTS term_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.faculty_workload_policies'::regclass
      AND conname = 'fwp_term_college_fk'
  ) THEN
    ALTER TABLE public.faculty_workload_policies
      ADD CONSTRAINT fwp_term_college_fk
      FOREIGN KEY (term_id, college_id)
      REFERENCES public.academic_terms (id, college_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

COMMENT ON COLUMN public.faculty_workload_policies.term_id IS
  'A3: optional effective term scope (الفصل الدراسي المستهدف). NULL = policy applies to all terms. Composite (id, college_id) FK per house style.';

ALTER TABLE public.faculty_workload_policies
  ADD COLUMN IF NOT EXISTS notes text;

-- ---------------------------------------------------------------------------
-- 2) Grain change (justified)
-- PHASE-9.3 grain: UNIQUE (college_id, rank_code). A3 needs distinct loads per
-- rank × study-system × term (النصاب قد يختلف حسب نظام الدراسة والفصل الدراسي),
-- so the legacy 2-column unique constraint is replaced by a 4-part expression
-- unique index with COALESCE sentinels (house style, same as scheduling-headcount overrides).
-- ---------------------------------------------------------------------------
ALTER TABLE public.faculty_workload_policies
  DROP CONSTRAINT IF EXISTS fwp_unique;

CREATE UNIQUE INDEX IF NOT EXISTS fwp_college_rank_system_term_uniq
  ON public.faculty_workload_policies (
    college_id,
    rank_code,
    COALESCE(study_system, ''),
    COALESCE(term_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

COMMENT ON INDEX public.fwp_college_rank_system_term_uniq IS
  'A3 grain: one active policy row per (college, rank, study-system, term). NULL study_system/term map to sentinel values.';

-- ---------------------------------------------------------------------------
-- 3) Write-path hardening
-- PHASE-9.3 granted INSERT/UPDATE/DELETE to authenticated. A3 revokes direct
-- writes: all policy changes must go through upsert/deactivate RPCs below so
-- every change is audited and manage-gated. SELECT stays granted (RLS-gated).
-- RLS (can_view_college / can_manage_college) is unchanged from PHASE-9.3.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.faculty_workload_policies FROM authenticated, anon, PUBLIC;

-- ---------------------------------------------------------------------------
-- 4) upsert_faculty_workload_policy (audited, manage-gated)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_faculty_workload_policy(
  p_college_id uuid,
  p_rank_code text,
  p_required_load_hours numeric,
  p_rank_label_ar text DEFAULT NULL,
  p_rank_aliases text[] DEFAULT '{}'::text[],
  p_study_system text DEFAULT NULL,
  p_term_id uuid DEFAULT NULL,
  p_min_load_hours numeric DEFAULT NULL,
  p_max_load_hours numeric DEFAULT NULL,
  p_overload_allowed boolean DEFAULT false,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.faculty_workload_policies%ROWTYPE;
  v_kind text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required');
  END IF;
  IF NOT public.can_manage_college(v_uid, p_college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College management permission required');
  END IF;
  IF p_rank_code IS NULL OR p_rank_code !~ '^[a-z][a-z0-9_]*$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RANK_CODE_INVALID', 'message', 'rank_code must be lowercase snake_case');
  END IF;
  IF p_required_load_hours IS NULL OR p_required_load_hours <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'REQUIRED_LOAD_INVALID', 'message', 'required_load_hours must be > 0');
  END IF;
  IF p_study_system IS NOT NULL AND p_study_system NOT IN ('regular','parallel','evening','distance','other') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STUDY_SYSTEM_INVALID', 'message', 'study_system not in allowed set');
  END IF;
  IF (p_min_load_hours IS NOT NULL AND p_min_load_hours < 0)
     OR (p_max_load_hours IS NOT NULL AND p_max_load_hours < 0) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NEGATIVE_HOURS', 'message', 'load bounds must be >= 0');
  END IF;
  IF p_min_load_hours IS NOT NULL AND p_max_load_hours IS NOT NULL AND p_max_load_hours < p_min_load_hours THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MAX_BELOW_MIN', 'message', 'max_load_hours must be >= min_load_hours');
  END IF;
  IF p_term_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.academic_terms t WHERE t.id = p_term_id AND t.college_id = p_college_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TERM_COLLEGE_MISMATCH', 'message', 'term_id must belong to the same college');
  END IF;

  SELECT * INTO v_row
  FROM public.faculty_workload_policies
  WHERE college_id = p_college_id
    AND rank_code = p_rank_code
    AND study_system IS NOT DISTINCT FROM p_study_system
    AND term_id IS NOT DISTINCT FROM p_term_id
  FOR UPDATE;

  v_kind := CASE WHEN FOUND THEN 'update' ELSE 'create' END;

  IF FOUND THEN
    UPDATE public.faculty_workload_policies SET
      required_load_hours = p_required_load_hours,
      rank_label_ar = COALESCE(p_rank_label_ar, rank_label_ar),
      rank_aliases = COALESCE(p_rank_aliases, rank_aliases),
      min_load_hours = p_min_load_hours,
      max_load_hours = p_max_load_hours,
      overload_allowed = COALESCE(p_overload_allowed, false),
      notes = COALESCE(p_notes, notes),
      active = true
    WHERE id = v_row.id
    RETURNING * INTO v_row;
  ELSE
    INSERT INTO public.faculty_workload_policies (
      college_id, rank_code, rank_label_ar, rank_aliases,
      required_load_hours, min_load_hours, max_load_hours,
      overload_allowed, study_system, term_id, notes, active
    ) VALUES (
      p_college_id, p_rank_code, p_rank_label_ar, COALESCE(p_rank_aliases, '{}'::text[]),
      p_required_load_hours, p_min_load_hours, p_max_load_hours,
      COALESCE(p_overload_allowed, false), p_study_system, p_term_id, p_notes, true
    )
    RETURNING * INTO v_row;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    'faculty_workload_policy_upsert',
    'faculty_workload_policies',
    v_row.id,
    p_college_id,
    jsonb_build_object(
      'revision_kind', v_kind,
      'rank_code', p_rank_code,
      'study_system', p_study_system,
      'term_id', p_term_id,
      'required_load_hours', p_required_load_hours,
      'min_load_hours', p_min_load_hours,
      'max_load_hours', p_max_load_hours,
      'overload_allowed', COALESCE(p_overload_allowed, false)
    )
  );

  RETURN jsonb_build_object('ok', true, 'action', v_kind, 'policy', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_faculty_workload_policy(uuid, text, numeric, text, text[], text, uuid, numeric, numeric, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_faculty_workload_policy(uuid, text, numeric, text, text[], text, uuid, numeric, numeric, boolean, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.upsert_faculty_workload_policy(uuid, text, numeric, text, text[], text, uuid, numeric, numeric, boolean, text) IS
  'A3: gated upsert of a faculty workload policy row (grain: college + rank + study_system + term). can_manage_college. Audited. Only write path (direct table writes revoked).';

-- ---------------------------------------------------------------------------
-- 5) deactivate_faculty_workload_policy (audited, manage-gated)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deactivate_faculty_workload_policy(
  p_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.faculty_workload_policies%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required');
  END IF;

  SELECT * INTO v_row FROM public.faculty_workload_policies WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'POLICY_NOT_FOUND', 'message', 'Policy not found');
  END IF;
  IF NOT public.can_manage_college(v_uid, v_row.college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College management permission required');
  END IF;
  IF NOT v_row.active THEN
    RETURN jsonb_build_object('ok', true, 'action', 'already_inactive', 'policy_id', v_row.id);
  END IF;

  UPDATE public.faculty_workload_policies SET
    active = false,
    notes = COALESCE(p_notes, notes)
  WHERE id = p_id
  RETURNING * INTO v_row;

  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
  VALUES (
    v_uid,
    'faculty_workload_policy_deactivated',
    'faculty_workload_policies',
    v_row.id,
    v_row.college_id,
    jsonb_build_object('rank_code', v_row.rank_code, 'study_system', v_row.study_system, 'term_id', v_row.term_id)
  );

  RETURN jsonb_build_object('ok', true, 'action', 'deactivated', 'policy', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.deactivate_faculty_workload_policy(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_faculty_workload_policy(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.deactivate_faculty_workload_policy(uuid, text) IS
  'A3: soft deactivate a workload policy (active=false). Preserves history. can_manage_college. Audited.';

-- ---------------------------------------------------------------------------
-- 6) resolve_faculty_workload_policy (read-only)
-- Resolution order: active policy matching instructor academic_rank (rank_code
-- or rank_aliases, case-insensitive), preferring exact term match, then exact
-- study-system match, then lowest rank_code. NULL-scoped policies are wildcards.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_faculty_workload_policy(
  p_instructor_id uuid,
  p_term_id uuid DEFAULT NULL,
  p_study_system text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_instructor public.instructors%ROWTYPE;
  v_policy public.faculty_workload_policies%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required');
  END IF;
  SELECT * INTO v_instructor FROM public.instructors WHERE id = p_instructor_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INSTRUCTOR_NOT_FOUND', 'message', 'Instructor not found');
  END IF;
  IF NOT public.can_view_college(v_uid, v_instructor.college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College view permission required');
  END IF;

  SELECT * INTO v_policy
  FROM public.faculty_workload_policies fwp
  WHERE fwp.college_id = v_instructor.college_id
    AND fwp.active = true
    AND (
      lower(fwp.rank_code) = lower(COALESCE(v_instructor.academic_rank, ''))
      OR EXISTS (
        SELECT 1 FROM unnest(fwp.rank_aliases) a
        WHERE lower(a) = lower(COALESCE(v_instructor.academic_rank, ''))
      )
    )
    AND (p_study_system IS NULL OR fwp.study_system IS NULL OR fwp.study_system = p_study_system)
    AND (p_term_id IS NULL OR fwp.term_id IS NULL OR fwp.term_id = p_term_id)
  ORDER BY (fwp.term_id IS NOT NULL AND fwp.term_id = p_term_id)::int DESC,
           (fwp.study_system IS NOT NULL AND fwp.study_system = p_study_system)::int DESC,
           fwp.rank_code
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'policy_missing', true, 'policy', NULL);
  END IF;
  RETURN jsonb_build_object('ok', true, 'policy_missing', false, 'policy', to_jsonb(v_policy));
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_faculty_workload_policy(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_faculty_workload_policy(uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.resolve_faculty_workload_policy(uuid, uuid, text) IS
  'A3: read-only policy resolution for an instructor (rank/alias match, term + study-system specificity). can_view_college.';

-- ---------------------------------------------------------------------------
-- 7) list_faculty_workload_assigned_hours (read-only assigned-hours aggregation)
-- Aggregates verified PHASE-9.3/9.4 source public.v_instructor_delivery_workload
-- (teaching_assignments V2, active-only) per instructor and joins the resolved policy.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_faculty_workload_assigned_hours(
  p_college_id uuid,
  p_term_id uuid DEFAULT NULL,
  p_study_system text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.can_view_college(v_uid, p_college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College view permission required');
  END IF;

  SELECT COALESCE(jsonb_agg(x.row_obj ORDER BY x.full_name), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT
      i.full_name,
      jsonb_build_object(
        'instructor_id', i.id,
        'full_name', i.full_name,
        'employee_number', i.employee_number,
        'academic_rank', i.academic_rank,
        'standard_assigned_hours', COALESCE(SUM(w.standard_assigned_hours), 0),
        'project_supervision_hours', COALESCE(SUM(w.project_supervision_hours), 0),
        'policy_id', pol.id,
        'policy_missing', pol.id IS NULL,
        'required_load_hours', pol.required_load_hours,
        'min_load_hours', pol.min_load_hours,
        'max_load_hours', pol.max_load_hours,
        'overload_allowed', COALESCE(pol.overload_allowed, false),
        'status', CASE
          WHEN pol.id IS NULL THEN 'policy_missing'
          WHEN COALESCE(SUM(w.standard_assigned_hours), 0) = 0 THEN 'unassigned'
          WHEN pol.max_load_hours IS NOT NULL
               AND COALESCE(SUM(w.standard_assigned_hours), 0) > pol.max_load_hours THEN 'over_max'
          WHEN COALESCE(SUM(w.standard_assigned_hours), 0) > pol.required_load_hours THEN 'overload'
          WHEN pol.min_load_hours IS NOT NULL
               AND COALESCE(SUM(w.standard_assigned_hours), 0) < pol.min_load_hours THEN 'below_min'
          WHEN COALESCE(SUM(w.standard_assigned_hours), 0) < pol.required_load_hours THEN 'deficit'
          ELSE 'ok'
        END
      ) AS row_obj
    FROM public.instructors i
    LEFT JOIN public.v_instructor_delivery_workload w
      ON w.instructor_id = i.id
     AND w.college_id = i.college_id
     AND (p_term_id IS NULL OR w.term_id = p_term_id)
    LEFT JOIN public.academic_cohorts ac
      ON ac.id = w.cohort_id
    LEFT JOIN LATERAL (
      SELECT fwp.id, fwp.required_load_hours, fwp.min_load_hours, fwp.max_load_hours, fwp.overload_allowed
      FROM public.faculty_workload_policies fwp
      WHERE fwp.college_id = i.college_id
        AND fwp.active = true
        AND (
          lower(fwp.rank_code) = lower(COALESCE(i.academic_rank, ''))
          OR EXISTS (
            SELECT 1 FROM unnest(fwp.rank_aliases) a
            WHERE lower(a) = lower(COALESCE(i.academic_rank, ''))
          )
        )
        AND (p_study_system IS NULL OR fwp.study_system IS NULL OR fwp.study_system = p_study_system)
        AND (p_term_id IS NULL OR fwp.term_id IS NULL OR fwp.term_id = p_term_id)
      ORDER BY (fwp.term_id IS NOT NULL AND fwp.term_id = p_term_id)::int DESC,
               (fwp.study_system IS NOT NULL AND fwp.study_system = p_study_system)::int DESC,
               fwp.rank_code
      LIMIT 1
    ) pol ON TRUE
    WHERE i.college_id = p_college_id
      AND i.is_active = true
      AND (p_study_system IS NULL OR ac.study_system IS NULL OR ac.study_system = p_study_system)
    GROUP BY i.id, i.full_name, i.employee_number, i.academic_rank,
             pol.id, pol.required_load_hours, pol.min_load_hours, pol.max_load_hours, pol.overload_allowed
  ) x;

  RETURN jsonb_build_object(
    'ok', true,
    'college_id', p_college_id,
    'term_id', p_term_id,
    'study_system', p_study_system,
    'rows', v_rows,
    'can_manage', public.can_manage_college(v_uid, p_college_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_faculty_workload_assigned_hours(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_faculty_workload_assigned_hours(uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_faculty_workload_assigned_hours(uuid, uuid, text) IS
  'A3: read-only per-instructor assigned-hours aggregation from v_instructor_delivery_workload (teaching_assignments V2) + resolved policy + status. can_view_college.';

-- ---------------------------------------------------------------------------
-- 8) list_faculty_workload_overload_warnings (read-only warning helper)
-- Advisory only: overload is a warning, never a hard write block (PHASE-9.4 doctrine).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_faculty_workload_overload_warnings(
  p_college_id uuid,
  p_term_id uuid DEFAULT NULL,
  p_study_system text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_summary jsonb;
  v_warnings jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.can_view_college(v_uid, p_college_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College view permission required');
  END IF;

  v_summary := public.list_faculty_workload_assigned_hours(p_college_id, p_term_id, p_study_system);

  SELECT COALESCE(jsonb_agg(warning ORDER BY (warning->>'full_name')), '[]'::jsonb)
    INTO v_warnings
  FROM (
    SELECT jsonb_build_object(
      'instructor_id', r->>'instructor_id',
      'full_name', r->>'full_name',
      'employee_number', r->>'employee_number',
      'academic_rank', r->>'academic_rank',
      'warning_code', CASE r->>'status'
        WHEN 'over_max' THEN 'WORKLOAD_OVER_MAX'
        WHEN 'overload' THEN 'WORKLOAD_OVERLOAD'
        WHEN 'below_min' THEN 'WORKLOAD_BELOW_MIN'
        WHEN 'deficit' THEN 'WORKLOAD_DEFICIT'
        WHEN 'unassigned' THEN 'WORKLOAD_UNASSIGNED'
        ELSE 'POLICY_MISSING'
      END,
      'status', r->>'status',
      'standard_assigned_hours', (r->>'standard_assigned_hours')::numeric,
      'required_load_hours', (r->>'required_load_hours')::numeric,
      'min_load_hours', (r->>'min_load_hours')::numeric,
      'max_load_hours', (r->>'max_load_hours')::numeric,
      'overload_allowed', COALESCE((r->>'overload_allowed')::boolean, false),
      'blocking', CASE
        WHEN r->>'status' = 'over_max' THEN true
        WHEN r->>'status' = 'overload' AND NOT COALESCE((r->>'overload_allowed')::boolean, false) THEN true
        ELSE false
      END
    ) AS warning
    FROM jsonb_array_elements(v_summary->'rows') r
    WHERE r->>'status' <> 'ok'
  ) z;

  RETURN jsonb_build_object(
    'ok', true,
    'college_id', p_college_id,
    'term_id', p_term_id,
    'study_system', p_study_system,
    'warnings', v_warnings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_faculty_workload_overload_warnings(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_faculty_workload_overload_warnings(uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_faculty_workload_overload_warnings(uuid, uuid, text) IS
  'A3: read-only overload/deficit/policy warnings per instructor. Advisory (blocking flag marks manager attention, not a write block). can_view_college.';

COMMIT;

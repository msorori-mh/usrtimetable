-- SOURCE ONLY — NOT APPLIED — requires 20260721180000 (headcount) applied first; gate APPROVE_DB_MIGRATION_APPLY.
-- A2.1 Shared lecture groups (domain model). This file is intentionally not applied by this change.
-- A shared lecture group links multiple cohort courses (delivery groups) at the
-- plan_course_components level so one session can serve several cohorts while
-- every cohort keeps its own independent course (no academic merging).
--
-- Apply prerequisites (also currently NOT APPLIED on Production until approved):
--   20260717050000_source_only_harden_cross_college_references.sql
--     provides UNIQUE(id, college_id) on academic_terms / academic_cohorts /
--     plan_course_components used by the composite FKs below.
--   20260721180000_source_only_scheduling_headcount_foundation.sql
--     provides public.scheduling_cohort_term_headcounts whose approved
--     scheduling_headcount rows are SUMMED for group capacity (fail-closed).
-- No DML against operational business rows. No seed defaults. No invented headcounts.

CREATE TABLE public.shared_lecture_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  term_id uuid NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shared_lecture_groups_id_college_key UNIQUE (id, college_id),
  CONSTRAINT shared_lecture_groups_term_college_fkey
    FOREIGN KEY (term_id, college_id) REFERENCES public.academic_terms(id, college_id) ON DELETE RESTRICT
);

CREATE TABLE public.shared_lecture_group_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  group_id uuid NOT NULL,
  plan_course_component_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shared_group_components_group_component_key UNIQUE (group_id, plan_course_component_id),
  CONSTRAINT shared_group_components_group_college_fkey
    FOREIGN KEY (group_id, college_id) REFERENCES public.shared_lecture_groups(id, college_id) ON DELETE RESTRICT,
  CONSTRAINT shared_group_components_component_college_fkey
    FOREIGN KEY (plan_course_component_id, college_id) REFERENCES public.plan_course_components(id, college_id) ON DELETE RESTRICT
);

CREATE TABLE public.shared_lecture_group_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  group_id uuid NOT NULL,
  cohort_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shared_group_cohorts_group_cohort_key UNIQUE (group_id, cohort_id),
  CONSTRAINT shared_group_cohorts_group_college_fkey
    FOREIGN KEY (group_id, college_id) REFERENCES public.shared_lecture_groups(id, college_id) ON DELETE RESTRICT,
  CONSTRAINT shared_group_cohorts_cohort_college_fkey
    FOREIGN KEY (cohort_id, college_id) REFERENCES public.academic_cohorts(id, college_id) ON DELETE RESTRICT
);

CREATE TABLE public.shared_lecture_group_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT,
  group_id uuid NOT NULL REFERENCES public.shared_lecture_groups(id) ON DELETE RESTRICT,
  revision_kind text NOT NULL CHECK (revision_kind IN ('create', 'add_component', 'add_cohort', 'remove_cohort')),
  snapshot jsonb NOT NULL,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE INDEX shared_lecture_group_revisions_group_changed_idx
  ON public.shared_lecture_group_revisions (group_id, changed_at DESC);
CREATE INDEX shared_lecture_group_cohorts_group_idx
  ON public.shared_lecture_group_cohorts (group_id);
CREATE INDEX shared_lecture_group_components_group_idx
  ON public.shared_lecture_group_components (group_id);

CREATE TRIGGER trg_shared_lecture_groups_updated
  BEFORE UPDATE ON public.shared_lecture_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.shared_lecture_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_lecture_group_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_lecture_group_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_lecture_group_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY shared_lecture_groups_select ON public.shared_lecture_groups
  FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY shared_lecture_group_components_select ON public.shared_lecture_group_components
  FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY shared_lecture_group_cohorts_select ON public.shared_lecture_group_cohorts
  FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));
CREATE POLICY shared_lecture_group_revisions_select ON public.shared_lecture_group_revisions
  FOR SELECT TO authenticated USING (public.can_view_college(auth.uid(), college_id));

-- Writes happen only through the SECURITY DEFINER RPCs below.
GRANT SELECT ON public.shared_lecture_groups, public.shared_lecture_group_components,
  public.shared_lecture_group_cohorts, public.shared_lecture_group_revisions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.shared_lecture_groups,
  public.shared_lecture_group_components, public.shared_lecture_group_cohorts,
  public.shared_lecture_group_revisions FROM authenticated, anon, PUBLIC;
GRANT ALL ON public.shared_lecture_groups, public.shared_lecture_group_components,
  public.shared_lecture_group_cohorts, public.shared_lecture_group_revisions TO service_role;

CREATE OR REPLACE FUNCTION public.create_shared_lecture_group(
  p_college_id uuid, p_term_id uuid, p_name text, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_term public.academic_terms%ROWTYPE;
  v_row public.shared_lecture_groups%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  -- college_admin within own college; super_admin passes via can_manage_college.
  IF NOT public.can_manage_college(v_uid, p_college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College management permission required'); END IF;
  SELECT * INTO v_term FROM public.academic_terms WHERE id = p_term_id AND college_id = p_college_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'TERM_NOT_FOUND', 'message', 'Term must belong to the college'); END IF;
  IF NULLIF(btrim(p_name), '') IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NAME_REQUIRED', 'message', 'Group name is required'); END IF;
  INSERT INTO public.shared_lecture_groups (college_id, term_id, name, notes, created_by)
    VALUES (p_college_id, p_term_id, btrim(p_name), p_notes, v_uid)
    RETURNING * INTO v_row;
  INSERT INTO public.shared_lecture_group_revisions (college_id, group_id, revision_kind, snapshot, changed_by, notes)
    VALUES (v_row.college_id, v_row.id, 'create', to_jsonb(v_row), v_uid, p_notes);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'shared_lecture_group_create', 'shared_lecture_groups', v_row.id, v_row.college_id, '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'group', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.add_component_to_shared_lecture_group(
  p_group_id uuid, p_plan_course_component_id uuid, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_group public.shared_lecture_groups%ROWTYPE;
  v_component_college uuid; v_row public.shared_lecture_group_components%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  SELECT * INTO v_group FROM public.shared_lecture_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Shared lecture group not found'); END IF;
  IF NOT public.can_manage_college(v_uid, v_group.college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College management permission required'); END IF;
  IF v_group.status = 'archived' THEN RETURN jsonb_build_object('ok', false, 'code', 'GROUP_ARCHIVED', 'message', 'Archived groups cannot be modified'); END IF;
  SELECT college_id INTO v_component_college FROM public.plan_course_components WHERE id = p_plan_course_component_id;
  IF v_component_college IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'COMPONENT_NOT_FOUND', 'message', 'Plan course component not found'); END IF;
  -- Tenant-composite FKs keep component linkage same-college in A2.1. Linkage is at
  -- plan_course_components level so theory components may merge while labs stay separate.
  IF v_component_college <> v_group.college_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'COLLEGE_MISMATCH', 'blocker', true, 'message', 'Component must belong to the group college');
  END IF;
  INSERT INTO public.shared_lecture_group_components (college_id, group_id, plan_course_component_id)
    VALUES (v_group.college_id, p_group_id, p_plan_course_component_id)
    ON CONFLICT (group_id, plan_course_component_id) DO NOTHING
    RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'COMPONENT_ALREADY_LINKED', 'message', 'Component is already linked to this group'); END IF;
  INSERT INTO public.shared_lecture_group_revisions (college_id, group_id, revision_kind, snapshot, changed_by, notes)
    VALUES (v_row.college_id, p_group_id, 'add_component', to_jsonb(v_row), v_uid, p_notes);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'shared_lecture_group_add_component', 'shared_lecture_group_components', v_row.id, v_row.college_id, jsonb_build_object('group_id', p_group_id));
  RETURN jsonb_build_object('ok', true, 'component_link', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.add_cohort_to_shared_lecture_group(
  p_group_id uuid, p_cohort_id uuid, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_group public.shared_lecture_groups%ROWTYPE;
  v_cohort public.academic_cohorts%ROWTYPE; v_head public.scheduling_cohort_term_headcounts%ROWTYPE;
  v_existing_system text; v_row public.shared_lecture_group_cohorts%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  SELECT * INTO v_group FROM public.shared_lecture_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Shared lecture group not found'); END IF;
  IF NOT public.can_manage_college(v_uid, v_group.college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College management permission required'); END IF;
  IF v_group.status = 'archived' THEN RETURN jsonb_build_object('ok', false, 'code', 'GROUP_ARCHIVED', 'message', 'Archived groups cannot be modified'); END IF;
  SELECT * INTO v_cohort FROM public.academic_cohorts WHERE id = p_cohort_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'COHORT_NOT_FOUND', 'message', 'Cohort not found'); END IF;
  IF v_cohort.college_id <> v_group.college_id THEN
    -- Cross-college merge is a super_admin-only decision. A2.1 keeps memberships
    -- same-college through tenant-composite FKs and fails closed either way;
    -- the super_admin cross-college path is deferred to A2.2.
    IF NOT public.is_super_admin(v_uid) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'CROSS_COLLEGE_REQUIRES_SUPER_ADMIN', 'blocker', true, 'message', 'Cross-college shared groups require super_admin');
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'CROSS_COLLEGE_GROUP_NOT_SUPPORTED', 'blocker', true, 'message', 'Cross-college membership is fail-closed in A2.1 and deferred to A2.2');
  END IF;
  IF v_cohort.term_id <> v_group.term_id THEN RETURN jsonb_build_object('ok', false, 'code', 'COHORT_TERM_MISMATCH', 'message', 'Cohort must belong to the group term'); END IF;
  -- Regular and parallel study systems never merge by default; any mixing is rejected.
  SELECT ac.study_system INTO v_existing_system
  FROM public.shared_lecture_group_cohorts m
  JOIN public.academic_cohorts ac ON ac.id = m.cohort_id
  WHERE m.group_id = p_group_id
  LIMIT 1;
  IF FOUND AND v_existing_system <> v_cohort.study_system THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STUDY_SYSTEM_MIX_REJECTED', 'blocker', true, 'message', 'Cohorts with different study systems (regular/parallel) do not merge by default');
  END IF;
  -- Fail-closed: an approved scheduling headcount must exist for cohort+term
  -- before the cohort may participate in a shared group.
  SELECT * INTO v_head FROM public.scheduling_cohort_term_headcounts
    WHERE cohort_id = p_cohort_id AND term_id = v_group.term_id AND approval_status = 'approved';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SHARED_GROUP_HEADCOUNT_MISSING', 'blocker', true, 'message', 'Approved scheduling headcount is required before joining a shared group');
  END IF;
  INSERT INTO public.shared_lecture_group_cohorts (college_id, group_id, cohort_id)
    VALUES (v_group.college_id, p_group_id, p_cohort_id)
    ON CONFLICT (group_id, cohort_id) DO NOTHING
    RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'COHORT_ALREADY_LINKED', 'message', 'Cohort already participates in this group'); END IF;
  INSERT INTO public.shared_lecture_group_revisions (college_id, group_id, revision_kind, snapshot, changed_by, notes)
    VALUES (v_row.college_id, p_group_id, 'add_cohort',
      jsonb_build_object('membership', to_jsonb(v_row), 'cohort', to_jsonb(v_cohort),
        'headcount_id', v_head.id, 'scheduling_headcount', v_head.scheduling_headcount),
      v_uid, p_notes);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'shared_lecture_group_add_cohort', 'shared_lecture_group_cohorts', v_row.id, v_row.college_id, jsonb_build_object('group_id', p_group_id, 'cohort_id', p_cohort_id));
  RETURN jsonb_build_object('ok', true, 'membership', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.remove_cohort_from_shared_lecture_group(
  p_group_id uuid, p_cohort_id uuid, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_group public.shared_lecture_groups%ROWTYPE;
  v_row public.shared_lecture_group_cohorts%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  SELECT * INTO v_group FROM public.shared_lecture_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Shared lecture group not found'); END IF;
  IF NOT public.can_manage_college(v_uid, v_group.college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College management permission required'); END IF;
  -- Removing a cohort deletes only the membership link. The cohort's own course
  -- and delivery groups stay intact; nothing outside this link table is touched.
  DELETE FROM public.shared_lecture_group_cohorts
    WHERE group_id = p_group_id AND cohort_id = p_cohort_id
    RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'MEMBERSHIP_NOT_FOUND', 'message', 'Cohort does not participate in this group'); END IF;
  INSERT INTO public.shared_lecture_group_revisions (college_id, group_id, revision_kind, snapshot, changed_by, notes)
    VALUES (v_row.college_id, p_group_id, 'remove_cohort', to_jsonb(v_row), v_uid, p_notes);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'shared_lecture_group_remove_cohort', 'shared_lecture_group_cohorts', v_row.id, v_row.college_id, jsonb_build_object('group_id', p_group_id, 'cohort_id', p_cohort_id));
  RETURN jsonb_build_object('ok', true, 'removed_membership', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.resolve_shared_lecture_group_capacity(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_group public.shared_lecture_groups%ROWTYPE;
  v_missing jsonb; v_capacity integer; v_breakdown jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  SELECT * INTO v_group FROM public.shared_lecture_groups WHERE id = p_group_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Shared lecture group not found'); END IF;
  IF NOT public.can_view_college(v_uid, v_group.college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College view permission required'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.shared_lecture_group_cohorts WHERE group_id = p_group_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SHARED_GROUP_NO_COHORTS', 'blocker', true, 'message', 'Group has no participating cohorts');
  END IF;
  -- Fail-closed: every explicitly participating cohort must have an approved
  -- scheduling headcount for the group term; capacity is their SUM.
  SELECT jsonb_agg(jsonb_build_object('cohort_id', m.cohort_id)) INTO v_missing
  FROM public.shared_lecture_group_cohorts m
  WHERE m.group_id = p_group_id AND NOT EXISTS (
    SELECT 1 FROM public.scheduling_cohort_term_headcounts h
    WHERE h.cohort_id = m.cohort_id AND h.term_id = v_group.term_id AND h.approval_status = 'approved'
  );
  IF v_missing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SHARED_GROUP_HEADCOUNT_MISSING', 'blocker', true,
      'missing_cohorts', v_missing,
      'message', 'Approved scheduling headcount is required for every participating cohort');
  END IF;
  SELECT coalesce(sum(h.scheduling_headcount), 0) INTO v_capacity
  FROM public.shared_lecture_group_cohorts m
  JOIN public.scheduling_cohort_term_headcounts h
    ON h.cohort_id = m.cohort_id AND h.term_id = v_group.term_id AND h.approval_status = 'approved'
  WHERE m.group_id = p_group_id;
  SELECT jsonb_agg(jsonb_build_object(
    'cohort_id', m.cohort_id,
    'headcount_id', h.id,
    'scheduling_headcount', h.scheduling_headcount,
    'reserve_margin', h.reserve_margin
  )) INTO v_breakdown
  FROM public.shared_lecture_group_cohorts m
  JOIN public.scheduling_cohort_term_headcounts h
    ON h.cohort_id = m.cohort_id AND h.term_id = v_group.term_id AND h.approval_status = 'approved'
  WHERE m.group_id = p_group_id;
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'shared_lecture_group_capacity_resolve', 'shared_lecture_groups', v_group.id, v_group.college_id,
      jsonb_build_object('capacity', v_capacity));
  RETURN jsonb_build_object('ok', true, 'group_id', v_group.id, 'capacity', v_capacity, 'breakdown', coalesce(v_breakdown, '[]'::jsonb));
END; $$;

CREATE OR REPLACE FUNCTION public.list_shared_lecture_group_revisions(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_college uuid;
BEGIN
  SELECT college_id INTO v_college FROM public.shared_lecture_groups WHERE id = p_group_id;
  IF v_college IS NULL OR v_uid IS NULL OR NOT public.can_view_college(v_uid, v_college) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College view permission required'); END IF;
  RETURN jsonb_build_object('ok', true, 'revisions', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.changed_at DESC) FROM public.shared_lecture_group_revisions r WHERE r.group_id = p_group_id), '[]'::jsonb));
END; $$;

REVOKE ALL ON FUNCTION public.create_shared_lecture_group(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_component_to_shared_lecture_group(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_cohort_to_shared_lecture_group(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_cohort_from_shared_lecture_group(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_shared_lecture_group_capacity(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_shared_lecture_group_revisions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_shared_lecture_group(uuid, uuid, text, text), public.add_component_to_shared_lecture_group(uuid, uuid, text), public.add_cohort_to_shared_lecture_group(uuid, uuid, text), public.remove_cohort_from_shared_lecture_group(uuid, uuid, text), public.resolve_shared_lecture_group_capacity(uuid), public.list_shared_lecture_group_revisions(uuid) TO authenticated, service_role;

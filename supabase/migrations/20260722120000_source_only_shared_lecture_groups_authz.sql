-- SOURCE ONLY — NOT APPLIED — gate APPROVE_DB_MIGRATION_APPLY
-- A2.2 Shared lecture groups: RPC/AuthZ/RLS hardening. This file is intentionally not applied by this change.
-- Stacks on top of 20260722090000_source_only_shared_lecture_groups.sql (A2.1), which it does NOT modify;
-- all A2.1 behavior changes here are forward-hardening via CREATE OR REPLACE FUNCTION / ALTER TABLE.
--
-- Apply prerequisites (also currently NOT APPLIED on Production until approved):
--   20260717050000_source_only_harden_cross_college_references.sql (composite UNIQUE keys;
--   also proves schedule_sessions.plan_course_component_id via ss_component_college_fkey)
--   20260721180000_source_only_scheduling_headcount_foundation.sql (approved scheduling_headcount)
--   20260722090000_source_only_shared_lecture_groups.sql (A2.1 domain model)
-- No DML against operational business rows. No seed defaults. No invented headcounts.
--
-- What A2.2 adds over A2.1:
--   1. Group status lifecycle draft -> active -> locked -> archived via ONE gated RPC
--      (transition_shared_lecture_group_status). Direct UPDATE of status stays revoked.
--   2. remove_component_from_shared_lecture_group with two fail-closed guards:
--      (a) precise session guard — any schedule_sessions row referencing the same
--          plan_course_component_id in the group college blocks unlink in ANY status;
--      (b) draft-only guard — links freeze once the group leaves draft.
--   3. super_admin-only cross-college path (shared_lecture_group_cross_college_cohorts +
--      add/remove RPCs) with mandatory audit (dual-keyed: group college + cohort college);
--      college_admin stays same-college. This path does NOT weaken the A2.1
--      tenant-composite FKs; it is a separate, explicit link table.
--   4. A2.1 membership/component RPCs re-issued with a GROUP_LOCKED guard (locked/archived
--      groups reject all membership and component changes).
--   5. STUDY_SYSTEM_MIX_REJECTED and approved-scheduling_headcount fail-closed guards are
--      extended to the cross-college path and to group activation.

ALTER TABLE public.shared_lecture_groups
  DROP CONSTRAINT IF EXISTS shared_lecture_groups_status_check;
ALTER TABLE public.shared_lecture_groups
  ADD CONSTRAINT shared_lecture_groups_status_check
  CHECK (status IN ('draft', 'active', 'locked', 'archived'));

ALTER TABLE public.shared_lecture_group_revisions
  DROP CONSTRAINT IF EXISTS shared_lecture_group_revisions_revision_kind_check;
ALTER TABLE public.shared_lecture_group_revisions
  ADD CONSTRAINT shared_lecture_group_revisions_revision_kind_check
  CHECK (revision_kind IN (
    'create', 'add_component', 'add_cohort', 'remove_cohort',
    'remove_component', 'status_transition',
    'add_cross_college_cohort', 'remove_cross_college_cohort'
  ));

-- Dedicated super_admin cross-college membership representation. Separate from
-- shared_lecture_group_cohorts so the A2.1 composite same-college FKs stay intact.
CREATE TABLE public.shared_lecture_group_cross_college_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT, -- the GROUP's college (tenant of the row)
  group_id uuid NOT NULL,
  cohort_id uuid NOT NULL REFERENCES public.academic_cohorts(id) ON DELETE RESTRICT, -- any college; super_admin decision
  cohort_college_id uuid NOT NULL REFERENCES public.colleges(id) ON DELETE RESTRICT, -- denormalized for audit/RLS review
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shared_group_xcollege_cohorts_group_cohort_key UNIQUE (group_id, cohort_id),
  CONSTRAINT shared_group_xcollege_cohorts_group_college_fkey
    FOREIGN KEY (group_id, college_id) REFERENCES public.shared_lecture_groups(id, college_id) ON DELETE RESTRICT,
  CONSTRAINT shared_group_xcollege_must_differ_check CHECK (cohort_college_id <> college_id)
);

CREATE INDEX shared_group_xcollege_cohorts_group_idx
  ON public.shared_lecture_group_cross_college_cohorts (group_id);

ALTER TABLE public.shared_lecture_group_cross_college_cohorts ENABLE ROW LEVEL SECURITY;
-- Both the group's college AND the cohort's home college may read the membership row,
-- so the cohort's own college_admin can see that its cohort participates cross-college.
CREATE POLICY shared_group_xcollege_cohorts_select ON public.shared_lecture_group_cross_college_cohorts
  FOR SELECT TO authenticated USING (
    public.can_view_college(auth.uid(), college_id)
    OR public.can_view_college(auth.uid(), cohort_college_id)
  );

GRANT SELECT ON public.shared_lecture_group_cross_college_cohorts TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.shared_lecture_group_cross_college_cohorts FROM authenticated, anon, PUBLIC;
GRANT ALL ON public.shared_lecture_group_cross_college_cohorts TO service_role;

-- Re-assert: no direct status (or any) writes outside the RPC layer.
REVOKE INSERT, UPDATE, DELETE ON public.shared_lecture_groups,
  public.shared_lecture_group_components, public.shared_lecture_group_cohorts,
  public.shared_lecture_group_revisions FROM authenticated, anon, PUBLIC;

-- ---------------------------------------------------------------------------
-- A2.1 RPCs re-issued with GROUP_LOCKED guard (locked/archived reject changes).
-- ---------------------------------------------------------------------------

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
  IF v_group.status = 'locked' THEN RETURN jsonb_build_object('ok', false, 'code', 'GROUP_LOCKED', 'blocker', true, 'message', 'Locked groups cannot be modified'); END IF;
  SELECT college_id INTO v_component_college FROM public.plan_course_components WHERE id = p_plan_course_component_id;
  IF v_component_college IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'COMPONENT_NOT_FOUND', 'message', 'Plan course component not found'); END IF;
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
  IF v_group.status = 'locked' THEN RETURN jsonb_build_object('ok', false, 'code', 'GROUP_LOCKED', 'blocker', true, 'message', 'Locked groups cannot be modified'); END IF;
  SELECT * INTO v_cohort FROM public.academic_cohorts WHERE id = p_cohort_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'COHORT_NOT_FOUND', 'message', 'Cohort not found'); END IF;
  IF v_cohort.college_id <> v_group.college_id THEN
    -- Cross-college membership is a super_admin-only decision and (as of A2.2) uses the
    -- dedicated path add_cross_college_cohort_to_shared_lecture_group, never this RPC.
    IF NOT public.is_super_admin(v_uid) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'CROSS_COLLEGE_REQUIRES_SUPER_ADMIN', 'blocker', true, 'message', 'Cross-college shared groups require super_admin');
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', 'CROSS_COLLEGE_USE_SUPER_ADMIN_PATH', 'blocker', true, 'message', 'Use add_cross_college_cohort_to_shared_lecture_group for cross-college membership');
  END IF;
  IF v_cohort.term_id <> v_group.term_id THEN RETURN jsonb_build_object('ok', false, 'code', 'COHORT_TERM_MISMATCH', 'message', 'Cohort must belong to the group term'); END IF;
  SELECT ac.study_system INTO v_existing_system
  FROM public.shared_lecture_group_cohorts m
  JOIN public.academic_cohorts ac ON ac.id = m.cohort_id
  WHERE m.group_id = p_group_id
  LIMIT 1;
  IF v_existing_system IS NULL THEN
    SELECT ac.study_system INTO v_existing_system
    FROM public.shared_lecture_group_cross_college_cohorts x
    JOIN public.academic_cohorts ac ON ac.id = x.cohort_id
    WHERE x.group_id = p_group_id
    LIMIT 1;
  END IF;
  IF v_existing_system IS NOT NULL AND v_existing_system <> v_cohort.study_system THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STUDY_SYSTEM_MIX_REJECTED', 'blocker', true, 'message', 'Cohorts with different study systems (regular/parallel) do not merge by default');
  END IF;
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
  IF v_group.status = 'archived' THEN RETURN jsonb_build_object('ok', false, 'code', 'GROUP_ARCHIVED', 'message', 'Archived groups cannot be modified'); END IF;
  IF v_group.status = 'locked' THEN RETURN jsonb_build_object('ok', false, 'code', 'GROUP_LOCKED', 'blocker', true, 'message', 'Locked groups cannot be modified'); END IF;
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

-- ---------------------------------------------------------------------------
-- A2.2 new RPCs
-- ---------------------------------------------------------------------------

-- Group status lifecycle: draft -> active -> locked -> archived (archive allowed from any).
-- No rollback transitions. Direct UPDATE of shared_lecture_groups.status stays revoked.
CREATE OR REPLACE FUNCTION public.transition_shared_lecture_group_status(
  p_group_id uuid, p_target_status text, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_group public.shared_lecture_groups%ROWTYPE;
  v_missing jsonb; v_member_count integer; v_component_count integer; v_from_status text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  SELECT * INTO v_group FROM public.shared_lecture_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Shared lecture group not found'); END IF;
  IF NOT public.can_manage_college(v_uid, v_group.college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College management permission required'); END IF;
  IF p_target_status IS NULL OR p_target_status NOT IN ('draft', 'active', 'locked', 'archived') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_STATUS', 'message', 'Target status must be draft, active, locked, or archived');
  END IF;
  IF p_target_status = v_group.status THEN
    -- Intentional no-op: no state change, so no revision/audit row is written.
    RETURN jsonb_build_object('ok', true, 'code', 'NOOP', 'group', to_jsonb(v_group));
  END IF;
  -- Allowed edges only; everything else fails closed.
  IF NOT (
    (v_group.status = 'draft' AND p_target_status IN ('active', 'archived'))
    OR (v_group.status = 'active' AND p_target_status IN ('locked', 'archived'))
    OR (v_group.status = 'locked' AND p_target_status = 'archived')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_STATUS_TRANSITION', 'blocker', true,
      'message', format('Transition %s -> %s is not allowed', v_group.status, p_target_status));
  END IF;
  IF p_target_status = 'active' THEN
    -- Activation is fail-closed: at least one linked component, at least one
    -- participating cohort (same-college or cross-college), and an approved
    -- scheduling headcount for EVERY participating cohort in the group term.
    SELECT count(*) INTO v_component_count FROM public.shared_lecture_group_components WHERE group_id = p_group_id;
    IF v_component_count = 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'SHARED_GROUP_NO_COMPONENTS', 'blocker', true, 'message', 'Group has no linked components');
    END IF;
    SELECT (SELECT count(*) FROM public.shared_lecture_group_cohorts WHERE group_id = p_group_id)
         + (SELECT count(*) FROM public.shared_lecture_group_cross_college_cohorts WHERE group_id = p_group_id)
      INTO v_member_count;
    IF v_member_count = 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'SHARED_GROUP_NO_COHORTS', 'blocker', true, 'message', 'Group has no participating cohorts');
    END IF;
    SELECT jsonb_agg(jsonb_build_object('cohort_id', m.cohort_id)) INTO v_missing
    FROM (
      SELECT cohort_id FROM public.shared_lecture_group_cohorts WHERE group_id = p_group_id
      UNION ALL
      SELECT cohort_id FROM public.shared_lecture_group_cross_college_cohorts WHERE group_id = p_group_id
    ) m
    WHERE NOT EXISTS (
      SELECT 1 FROM public.scheduling_cohort_term_headcounts h
      WHERE h.cohort_id = m.cohort_id AND h.term_id = v_group.term_id AND h.approval_status = 'approved'
    );
    IF v_missing IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'SHARED_GROUP_HEADCOUNT_MISSING', 'blocker', true,
        'missing_cohorts', v_missing,
        'message', 'Approved scheduling headcount is required for every participating cohort before activation');
    END IF;
  END IF;
  v_from_status := v_group.status;
  UPDATE public.shared_lecture_groups SET status = p_target_status WHERE id = p_group_id RETURNING * INTO v_group;
  INSERT INTO public.shared_lecture_group_revisions (college_id, group_id, revision_kind, snapshot, changed_by, notes)
    VALUES (v_group.college_id, p_group_id, 'status_transition',
      jsonb_build_object('from_status', v_from_status, 'to_status', p_target_status, 'group', to_jsonb(v_group)),
      v_uid, p_notes);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'shared_lecture_group_status_transition', 'shared_lecture_groups', v_group.id, v_group.college_id,
      jsonb_build_object('from_status', v_from_status, 'to_status', p_target_status));
  RETURN jsonb_build_object('ok', true, 'group', to_jsonb(v_group));
END; $$;

-- Component unlink with two fail-closed guards:
--   (a) Precise session guard. schedule_sessions.plan_course_component_id EXISTS in the
--       schema (proven by 20260717050000 constraint mapping ss_component_college_fkey:
--       schedule_sessions(plan_course_component_id, college_id) -> plan_course_components(id, college_id)).
--       If any session in the group college references this component, unlink is rejected
--       in ANY status with SHARED_GROUP_COMPONENT_IN_USE.
--   (b) Draft-only guard. Once the group leaves draft its component links are frozen,
--       because the A2.4 builder consumes them; archive the group instead.
CREATE OR REPLACE FUNCTION public.remove_component_from_shared_lecture_group(
  p_group_id uuid, p_plan_course_component_id uuid, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_group public.shared_lecture_groups%ROWTYPE;
  v_row public.shared_lecture_group_components%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  SELECT * INTO v_group FROM public.shared_lecture_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Shared lecture group not found'); END IF;
  IF NOT public.can_manage_college(v_uid, v_group.college_id) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'College management permission required'); END IF;
  -- Guard (a): precise scheduled-session dependency check (any status).
  IF EXISTS (
    SELECT 1 FROM public.schedule_sessions ss
    WHERE ss.plan_course_component_id = p_plan_course_component_id
      AND ss.college_id = v_group.college_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SHARED_GROUP_COMPONENT_IN_USE', 'blocker', true,
      'message', 'Scheduled sessions reference this component in this college; unlink is rejected (fail-closed).');
  END IF;
  -- Guard (b): draft-only unlink.
  IF v_group.status <> 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SHARED_GROUP_COMPONENT_UNLINK_BLOCKED', 'blocker', true,
      'message', 'Component links cannot be removed once the group leaves draft. Archive the group instead.');
  END IF;
  -- Deletes only the link row; plan_course_components and delivery groups are untouched.
  DELETE FROM public.shared_lecture_group_components
    WHERE group_id = p_group_id AND plan_course_component_id = p_plan_course_component_id
    RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'COMPONENT_LINK_NOT_FOUND', 'message', 'Component is not linked to this group'); END IF;
  INSERT INTO public.shared_lecture_group_revisions (college_id, group_id, revision_kind, snapshot, changed_by, notes)
    VALUES (v_row.college_id, p_group_id, 'remove_component', to_jsonb(v_row), v_uid, p_notes);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'shared_lecture_group_remove_component', 'shared_lecture_group_components', v_row.id, v_row.college_id,
      jsonb_build_object('group_id', p_group_id, 'plan_course_component_id', p_plan_course_component_id));
  RETURN jsonb_build_object('ok', true, 'removed_component_link', to_jsonb(v_row));
END; $$;

-- super_admin-only cross-college membership. Audit + revision rows are mandatory on every
-- successful mutation; governance rejections are returned (never raised) as blockers.
-- Audit is dual-keyed: one row on the group's college, one mirror row on the cohort's
-- home college so both colleges can see the cross-college decision in their audit feed.
CREATE OR REPLACE FUNCTION public.add_cross_college_cohort_to_shared_lecture_group(
  p_group_id uuid, p_cohort_id uuid, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_group public.shared_lecture_groups%ROWTYPE;
  v_cohort public.academic_cohorts%ROWTYPE; v_head public.scheduling_cohort_term_headcounts%ROWTYPE;
  v_existing_system text; v_row public.shared_lecture_group_cross_college_cohorts%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  IF NOT public.is_super_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CROSS_COLLEGE_REQUIRES_SUPER_ADMIN', 'blocker', true, 'message', 'Cross-college shared groups require super_admin');
  END IF;
  SELECT * INTO v_group FROM public.shared_lecture_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Shared lecture group not found'); END IF;
  IF v_group.status = 'archived' THEN RETURN jsonb_build_object('ok', false, 'code', 'GROUP_ARCHIVED', 'message', 'Archived groups cannot be modified'); END IF;
  IF v_group.status = 'locked' THEN RETURN jsonb_build_object('ok', false, 'code', 'GROUP_LOCKED', 'blocker', true, 'message', 'Locked groups cannot be modified'); END IF;
  SELECT * INTO v_cohort FROM public.academic_cohorts WHERE id = p_cohort_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'COHORT_NOT_FOUND', 'message', 'Cohort not found'); END IF;
  IF v_cohort.college_id = v_group.college_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'USE_SAME_COLLEGE_PATH', 'message', 'Cohort belongs to the group college; use add_cohort_to_shared_lecture_group');
  END IF;
  IF v_cohort.term_id <> v_group.term_id THEN RETURN jsonb_build_object('ok', false, 'code', 'COHORT_TERM_MISMATCH', 'message', 'Cohort must belong to the group term'); END IF;
  -- Regular/parallel never merge by default, across both membership paths.
  SELECT ac.study_system INTO v_existing_system
  FROM public.shared_lecture_group_cohorts m
  JOIN public.academic_cohorts ac ON ac.id = m.cohort_id
  WHERE m.group_id = p_group_id
  LIMIT 1;
  IF v_existing_system IS NULL THEN
    SELECT ac.study_system INTO v_existing_system
    FROM public.shared_lecture_group_cross_college_cohorts x
    JOIN public.academic_cohorts ac ON ac.id = x.cohort_id
    WHERE x.group_id = p_group_id
    LIMIT 1;
  END IF;
  IF v_existing_system IS NOT NULL AND v_existing_system <> v_cohort.study_system THEN
    RETURN jsonb_build_object('ok', false, 'code', 'STUDY_SYSTEM_MIX_REJECTED', 'blocker', true, 'message', 'Cohorts with different study systems (regular/parallel) do not merge by default');
  END IF;
  -- Fail-closed: approved scheduling headcount for cohort+term is required even for super_admin.
  SELECT * INTO v_head FROM public.scheduling_cohort_term_headcounts
    WHERE cohort_id = p_cohort_id AND term_id = v_group.term_id AND approval_status = 'approved';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SHARED_GROUP_HEADCOUNT_MISSING', 'blocker', true, 'message', 'Approved scheduling headcount is required before joining a shared group');
  END IF;
  INSERT INTO public.shared_lecture_group_cross_college_cohorts (college_id, group_id, cohort_id, cohort_college_id, created_by)
    VALUES (v_group.college_id, p_group_id, p_cohort_id, v_cohort.college_id, v_uid)
    ON CONFLICT (group_id, cohort_id) DO NOTHING
    RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'COHORT_ALREADY_LINKED', 'message', 'Cohort already participates in this group'); END IF;
  INSERT INTO public.shared_lecture_group_revisions (college_id, group_id, revision_kind, snapshot, changed_by, notes)
    VALUES (v_row.college_id, p_group_id, 'add_cross_college_cohort',
      jsonb_build_object('membership', to_jsonb(v_row), 'cohort', to_jsonb(v_cohort),
        'headcount_id', v_head.id, 'scheduling_headcount', v_head.scheduling_headcount),
      v_uid, p_notes);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'shared_lecture_group_add_cross_college_cohort', 'shared_lecture_group_cross_college_cohorts', v_row.id, v_row.college_id,
      jsonb_build_object('group_id', p_group_id, 'cohort_id', p_cohort_id, 'cohort_college_id', v_cohort.college_id));
  -- Mirror audit row keyed by the cohort's home college.
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'shared_lecture_group_add_cross_college_cohort', 'shared_lecture_group_cross_college_cohorts', v_row.id, v_cohort.college_id,
      jsonb_build_object('group_id', p_group_id, 'cohort_id', p_cohort_id, 'group_college_id', v_group.college_id, 'mirror_reason', 'cohort_college_visibility'));
  RETURN jsonb_build_object('ok', true, 'membership', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.remove_cross_college_cohort_from_shared_lecture_group(
  p_group_id uuid, p_cohort_id uuid, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_group public.shared_lecture_groups%ROWTYPE;
  v_row public.shared_lecture_group_cross_college_cohorts%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'AUTH_REQUIRED', 'message', 'Authentication required'); END IF;
  IF NOT public.is_super_admin(v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CROSS_COLLEGE_REQUIRES_SUPER_ADMIN', 'blocker', true, 'message', 'Cross-college shared groups require super_admin');
  END IF;
  SELECT * INTO v_group FROM public.shared_lecture_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Shared lecture group not found'); END IF;
  IF v_group.status = 'archived' THEN RETURN jsonb_build_object('ok', false, 'code', 'GROUP_ARCHIVED', 'message', 'Archived groups cannot be modified'); END IF;
  IF v_group.status = 'locked' THEN RETURN jsonb_build_object('ok', false, 'code', 'GROUP_LOCKED', 'blocker', true, 'message', 'Locked groups cannot be modified'); END IF;
  -- Deletes only the cross-college membership link; the cohort, its course, and its
  -- delivery groups are untouched.
  DELETE FROM public.shared_lecture_group_cross_college_cohorts
    WHERE group_id = p_group_id AND cohort_id = p_cohort_id
    RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'MEMBERSHIP_NOT_FOUND', 'message', 'Cohort does not participate in this group'); END IF;
  INSERT INTO public.shared_lecture_group_revisions (college_id, group_id, revision_kind, snapshot, changed_by, notes)
    VALUES (v_row.college_id, p_group_id, 'remove_cross_college_cohort', to_jsonb(v_row), v_uid, p_notes);
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'shared_lecture_group_remove_cross_college_cohort', 'shared_lecture_group_cross_college_cohorts', v_row.id, v_row.college_id,
      jsonb_build_object('group_id', p_group_id, 'cohort_id', p_cohort_id));
  -- Mirror audit row keyed by the cohort's home college.
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'shared_lecture_group_remove_cross_college_cohort', 'shared_lecture_group_cross_college_cohorts', v_row.id, v_row.cohort_college_id,
      jsonb_build_object('group_id', p_group_id, 'cohort_id', p_cohort_id, 'group_college_id', v_group.college_id, 'mirror_reason', 'cohort_college_visibility'));
  RETURN jsonb_build_object('ok', true, 'removed_membership', to_jsonb(v_row));
END; $$;

-- Capacity = SUM of approved scheduling_headcount over BOTH membership paths. Fail-closed.
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
  IF NOT EXISTS (SELECT 1 FROM public.shared_lecture_group_cohorts WHERE group_id = p_group_id)
     AND NOT EXISTS (SELECT 1 FROM public.shared_lecture_group_cross_college_cohorts WHERE group_id = p_group_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SHARED_GROUP_NO_COHORTS', 'blocker', true, 'message', 'Group has no participating cohorts');
  END IF;
  SELECT jsonb_agg(jsonb_build_object('cohort_id', m.cohort_id)) INTO v_missing
  FROM (
    SELECT cohort_id FROM public.shared_lecture_group_cohorts WHERE group_id = p_group_id
    UNION ALL
    SELECT cohort_id FROM public.shared_lecture_group_cross_college_cohorts WHERE group_id = p_group_id
  ) m
  WHERE NOT EXISTS (
    SELECT 1 FROM public.scheduling_cohort_term_headcounts h
    WHERE h.cohort_id = m.cohort_id AND h.term_id = v_group.term_id AND h.approval_status = 'approved'
  );
  IF v_missing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SHARED_GROUP_HEADCOUNT_MISSING', 'blocker', true,
      'missing_cohorts', v_missing,
      'message', 'Approved scheduling headcount is required for every participating cohort');
  END IF;
  SELECT coalesce(sum(h.scheduling_headcount), 0) INTO v_capacity
  FROM (
    SELECT cohort_id FROM public.shared_lecture_group_cohorts WHERE group_id = p_group_id
    UNION ALL
    SELECT cohort_id FROM public.shared_lecture_group_cross_college_cohorts WHERE group_id = p_group_id
  ) m
  JOIN public.scheduling_cohort_term_headcounts h
    ON h.cohort_id = m.cohort_id AND h.term_id = v_group.term_id AND h.approval_status = 'approved';
  SELECT jsonb_agg(jsonb_build_object(
    'cohort_id', m.cohort_id,
    'membership_kind', m.membership_kind,
    'headcount_id', h.id,
    'scheduling_headcount', h.scheduling_headcount,
    'reserve_margin', h.reserve_margin
  )) INTO v_breakdown
  FROM (
    SELECT cohort_id, 'same_college'::text AS membership_kind FROM public.shared_lecture_group_cohorts WHERE group_id = p_group_id
    UNION ALL
    SELECT cohort_id, 'cross_college'::text AS membership_kind FROM public.shared_lecture_group_cross_college_cohorts WHERE group_id = p_group_id
  ) m
  JOIN public.scheduling_cohort_term_headcounts h
    ON h.cohort_id = m.cohort_id AND h.term_id = v_group.term_id AND h.approval_status = 'approved';
  INSERT INTO public.audit_logs (actor_id, action, entity, entity_id, college_id, details)
    VALUES (v_uid, 'shared_lecture_group_capacity_resolve', 'shared_lecture_groups', v_group.id, v_group.college_id,
      jsonb_build_object('capacity', v_capacity));
  RETURN jsonb_build_object('ok', true, 'group_id', v_group.id, 'capacity', v_capacity, 'breakdown', coalesce(v_breakdown, '[]'::jsonb));
END; $$;

REVOKE ALL ON FUNCTION public.add_component_to_shared_lecture_group(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_cohort_to_shared_lecture_group(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_cohort_from_shared_lecture_group(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_shared_lecture_group_status(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_component_from_shared_lecture_group(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_cross_college_cohort_to_shared_lecture_group(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_cross_college_cohort_from_shared_lecture_group(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_shared_lecture_group_capacity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_component_to_shared_lecture_group(uuid, uuid, text), public.add_cohort_to_shared_lecture_group(uuid, uuid, text), public.remove_cohort_from_shared_lecture_group(uuid, uuid, text), public.transition_shared_lecture_group_status(uuid, text, text), public.remove_component_from_shared_lecture_group(uuid, uuid, text), public.add_cross_college_cohort_to_shared_lecture_group(uuid, uuid, text), public.remove_cross_college_cohort_from_shared_lecture_group(uuid, uuid, text), public.resolve_shared_lecture_group_capacity(uuid) TO authenticated, service_role;

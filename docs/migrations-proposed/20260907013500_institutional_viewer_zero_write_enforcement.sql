-- SOURCE_ONLY_INSTITUTIONAL_VIEWER_RBAC_01 — proposed migration 3 of 3
-- STATUS: NOT APPLIED. File-of-record for review only. When approved, this SQL
-- must be submitted through the platform migration tool (it writes the real
-- supabase/migrations file); do not hand-copy it into supabase/migrations.
--
-- FINAL SCOPE (after two rounds of security review):
--   * NO trigger, NO DO loop, NO per-table enforcement layer.
--   * NO RPC is re-created, re-granted, or re-revoked.
--   * Exactly one new helper function + exactly three write policies.
--
-- Why no RPC work is needed
-- -------------------------
-- The live definitions of the four read surfaces that were previously thought
-- to be blocked
--     public.compute_instructor_standard_workload(uuid, uuid)
--     public.get_delivery_group_assignment_candidates(uuid)
--     public.list_schedule_builder_v2_work_items(uuid, uuid, uuid, uuid, text, text, uuid, text)
--     public.list_teaching_assignment_workspace(uuid, uuid, uuid, uuid, text, uuid, text, text)
-- authorise through public.can_view_college(...) in their access gate.
-- Migration 2 already widened can_view_college to include
-- is_institutional_viewer(...), so the institutional viewer already passes those
-- gates today. The can_manage_college(...) calls inside those functions appear
-- ONLY in the returned write-affordance flags ('can_manage', 'assignable'),
-- which must stay FALSE for the viewer. Re-creating the functions would
-- therefore change nothing except risk drift, so it is dropped entirely.
-- Likewise, resolve_scheduling_headcount and list_scheduling_headcount_revisions
-- already hold the correct EXECUTE grants; nothing to re-grant.
--
-- Why only three write policies
-- -----------------------------
-- A live catalog audit of all 175 write policies in `public` showed every one
-- of them is gated by can_manage_college(...) or is_super_admin(...), both
-- FALSE for the institutional viewer and neither touched here. Exactly three
-- write policies are satisfiable by a plain authenticated user on their own row:
--     profiles.prof_insert  (INSERT, id = auth.uid())
--     profiles.prof_update  (UPDATE, id = auth.uid())
--     audit_logs.al_insert  (INSERT, actor_id = auth.uid())
-- Those three are the whole remaining write surface.
--
-- MULTI-ROLE SAFETY: the exclusion uses is_institutional_read_only_actor(),
-- TRUE only for a user who carries institutional_viewer AND carries neither
-- super_admin nor college_admin. It mirrors isInstitutionalReadOnlyViewer() in
-- src/lib/unauthorized-access.ts.
--
-- can_manage_college is NOT modified by this migration.
-- All SELECT policies, including audit_logs.al_select, are left untouched.

-- 1. Read-only actor predicate (multi-role safe) ------------------------------
CREATE OR REPLACE FUNCTION public.is_institutional_read_only_actor(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT _user_id IS NOT NULL
     AND public.has_role(_user_id, 'institutional_viewer'::public.app_role)
     AND NOT public.is_super_admin(_user_id)
     AND NOT public.has_role(_user_id, 'college_admin'::public.app_role);
$function$;

REVOKE ALL ON FUNCTION public.is_institutional_read_only_actor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_institutional_read_only_actor(uuid) TO authenticated, service_role;

-- 2. The only three self-service write policies -------------------------------
--    Original conditions preserved verbatim; the new term is additive.
DROP POLICY IF EXISTS prof_insert ON public.profiles;
CREATE POLICY prof_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    ((id = auth.uid()) OR public.is_super_admin(auth.uid()))
    AND NOT public.is_institutional_read_only_actor(auth.uid())
  );

DROP POLICY IF EXISTS prof_update ON public.profiles;
CREATE POLICY prof_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    ((id = auth.uid()) OR public.is_super_admin(auth.uid()))
    AND NOT public.is_institutional_read_only_actor(auth.uid())
  )
  WITH CHECK (
    ((id = auth.uid()) OR public.is_super_admin(auth.uid()))
    AND NOT public.is_institutional_read_only_actor(auth.uid())
  );

-- al_insert: migration 2's blanket `NOT is_institutional_viewer(auth.uid())`
-- term is REPLACED, not kept. That term broke multi-role safety by stripping
-- audit-log writes from a super_admin or college_admin who also holds the
-- viewer role. The actor-scoped predicate restores their behaviour while still
-- giving the pure viewer zero writes.
DROP POLICY IF EXISTS al_insert ON public.audit_logs;
CREATE POLICY al_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    (actor_id = auth.uid())
    AND NOT public.is_institutional_read_only_actor(auth.uid())
  );

-- ROLLBACK ------------------------------------------------------------------
-- DROP POLICY IF EXISTS prof_insert ON public.profiles;
-- CREATE POLICY prof_insert ON public.profiles FOR INSERT TO authenticated
--   WITH CHECK ((id = auth.uid()) OR is_super_admin(auth.uid()));
-- DROP POLICY IF EXISTS prof_update ON public.profiles;
-- CREATE POLICY prof_update ON public.profiles FOR UPDATE TO authenticated
--   USING ((id = auth.uid()) OR is_super_admin(auth.uid()))
--   WITH CHECK ((id = auth.uid()) OR is_super_admin(auth.uid()));
-- DROP POLICY IF EXISTS al_insert ON public.audit_logs;
-- CREATE POLICY al_insert ON public.audit_logs FOR INSERT TO authenticated
--   WITH CHECK (actor_id = auth.uid());
-- DROP FUNCTION IF EXISTS public.is_institutional_read_only_actor(uuid);

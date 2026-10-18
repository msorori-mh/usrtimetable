-- L-7: replace the e-mail-based greeting special case in src/lib/viewer-roles.ts
-- with a data-driven, per-user presentation flag. The flag only changes the
-- greeting text; it grants NO permission and is never used for authorization.
--
-- Rollback: supabase/rollbacks/20261025090000_user_feature_flags.down.sql

CREATE TABLE IF NOT EXISTS public.user_feature_flags (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  flag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, flag),
  CONSTRAINT user_feature_flags_known_flag CHECK (flag IN ('omit_leadership_title'))
);

COMMENT ON TABLE public.user_feature_flags IS
  'Per-user presentation flags (no authorization meaning). omit_leadership_title: the university-leadership greeting omits the president title.';

ALTER TABLE public.user_feature_flags ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_feature_flags FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.user_feature_flags TO authenticated;
GRANT ALL ON public.user_feature_flags TO service_role;

DROP POLICY IF EXISTS user_feature_flags_select ON public.user_feature_flags;
CREATE POLICY user_feature_flags_select ON public.user_feature_flags
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.is_super_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS user_feature_flags_insert ON public.user_feature_flags;
CREATE POLICY user_feature_flags_insert ON public.user_feature_flags
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin((SELECT auth.uid())));

DROP POLICY IF EXISTS user_feature_flags_delete ON public.user_feature_flags;
CREATE POLICY user_feature_flags_delete ON public.user_feature_flags
  FOR DELETE TO authenticated
  USING (public.is_super_admin((SELECT auth.uid())));

-- Same session gate as the rest of the platform: nothing is readable while a
-- temporary password change is pending.
DROP POLICY IF EXISTS initial_password_ready ON public.user_feature_flags;
CREATE POLICY initial_password_ready ON public.user_feature_flags
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT NOT public.password_change_required()))
  WITH CHECK ((SELECT NOT public.password_change_required()));

-- The account previously special-cased by e-mail is flagged by an operator after deployment
-- (docs/operations/release-runbook.md, "user feature flags"), so no personal e-mail address
-- is stored in the repository (L-7).

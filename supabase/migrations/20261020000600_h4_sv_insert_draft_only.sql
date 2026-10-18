-- H-4: the sv_insert policy on schedule_versions only checked
-- can_manage_college, so a college manager could INSERT a row directly with
-- status 'published'/'approved' (bypassing the transition workflow and its
-- publish gates) or pre-retired. Direct inserts are restricted to fresh drafts.
-- Clones/disposable test versions go through SECURITY DEFINER RPCs and are not
-- affected by this policy.
DROP POLICY IF EXISTS sv_insert ON public.schedule_versions;
CREATE POLICY sv_insert ON public.schedule_versions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_college((SELECT auth.uid()), college_id)
    AND status = 'draft'
    AND NOT coalesce(disposable_test, false)
    AND retired_at IS NULL
  );

-- Rollback for H-4 (restores the permissive insert policy).
DROP POLICY IF EXISTS sv_insert ON public.schedule_versions;
CREATE POLICY sv_insert ON public.schedule_versions
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_college(auth.uid(), college_id));

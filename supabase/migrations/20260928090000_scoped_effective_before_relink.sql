-- In the originating draft, scope wins immediately, including the interval
-- after assignment insertion and before its sessions are relinked. Other
-- versions select the historical side referenced by their own sessions.
BEGIN;
CREATE OR REPLACE FUNCTION public.version_effective_assignments(p_version uuid)
RETURNS TABLE (assignment_id uuid, delivery_group_id uuid, college_id uuid, assigned_component_hours numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT ta.id,ta.delivery_group_id,ta.college_id,ta.assigned_component_hours
 FROM public.teaching_assignments ta
 WHERE ta.is_active AND CASE
  WHEN EXISTS(SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id=ta.id) THEN
   EXISTS(SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id=ta.id AND s.version_id=p_version)
   OR EXISTS(SELECT 1 FROM public.schedule_sessions x WHERE x.schedule_version_id=p_version AND x.teaching_assignment_id=ta.id)
  ELSE NOT EXISTS(SELECT 1 FROM assignment_version_private.scope s
   WHERE s.replaces_assignment_id=ta.id AND (
    s.version_id=p_version OR (
     EXISTS(SELECT 1 FROM public.schedule_sessions x WHERE x.schedule_version_id=p_version AND x.teaching_assignment_id=s.assignment_id)
     AND NOT EXISTS(SELECT 1 FROM public.schedule_sessions x WHERE x.schedule_version_id=p_version AND x.teaching_assignment_id=ta.id))))
 END
$$;
COMMIT;

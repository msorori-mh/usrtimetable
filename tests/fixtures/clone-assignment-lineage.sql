-- Minimal relational fixture; the baseline function and scope session guard are
-- copied from the official migration definitions, not a reimplementation.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA assignment_version_private;
CREATE SCHEMA schedule_version_delivery_private;
CREATE TABLE public.schedule_versions(id uuid PRIMARY KEY,college_id uuid NOT NULL,academic_term_id uuid NOT NULL,status text NOT NULL);
CREATE TABLE public.teaching_assignments(id uuid PRIMARY KEY,delivery_group_id uuid,college_id uuid,assigned_component_hours numeric,is_active boolean);
CREATE TABLE public.schedule_sessions(id uuid PRIMARY KEY,schedule_version_id uuid REFERENCES public.schedule_versions(id),teaching_assignment_id uuid REFERENCES public.teaching_assignments(id));
CREATE TABLE assignment_version_private.scope(assignment_id uuid PRIMARY KEY REFERENCES public.teaching_assignments(id),version_id uuid NOT NULL REFERENCES public.schedule_versions(id),replaces_assignment_id uuid NOT NULL REFERENCES public.teaching_assignments(id));
CREATE TABLE assignment_version_private.promotions(version_id uuid PRIMARY KEY REFERENCES public.schedule_versions(id));
CREATE TABLE schedule_version_delivery_private.clone_provenance(version_id uuid PRIMARY KEY REFERENCES public.schedule_versions(id),source_version_id uuid NOT NULL REFERENCES public.schedule_versions(id),CHECK(version_id<>source_version_id));
REVOKE ALL ON schedule_version_delivery_private.clone_provenance FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.version_effective_assignments(p_version uuid)
 RETURNS TABLE(assignment_id uuid, delivery_group_id uuid, college_id uuid, assigned_component_hours numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.version_effective_assignments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.version_effective_assignments(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.guard_session_version_scoped_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.teaching_assignment_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM assignment_version_private.scope s
       JOIN public.schedule_versions sv ON sv.id = s.version_id
       JOIN public.schedule_versions nv ON nv.id = NEW.schedule_version_id
       WHERE s.assignment_id = NEW.teaching_assignment_id AND s.version_id <> NEW.schedule_version_id
         AND NOT (EXISTS (SELECT 1 FROM assignment_version_private.promotions p WHERE p.version_id = s.version_id)
                  AND nv.college_id = sv.college_id AND nv.academic_term_id = sv.academic_term_id)) THEN
    RAISE EXCEPTION 'VERSION_SCOPED_ASSIGNMENT_OTHER_VERSION' USING ERRCODE = 'check_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_guard_session_version_scoped_assignment
BEFORE INSERT OR UPDATE OF teaching_assignment_id,schedule_version_id ON public.schedule_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_session_version_scoped_assignment();

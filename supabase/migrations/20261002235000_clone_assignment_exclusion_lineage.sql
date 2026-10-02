-- Preserve exclusions inherited through an official same-college/term clone.
-- The original becomes selectable again when the descendant explicitly references
-- it. Originating scopes retain their existing pre-relink precedence. No data,
-- operational workload predicate, publication guard, or permission is changed.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
DECLARE actual text;
BEGIN
 SELECT regexp_replace(prosrc,'[[:space:]]+','','g') INTO actual
 FROM pg_proc WHERE oid='public.version_effective_assignments(uuid)'::regprocedure;
 IF actual NOT IN (
  regexp_replace($before$ SELECT ta.id,ta.delivery_group_id,ta.college_id,ta.assigned_component_hours
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
$before$,'[[:space:]]+','','g'),
  regexp_replace($after$ WITH RECURSIVE clone_lineage(version_id) AS (
  SELECT v.id FROM public.schedule_versions v WHERE v.id=p_version
  UNION
  SELECT p.source_version_id
  FROM clone_lineage l
  JOIN schedule_version_delivery_private.clone_provenance p ON p.version_id=l.version_id
  JOIN public.schedule_versions child ON child.id=p.version_id
  JOIN public.schedule_versions parent ON parent.id=p.source_version_id
  WHERE child.college_id=parent.college_id
   AND child.academic_term_id=parent.academic_term_id
 )
 SELECT ta.id,ta.delivery_group_id,ta.college_id,ta.assigned_component_hours
 FROM public.teaching_assignments ta
 WHERE ta.is_active AND CASE
  WHEN EXISTS(SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id=ta.id) THEN
   EXISTS(SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id=ta.id AND s.version_id=p_version)
   OR EXISTS(SELECT 1 FROM public.schedule_sessions x WHERE x.schedule_version_id=p_version AND x.teaching_assignment_id=ta.id)
  ELSE NOT EXISTS(SELECT 1 FROM assignment_version_private.scope s
   WHERE s.replaces_assignment_id=ta.id AND (
    s.version_id=p_version OR (
     (EXISTS(SELECT 1 FROM public.schedule_sessions x WHERE x.schedule_version_id=p_version AND x.teaching_assignment_id=s.assignment_id)
      OR EXISTS(SELECT 1 FROM clone_lineage l WHERE l.version_id=s.version_id))
     AND NOT EXISTS(SELECT 1 FROM public.schedule_sessions x WHERE x.schedule_version_id=p_version AND x.teaching_assignment_id=ta.id))))
 END
$after$,'[[:space:]]+','','g')
 ) THEN RAISE EXCEPTION 'VERSION_EFFECTIVE_ASSIGNMENTS_DEFINITION_DRIFT'; END IF;
END $guard$;
CREATE OR REPLACE FUNCTION public.version_effective_assignments(p_version uuid)
RETURNS TABLE(assignment_id uuid,delivery_group_id uuid,college_id uuid,assigned_component_hours numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
 WITH RECURSIVE clone_lineage(version_id) AS (
  SELECT v.id FROM public.schedule_versions v WHERE v.id=p_version
  UNION
  SELECT p.source_version_id
  FROM clone_lineage l
  JOIN schedule_version_delivery_private.clone_provenance p ON p.version_id=l.version_id
  JOIN public.schedule_versions child ON child.id=p.version_id
  JOIN public.schedule_versions parent ON parent.id=p.source_version_id
  WHERE child.college_id=parent.college_id
   AND child.academic_term_id=parent.academic_term_id
 )
 SELECT ta.id,ta.delivery_group_id,ta.college_id,ta.assigned_component_hours
 FROM public.teaching_assignments ta
 WHERE ta.is_active AND CASE
  WHEN EXISTS(SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id=ta.id) THEN
   EXISTS(SELECT 1 FROM assignment_version_private.scope s WHERE s.assignment_id=ta.id AND s.version_id=p_version)
   OR EXISTS(SELECT 1 FROM public.schedule_sessions x WHERE x.schedule_version_id=p_version AND x.teaching_assignment_id=ta.id)
  ELSE NOT EXISTS(SELECT 1 FROM assignment_version_private.scope s
   WHERE s.replaces_assignment_id=ta.id AND (
    s.version_id=p_version OR (
     (EXISTS(SELECT 1 FROM public.schedule_sessions x WHERE x.schedule_version_id=p_version AND x.teaching_assignment_id=s.assignment_id)
      OR EXISTS(SELECT 1 FROM clone_lineage l WHERE l.version_id=s.version_id))
     AND NOT EXISTS(SELECT 1 FROM public.schedule_sessions x WHERE x.schedule_version_id=p_version AND x.teaching_assignment_id=ta.id))))
 END
$function$;
COMMIT;

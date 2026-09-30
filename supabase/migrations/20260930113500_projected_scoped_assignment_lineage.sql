-- Count one effective allocation when previewing a later draft.
BEGIN;
CREATE OR REPLACE FUNCTION assignment_version_private.new_side_wins(p_new uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $$
 SELECT EXISTS (
  SELECT 1 FROM assignment_version_private.scope s
  JOIN assignment_version_private.enabled_versions e ON e.version_id=s.version_id
  JOIN public.schedule_versions sv ON sv.id=s.version_id
  JOIN public.teaching_assignments assignment ON assignment.id=s.assignment_id
  WHERE s.assignment_id=p_new AND assignment_version_private.is_promoted(s.version_id)
   AND NOT EXISTS (
    SELECT 1 FROM public.schedule_versions target
    JOIN assignment_version_private.enabled_versions enabled ON enabled.version_id=target.id
    JOIN public.schedule_sessions target_session ON target_session.schedule_version_id=target.id
    WHERE target.id::text=coalesce(current_setting('app.assume_promoted_version',true),'')
     AND target.id<>s.version_id AND target.status='draft'
     AND target.college_id=sv.college_id AND target.academic_term_id=sv.academic_term_id
     AND target_session.delivery_group_id=assignment.delivery_group_id
     AND target_session.teaching_assignment_id IS DISTINCT FROM s.assignment_id)
   AND NOT EXISTS (
    SELECT 1 FROM public.schedule_versions later
    JOIN assignment_version_private.promotions promoted ON promoted.version_id=s.version_id
    JOIN public.schedule_sessions later_session ON later_session.schedule_version_id=later.id
    WHERE later.status='published' AND later.id<>s.version_id
     AND later.college_id=sv.college_id AND later.academic_term_id=sv.academic_term_id
     AND later.created_at>promoted.promoted_at
     AND later_session.delivery_group_id=assignment.delivery_group_id
     AND later_session.teaching_assignment_id IS DISTINCT FROM s.assignment_id)
 )
$$;
COMMIT;

CREATE OR REPLACE FUNCTION faculty_private.guard_assignment_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE h record; v_request uuid;
BEGIN
 IF NOT NEW.is_active THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND OLD.is_active AND NEW.instructor_id=OLD.instructor_id
  AND NEW.delivery_group_id IS NOT DISTINCT FROM OLD.delivery_group_id AND NEW.college_id=OLD.college_id
  AND NEW.assigned_component_hours IS NOT DISTINCT FROM OLD.assigned_component_hours
  AND NEW.weekly_hours IS NOT DISTINCT FROM OLD.weekly_hours THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(180600,1);
 SELECT hp.* INTO h FROM faculty_private.home_profiles hp JOIN faculty_identity_links l ON l.identity_id=hp.identity_id
 WHERE l.instructor_id=NEW.instructor_id;

 IF EXISTS (
   SELECT 1 FROM schedule_version_delivery_private.instructor_hour_waivers w
   JOIN public.schedule_versions draft ON draft.id=w.version_id
   JOIN public.teaching_assignments src ON src.id=w.source_assignment_id
   JOIN public.delivery_groups target ON target.id=w.group_id
   JOIN public.delivery_groups old_group ON old_group.id=src.delivery_group_id
   JOIN public.schedule_sessions published ON published.teaching_assignment_id=src.id
     AND published.delivery_group_id=src.delivery_group_id
   JOIN public.schedule_versions v2 ON v2.id=published.schedule_version_id
   WHERE w.assignment_id=NEW.id AND w.instructor_id=NEW.instructor_id
     AND w.group_id=NEW.delivery_group_id AND w.college_id=NEW.college_id
     AND draft.status='draft' AND draft.college_id=NEW.college_id
     AND draft.academic_term_id=w.term_id
     AND v2.id='30f8a76d-1cb9-4944-a5d7-483dcaea7692'::uuid
     AND v2.status='published' AND v2.college_id=NEW.college_id
     AND v2.academic_term_id=w.term_id
     AND src.is_active AND src.instructor_id=NEW.instructor_id
     AND src.college_id=NEW.college_id
     AND src.course_offering_id=NEW.course_offering_id
     AND src.cohort_id=NEW.cohort_id
     AND src.plan_course_component_id=NEW.plan_course_component_id
     AND src.session_type=NEW.session_type
     AND src.weekly_hours=NEW.weekly_hours
     AND src.assigned_component_hours IS NOT DISTINCT FROM NEW.assigned_component_hours
     AND src.required_room_type IS NOT DISTINCT FROM NEW.required_room_type
     AND target.cohort_id=old_group.cohort_id
     AND target.component_id=old_group.component_id
     AND target.plan_course_id=old_group.plan_course_id
     AND NOT EXISTS (
       SELECT 1 FROM public.teaching_assignments other
       WHERE other.delivery_group_id=NEW.delivery_group_id
         AND other.is_active AND other.id<>NEW.id AND NOT assignment_version_private.is_replacement_pair(NEW.id,other.id)
         AND (other.instructor_id=NEW.instructor_id OR EXISTS (
           SELECT 1 FROM public.faculty_identity_links a
           JOIN public.faculty_identity_links b ON b.identity_id=a.identity_id
           WHERE a.instructor_id=other.instructor_id AND b.instructor_id=NEW.instructor_id))
     )
 ) THEN RETURN NEW; END IF;
 IF h.home_college_id IS NULL THEN RAISE EXCEPTION 'FACULTY_HOME_REVIEW_REQUIRED'; END IF;
 IF NEW.delivery_group_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM teaching_assignments a JOIN faculty_identity_links l ON l.instructor_id=a.instructor_id
  WHERE a.delivery_group_id=NEW.delivery_group_id AND a.is_active AND a.id<>NEW.id AND l.identity_id=h.identity_id AND NOT assignment_version_private.is_replacement_pair(NEW.id,a.id))
 THEN RAISE EXCEPTION 'DUPLICATE_FACULTY_ASSIGNMENT'; END IF;
 IF h.home_college_id=NEW.college_id THEN RETURN NEW; END IF; IF TG_OP='UPDATE' AND NOT OLD.is_active AND NEW.instructor_id=OLD.instructor_id AND NEW.delivery_group_id IS NOT DISTINCT FROM OLD.delivery_group_id AND NEW.college_id=OLD.college_id AND NEW.assigned_component_hours IS NOT DISTINCT FROM OLD.assigned_component_hours AND NEW.weekly_hours IS NOT DISTINCT FROM OLD.weekly_hours AND EXISTS (SELECT 1 FROM public.schedule_sessions original JOIN public.schedule_versions original_version ON original_version.id=original.schedule_version_id JOIN public.delivery_groups g ON g.id=NEW.delivery_group_id JOIN public.academic_cohorts cohort ON cohort.id=g.cohort_id WHERE original.teaching_assignment_id=NEW.id AND original.delivery_group_id=NEW.delivery_group_id AND original.instructor_id=NEW.instructor_id AND original_version.status='published' AND original_version.academic_term_id=cohort.term_id AND original_version.college_id=NEW.college_id) THEN RETURN NEW; END IF;
 SELECT id INTO v_request FROM faculty_teaching_requests r WHERE r.identity_id=h.identity_id
 AND r.instructor_id=NEW.instructor_id AND r.home_college_id=h.home_college_id AND r.college_id=NEW.college_id
 AND r.delivery_group_id=NEW.delivery_group_id AND r.status='approved'
 AND r.assigned_hours=coalesce(NEW.assigned_component_hours,NEW.weekly_hours)
 AND (r.assignment_id IS NULL OR r.assignment_id=NEW.id)
 AND ((r.decided_by=auth.uid() AND r.decided_at=now()) OR (TG_OP='UPDATE' AND NOT OLD.is_active AND r.assignment_id=NEW.id AND r.decided_at IS NOT NULL AND EXISTS (SELECT 1 FROM public.schedule_sessions original JOIN public.schedule_versions original_version ON original_version.id=original.schedule_version_id WHERE original.teaching_assignment_id=NEW.id AND original.delivery_group_id=NEW.delivery_group_id AND original.instructor_id=NEW.instructor_id AND original_version.status='published' AND original_version.academic_term_id=r.term_id AND original_version.college_id=NEW.college_id))) ORDER BY r.created_at DESC LIMIT 1;
 IF v_request IS NULL THEN RAISE EXCEPTION 'اعتماد التكليف من الكلية الأصلية مطلوب قبل الإسناد'; END IF;
 RETURN NEW;
END $function$;

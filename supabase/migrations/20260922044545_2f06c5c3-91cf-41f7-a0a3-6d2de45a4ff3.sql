CREATE OR REPLACE FUNCTION schedule_coordination_private.check_version(p_version uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v public.schedule_versions%ROWTYPE;
BEGIN
 SELECT * INTO v FROM public.schedule_versions WHERE id=p_version;
 IF NOT FOUND OR v.status='archived' THEN RETURN; END IF;
 IF (v.is_coordination OR v.status='published' OR EXISTS(
   SELECT 1 FROM public.schedule_sessions WHERE schedule_version_id=v.id AND NOT coalesce(replaced_by_split,false)))
 AND EXISTS(SELECT 1 FROM public.academic_terms t WHERE t.id=v.academic_term_id
   AND (t.start_date IS NULL OR t.end_date IS NULL OR t.end_date<t.start_date)) THEN
   RAISE EXCEPTION 'COORDINATION_TERM_DATES_REQUIRED' USING ERRCODE='23514';
 END IF;
 -- Incomplete dates of an external reference must never silently hide a conflict.
 IF EXISTS(SELECT 1 FROM public.schedule_versions o JOIN public.academic_terms t ON t.id=o.academic_term_id
   WHERE o.college_id<>v.college_id AND (o.status='published' OR (o.is_coordination AND o.status IN ('draft','review','approved')))
   AND (t.start_date IS NULL OR t.end_date IS NULL OR t.end_date<t.start_date)
   AND EXISTS(SELECT 1 FROM public.schedule_sessions s JOIN public.schedule_sessions own
     ON faculty_private.same_instructor(own.instructor_id,s.instructor_id) WHERE s.schedule_version_id=o.id AND own.schedule_version_id=v.id
     AND NOT coalesce(s.replaced_by_split,false) AND NOT coalesce(own.replaced_by_split,false))) THEN
   RAISE EXCEPTION 'COORDINATION_TERM_DATES_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_sessions a JOIN public.schedule_sessions b
   ON a.schedule_version_id=b.schedule_version_id AND a.id<b.id AND a.day_of_week=b.day_of_week
   AND a.start_time<b.end_time AND b.start_time<a.end_time
   WHERE a.schedule_version_id=v.id AND NOT coalesce(a.replaced_by_split,false) AND NOT coalesce(b.replaced_by_split,false)
   AND faculty_private.same_instructor(a.instructor_id,b.instructor_id)) THEN
   RAISE EXCEPTION 'FACULTY_IDENTITY_SCHEDULE_CONFLICT' USING ERRCODE='23514';
 END IF;
 -- Cross-college instructor overlap: an approved, version-and-session scoped official
 -- exception waives the report for that specific session only.
 IF EXISTS(SELECT 1 FROM public.schedule_sessions s
   JOIN schedule_coordination_private.busy(v.id) b ON b.instructor_id=s.instructor_id
     AND b.day_of_week=s.day_of_week AND b.start_time<s.end_time AND s.start_time<b.end_time
   WHERE s.schedule_version_id=v.id AND NOT coalesce(s.replaced_by_split,false)
   AND NOT EXISTS(SELECT 1 FROM public.schedule_version_conflict_exceptions e
     WHERE e.schedule_version_id=v.id
       AND e.session_id=s.id
       AND e.status='approved'
       AND e.approval_type='cross_college_instructor'
       AND e.conflict_code IN ('instructor_conflict','cross_college_instructor_conflict'))) THEN
   RAISE EXCEPTION 'CROSS_COLLEGE_INSTRUCTOR_CONFLICT' USING ERRCODE='23514';
 END IF;
END $function$;
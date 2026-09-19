CREATE FUNCTION faculty_private.same_instructor(a uuid,b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT a=b OR EXISTS(SELECT 1 FROM faculty_identity_links x JOIN faculty_identity_links y ON y.identity_id=x.identity_id
 WHERE x.instructor_id=a AND y.instructor_id=b)
$$;
CREATE OR REPLACE FUNCTION schedule_coordination_private.busy(p_version uuid)
 RETURNS TABLE(instructor_id uuid, day_of_week integer, start_time time without time zone, end_time time without time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT DISTINCT coalesce(aliases.instructor_id,who.instructor_id),s.day_of_week::integer,s.start_time,s.end_time
 FROM public.schedule_versions target
 JOIN public.academic_terms tt ON tt.id=target.academic_term_id
 JOIN public.schedule_versions other ON other.college_id<>target.college_id
   AND (other.status='published' OR (other.is_coordination AND other.status IN ('draft','review','approved')))
 JOIN public.academic_terms ot ON ot.id=other.academic_term_id
 JOIN public.schedule_sessions s ON s.schedule_version_id=other.id
 CROSS JOIN LATERAL (SELECT s.instructor_id UNION SELECT unnest(src.instructor_ids)
   FROM public.existing_schedule_source_rows src WHERE src.schedule_session_id=s.id) who
 LEFT JOIN public.faculty_identity_links own_link ON own_link.instructor_id=who.instructor_id
 LEFT JOIN public.faculty_identity_links aliases ON aliases.identity_id=own_link.identity_id
 WHERE target.id=p_version AND NOT coalesce(s.replaced_by_split,false)
   AND tt.start_date<=ot.end_date AND ot.start_date<=tt.end_date
   -- A weekly slot only conflicts when that weekday occurs in the intersection.
   AND greatest(tt.start_date,ot.start_date)
     + ((s.day_of_week-extract(dow FROM greatest(tt.start_date,ot.start_date))::integer+7)%7)
     <=least(tt.end_date,ot.end_date)
$function$;
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
 IF EXISTS(SELECT 1 FROM public.schedule_sessions s
   JOIN schedule_coordination_private.busy(v.id) b ON b.instructor_id=s.instructor_id
     AND b.day_of_week=s.day_of_week AND b.start_time<s.end_time AND s.start_time<b.end_time
   WHERE s.schedule_version_id=v.id AND NOT coalesce(s.replaced_by_split,false)) THEN
   RAISE EXCEPTION 'CROSS_COLLEGE_INSTRUCTOR_CONFLICT' USING ERRCODE='23514';
 END IF;
END $function$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA faculty_private FROM PUBLIC,anon,authenticated;

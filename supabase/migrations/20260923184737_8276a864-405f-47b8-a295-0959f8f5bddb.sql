-- Safeguard: the schedule-session guard calls this helper, but it was only defined
-- in a non-migration script. Idempotent definition, identical body and signature.
CREATE OR REPLACE FUNCTION public.shared_lecture_time_allowed(p_college uuid,p_day integer,p_start time,p_end time)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $fn$
 SELECT bool_and(EXISTS(SELECT 1 FROM public.time_slot_templates t WHERE t.college_id=p_college
   AND t.is_active AND t.day_of_week=p_day AND t.study_system IN(system,'both')
   AND t.start_time<=p_start AND t.end_time>=p_end)) FROM unnest(ARRAY['regular','parallel']) system;
$fn$;
REVOKE ALL ON FUNCTION public.shared_lecture_time_allowed(uuid,integer,time,time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shared_lecture_time_allowed(uuid,integer,time,time) TO authenticated, service_role;
-- Q-2 performance (track C): the cross-college part of public._ss_peer_i evaluated
-- schedule_coordination_private.busy(version) -- every other college's published/coordination
-- session -- once per checked session. Whole-version validation (compute_version_hard_conflicts)
-- checks every session, so the cost grew with (sessions x university sessions).
--
-- Same predicate, restricted to the instructor's faculty identity first (indexed by
-- idx_ss_instructor_day): an external session clashes when its instructor (or an instructor
-- listed on its source row) is the checked instructor or shares a faculty identity with him,
-- in another college's published or coordination version whose term dates overlap and whose
-- weekday occurs in the overlap. This is exactly "p_iid IN busy(version).instructor_id" of
-- schedule_coordination_private.busy, which check_version keeps using unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION public._ss_peer_i(p_sid uuid, p_cid uuid, p_vid uuid, p_iid uuid,
  p_dow integer, p_st time without time zone, p_et time without time zone)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v jsonb:='[]'::jsonb; r record; v_ids uuid[];
BEGIN
 FOR r IN SELECT id FROM public.schedule_sessions
   WHERE college_id=p_cid AND schedule_version_id=p_vid AND id<>p_sid
   AND NOT coalesce(replaced_by_split,false) AND instructor_id=p_iid AND day_of_week=p_dow
   AND start_time<p_et AND p_st<end_time LOOP
   v:=v||jsonb_build_array(public._ss_ci('instructor_conflict','hard',p_sid,r.id,
     jsonb_build_object('instructor_id',p_iid,'day_of_week',p_dow)));
 END LOOP;
 IF auth.uid() IS NOT NULL AND public.can_view_college(auth.uid(),p_cid)
   AND EXISTS(SELECT 1 FROM public.schedule_versions WHERE id=p_vid AND college_id=p_cid)
   AND EXISTS(SELECT 1 FROM public.teaching_assignments WHERE college_id=p_cid AND instructor_id=p_iid AND is_active) THEN
   SELECT array_agg(DISTINCT x) INTO v_ids FROM (
     SELECT p_iid AS x
     UNION SELECT y.instructor_id FROM public.faculty_identity_links l
       JOIN public.faculty_identity_links y ON y.identity_id=l.identity_id
       WHERE l.instructor_id=p_iid) ids;
   IF EXISTS(
     SELECT 1
     FROM public.schedule_versions target
     JOIN public.academic_terms tt ON tt.id=target.academic_term_id
     JOIN public.schedule_versions other ON other.college_id<>target.college_id
       AND (other.status='published' OR (other.is_coordination AND other.status IN ('draft','review','approved')))
     JOIN public.academic_terms ot ON ot.id=other.academic_term_id
     JOIN public.schedule_sessions s ON s.schedule_version_id=other.id
       AND s.day_of_week=p_dow AND s.start_time<p_et AND p_st<s.end_time
     WHERE target.id=p_vid AND NOT coalesce(s.replaced_by_split,false)
       AND tt.start_date<=ot.end_date AND ot.start_date<=tt.end_date
       -- A weekly slot only conflicts when that weekday occurs in the intersection.
       AND greatest(tt.start_date,ot.start_date)
         + ((s.day_of_week-extract(dow FROM greatest(tt.start_date,ot.start_date))::integer+7)%7)
         <=least(tt.end_date,ot.end_date)
       AND (s.instructor_id=ANY(v_ids) OR EXISTS(
         SELECT 1 FROM public.existing_schedule_source_rows src
         WHERE src.schedule_session_id=s.id AND src.instructor_ids && v_ids))) THEN
     v:=v||jsonb_build_array(public._ss_ci('instructor_conflict','hard',p_sid,NULL,
       jsonb_build_object('instructor_id',p_iid,'day_of_week',p_dow,'scope','external')));
   END IF;
 END IF;
 RETURN v;
END $function$;

COMMIT;

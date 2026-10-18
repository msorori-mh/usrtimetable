-- Rollback of 20261021100000_indexed_external_instructor_check.sql: previous busy()-based helper.
BEGIN;
CREATE OR REPLACE FUNCTION public._ss_peer_i(p_sid uuid, p_cid uuid, p_vid uuid, p_iid uuid, p_dow integer, p_st time without time zone, p_et time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v jsonb:='[]'::jsonb; r record;
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
   AND EXISTS(SELECT 1 FROM public.teaching_assignments WHERE college_id=p_cid AND instructor_id=p_iid AND is_active)
   AND EXISTS(SELECT 1 FROM schedule_coordination_private.busy(p_vid) b
     WHERE b.instructor_id=p_iid AND b.day_of_week=p_dow AND b.start_time<p_et AND p_st<b.end_time) THEN
   v:=v||jsonb_build_array(public._ss_ci('instructor_conflict','hard',p_sid,NULL,
     jsonb_build_object('instructor_id',p_iid,'day_of_week',p_dow,'scope','external')));
 END IF;
 RETURN v;
END $function$

;
COMMIT;

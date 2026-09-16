-- Cross-college constraints use canonical instructor IDs and overlapping dated terms.
-- All scheduling writers serialize on a real row, including REPEATABLE READ writers.
-- Final-state constraint triggers preserve atomic multi-session relayouts.
CREATE SCHEMA IF NOT EXISTS schedule_coordination_private;
REVOKE ALL ON SCHEMA schedule_coordination_private FROM PUBLIC, anon, authenticated;
CREATE TABLE schedule_coordination_private.write_gate (
  id boolean PRIMARY KEY DEFAULT true CHECK (id), revision bigint NOT NULL DEFAULT 0
);
ALTER TABLE schedule_coordination_private.write_gate ENABLE ROW LEVEL SECURITY;
INSERT INTO schedule_coordination_private.write_gate(id) VALUES(true);

ALTER TABLE public.schedule_versions ADD COLUMN is_coordination boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX schedule_one_coordination_per_term ON public.schedule_versions(college_id,academic_term_id)
 WHERE is_coordination AND status IN ('draft','review','approved');

CREATE FUNCTION schedule_coordination_private.serialize_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE schedule_coordination_private.write_gate SET revision=revision+1 WHERE id;
 RETURN NULL;
END $$;

CREATE FUNCTION schedule_coordination_private.busy(p_version uuid)
RETURNS TABLE(instructor_id uuid,day_of_week integer,start_time time,end_time time)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT DISTINCT s.instructor_id,s.day_of_week::integer,s.start_time,s.end_time
 FROM public.schedule_versions target
 JOIN public.academic_terms tt ON tt.id=target.academic_term_id
 JOIN public.schedule_versions other ON other.college_id<>target.college_id
   AND (other.status='published' OR (other.is_coordination AND other.status IN ('draft','review','approved')))
 JOIN public.academic_terms ot ON ot.id=other.academic_term_id
 JOIN public.schedule_sessions s ON s.schedule_version_id=other.id
 WHERE target.id=p_version AND NOT coalesce(s.replaced_by_split,false)
   AND tt.start_date<=ot.end_date AND ot.start_date<=tt.end_date
   -- A weekly slot only conflicts when that weekday occurs in the intersection.
   AND greatest(tt.start_date,ot.start_date)
     + ((s.day_of_week-extract(dow FROM greatest(tt.start_date,ot.start_date))::integer+7)%7)
     <=least(tt.end_date,ot.end_date)
$$;

CREATE FUNCTION schedule_coordination_private.check_version(p_version uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
     ON own.instructor_id=s.instructor_id WHERE s.schedule_version_id=o.id AND own.schedule_version_id=v.id
     AND NOT coalesce(s.replaced_by_split,false) AND NOT coalesce(own.replaced_by_split,false))) THEN
   RAISE EXCEPTION 'COORDINATION_TERM_DATES_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_sessions s
   JOIN schedule_coordination_private.busy(v.id) b ON b.instructor_id=s.instructor_id
     AND b.day_of_week=s.day_of_week AND b.start_time<s.end_time AND s.start_time<b.end_time
   WHERE s.schedule_version_id=v.id AND NOT coalesce(s.replaced_by_split,false)) THEN
   RAISE EXCEPTION 'CROSS_COLLEGE_INSTRUCTOR_CONFLICT' USING ERRCODE='23514';
 END IF;
END $$;

CREATE FUNCTION schedule_coordination_private.enforce_final_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v record;
BEGIN
 IF TG_TABLE_NAME='schedule_sessions' THEN
   PERFORM schedule_coordination_private.check_version(NEW.schedule_version_id);
 ELSIF TG_TABLE_NAME='schedule_versions' THEN
   IF EXISTS(SELECT 1 FROM public.schedule_versions WHERE id=NEW.id
     AND (status='published' OR (is_coordination AND status IN ('draft','review','approved')))) THEN
     PERFORM schedule_coordination_private.check_version(NEW.id);
   END IF;
 ELSE
   FOR v IN SELECT id FROM public.schedule_versions WHERE academic_term_id=NEW.id
     AND (status='published' OR (is_coordination AND status IN ('draft','review','approved'))) LOOP
     PERFORM schedule_coordination_private.check_version(v.id);
   END LOOP;
 END IF;
 RETURN NULL;
END $$;

CREATE TRIGGER coordination_serialize_sessions BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_sessions
 FOR EACH STATEMENT EXECUTE FUNCTION schedule_coordination_private.serialize_write();
CREATE TRIGGER coordination_serialize_versions BEFORE INSERT OR UPDATE OR DELETE ON public.schedule_versions
 FOR EACH STATEMENT EXECUTE FUNCTION schedule_coordination_private.serialize_write();
CREATE TRIGGER coordination_serialize_terms BEFORE UPDATE OR DELETE ON public.academic_terms
 FOR EACH STATEMENT EXECUTE FUNCTION schedule_coordination_private.serialize_write();
CREATE CONSTRAINT TRIGGER coordination_sessions_final AFTER INSERT OR UPDATE ON public.schedule_sessions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION schedule_coordination_private.enforce_final_state();
CREATE CONSTRAINT TRIGGER coordination_versions_final AFTER INSERT OR UPDATE ON public.schedule_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION schedule_coordination_private.enforce_final_state();
CREATE CONSTRAINT TRIGGER coordination_terms_final AFTER UPDATE ON public.academic_terms
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION schedule_coordination_private.enforce_final_state();

CREATE FUNCTION public.set_schedule_coordination_version(p_college_id uuid,p_version_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.schedule_versions%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_college(auth.uid(),p_college_id) THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 UPDATE schedule_coordination_private.write_gate SET revision=revision+1 WHERE id;
 SELECT * INTO v FROM public.schedule_versions WHERE id=p_version_id AND college_id=p_college_id FOR UPDATE;
 IF NOT FOUND OR v.status NOT IN ('draft','review','approved') THEN
   RAISE EXCEPTION 'COORDINATION_WORKING_VERSION_REQUIRED' USING ERRCODE='23514';
 END IF;
 UPDATE public.schedule_versions SET is_coordination=false WHERE college_id=p_college_id
   AND academic_term_id=v.academic_term_id AND is_coordination AND status IN ('draft','review','approved') AND id<>v.id;
 UPDATE public.schedule_versions SET is_coordination=true WHERE id=v.id;
 PERFORM schedule_coordination_private.check_version(v.id);
 INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
 VALUES(auth.uid(),'select_coordination_version','schedule_versions',v.id,p_college_id,'{}'::jsonb);
END $$;

CREATE FUNCTION public.get_schedule_external_busy(p_college_id uuid,p_version_id uuid)
RETURNS TABLE(instructor_id uuid,day_of_week integer,start_time time,end_time time)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.can_manage_college(auth.uid(),p_college_id)
   OR NOT EXISTS(SELECT 1 FROM public.schedule_versions WHERE id=p_version_id AND college_id=p_college_id) THEN
   RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.schedule_versions v JOIN public.academic_terms t ON t.id=v.academic_term_id
   WHERE v.id=p_version_id AND (t.start_date IS NULL OR t.end_date IS NULL OR t.end_date<t.start_date))
 OR EXISTS(SELECT 1 FROM public.schedule_versions v JOIN public.academic_terms t ON t.id=v.academic_term_id
   JOIN public.schedule_sessions s ON s.schedule_version_id=v.id AND NOT coalesce(s.replaced_by_split,false)
   WHERE v.college_id<>p_college_id AND (v.status='published' OR (v.is_coordination AND v.status IN ('draft','review','approved')))
   AND (t.start_date IS NULL OR t.end_date IS NULL OR t.end_date<t.start_date)
   AND EXISTS(SELECT 1 FROM public.teaching_assignments a WHERE a.college_id=p_college_id AND a.instructor_id=s.instructor_id AND a.is_active)) THEN
   RAISE EXCEPTION 'COORDINATION_TERM_DATES_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN QUERY SELECT b.* FROM schedule_coordination_private.busy(p_version_id) b
 WHERE EXISTS(SELECT 1 FROM public.teaching_assignments a WHERE a.college_id=p_college_id AND a.instructor_id=b.instructor_id AND a.is_active);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA schedule_coordination_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.set_schedule_coordination_version(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.get_schedule_external_busy(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_schedule_coordination_version(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_schedule_external_busy(uuid,uuid) TO authenticated;

-- Keep the existing local conflict shape; external references never expose a session ID.
CREATE OR REPLACE FUNCTION public._ss_peer_i(p_sid uuid,p_cid uuid,p_vid uuid,p_iid uuid,p_dow integer,p_st time,p_et time)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
END $$;

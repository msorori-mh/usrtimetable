CREATE OR REPLACE FUNCTION public._ss_peer_s(
  p_sid uuid,p_cid uuid,p_vid uuid,p_sec uuid,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; r record; sg uuid;
BEGIN
  IF p_sec IS NULL THEN RETURN v; END IF;
  sg:=public._ss_sg(p_sid);
  FOR r IN
    SELECT id,section_id,section_subgroup_id,day_of_week,start_time,end_time
    FROM public.schedule_sessions
    WHERE college_id=p_cid AND schedule_version_id=p_vid AND id<>p_sid
      AND COALESCE(replaced_by_split,false)=false
      AND section_id=p_sec AND day_of_week=p_dow
  LOOP
    IF public._ss_ov(r.start_time,r.end_time,p_st,p_et)
       AND public._ss_sec_hit(p_sec,r.section_id,sg,r.section_subgroup_id) THEN
      v:=v||jsonb_build_array(public._ss_ci('section_conflict','hard',p_sid,r.id,
        jsonb_build_object('section_id',p_sec,'day_of_week',p_dow)));
    END IF;
  END LOOP;
  RETURN v;
END;$$;
REVOKE ALL ON FUNCTION public._ss_peer_s(uuid,uuid,uuid,uuid,integer,time,time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_peer_s(uuid,uuid,uuid,uuid,integer,time,time) TO service_role;

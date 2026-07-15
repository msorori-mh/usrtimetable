CREATE OR REPLACE FUNCTION public._ss_peer_r(
  p_sid uuid,p_cid uuid,p_vid uuid,p_rid uuid,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; r record;
BEGIN
  IF p_rid IS NULL THEN RETURN v; END IF;
  FOR r IN
    SELECT id,room_id,day_of_week,start_time,end_time FROM public.schedule_sessions
    WHERE college_id=p_cid AND schedule_version_id=p_vid AND id<>p_sid
      AND COALESCE(replaced_by_split,false)=false
      AND room_id=p_rid AND day_of_week=p_dow
  LOOP
    IF public._ss_ov(r.start_time,r.end_time,p_st,p_et) THEN
      v:=v||jsonb_build_array(public._ss_ci('room_conflict','hard',p_sid,r.id,
        jsonb_build_object('room_id',p_rid,'day_of_week',p_dow)));
    END IF;
  END LOOP;
  RETURN v;
END;$$;
REVOKE ALL ON FUNCTION public._ss_peer_r(uuid,uuid,uuid,uuid,integer,time,time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_peer_r(uuid,uuid,uuid,uuid,integer,time,time) TO service_role;
CREATE OR REPLACE FUNCTION public._ss_room_av(
  p_sid uuid,p_cid uuid,p_rid uuid,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; cnt int; fits boolean;
BEGIN
  IF p_rid IS NULL THEN RETURN v; END IF;
  SELECT COUNT(*) INTO cnt FROM public.room_availability
  WHERE room_id=p_rid AND day_of_week=p_dow AND college_id=p_cid;
  IF cnt=0 THEN RETURN v; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.room_availability ra
    WHERE ra.room_id=p_rid AND ra.day_of_week=p_dow AND ra.college_id=p_cid
      AND p_st>=ra.start_time AND p_et<=ra.end_time
  ) INTO fits;
  IF NOT fits THEN
    v:=v||jsonb_build_array(public._ss_ci('room_availability','hard',p_sid,NULL,
      jsonb_build_object('room_id',p_rid,'day_of_week',p_dow)));
  END IF;
  RETURN v;
END;$$;
REVOKE ALL ON FUNCTION public._ss_room_av(uuid,uuid,uuid,integer,time,time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_room_av(uuid,uuid,uuid,integer,time,time) TO service_role;

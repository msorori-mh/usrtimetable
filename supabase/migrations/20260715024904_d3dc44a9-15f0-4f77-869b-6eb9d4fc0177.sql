CREATE OR REPLACE FUNCTION public._ss_room_cap(
  p_sid uuid,p_cid uuid,p_off uuid,p_exp integer,p_rid uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; rm record; n int; st text; item jsonb;
BEGIN
  IF p_rid IS NULL THEN RETURN v; END IF;
  SELECT id,capacity,college_id,is_active INTO rm FROM public.rooms WHERE id=p_rid;
  IF rm.id IS NULL OR rm.college_id<>p_cid OR COALESCE(rm.is_active,true)=false THEN
    RETURN v||jsonb_build_array(public._ss_ci('room_college_mismatch','hard',p_sid,NULL,
      jsonb_build_object('room_id',p_rid)));
  END IF;
  SELECT * INTO n,st FROM public._ss_enroll(p_off,p_exp);
  item:=public._ss_cap(p_sid,st,n,rm.capacity);
  IF item IS NOT NULL THEN v:=v||jsonb_build_array(item); END IF;
  RETURN v;
END;$$;
REVOKE ALL ON FUNCTION public._ss_room_cap(uuid,uuid,uuid,integer,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_room_cap(uuid,uuid,uuid,integer,uuid) TO service_role;
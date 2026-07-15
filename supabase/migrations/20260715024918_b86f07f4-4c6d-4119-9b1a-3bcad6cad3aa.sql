CREATE OR REPLACE FUNCTION public._ss_room_type(
  p_sid uuid,p_cid uuid,p_ta uuid,p_rid uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; req text; rtype text;
BEGIN
  IF p_rid IS NULL OR p_ta IS NULL THEN RETURN v; END IF;
  SELECT required_room_type INTO req FROM public.teaching_assignments
  WHERE id=p_ta AND college_id=p_cid;
  SELECT room_type INTO rtype FROM public.rooms WHERE id=p_rid;
  IF req IS NOT NULL AND rtype IS DISTINCT FROM req THEN
    v:=v||jsonb_build_array(public._ss_ci('room_type_mismatch','hard',p_sid,NULL,
      jsonb_build_object('required_room_type',req,'room_type',rtype,'room_id',p_rid,'teaching_assignment_id',p_ta)));
  END IF;
  RETURN v;
END;$$;
REVOKE ALL ON FUNCTION public._ss_room_type(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_room_type(uuid,uuid,uuid,uuid) TO service_role;
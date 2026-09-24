CREATE OR REPLACE FUNCTION public._ss_iavail_win(
  p_sid uuid,p_cid uuid,p_iid uuid,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; cnt int; fits boolean; blocked boolean;
BEGIN
  SELECT COUNT(*) INTO cnt FROM public.instructor_availability ia
  WHERE ia.instructor_id=p_iid AND ia.day_of_week=p_dow AND ia.is_preference=false AND ia.college_id=p_cid;
  IF cnt=0 THEN RETURN v; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.instructor_availability ia
    WHERE ia.instructor_id=p_iid AND ia.day_of_week=p_dow AND ia.is_preference=false
      AND ia.college_id=p_cid AND ia.availability_type IS DISTINCT FROM 'unavailable'
      AND p_st>=ia.start_time AND p_et<=ia.end_time
  ) INTO fits;
  SELECT EXISTS(
    SELECT 1 FROM public.instructor_availability ia
    WHERE ia.instructor_id=p_iid AND ia.day_of_week=p_dow AND ia.is_preference=false
      AND ia.college_id=p_cid AND ia.availability_type='unavailable'
      AND ia.start_time<p_et AND p_st<ia.end_time
  ) INTO blocked;
  IF (NOT fits) OR blocked THEN
    v:=v||jsonb_build_array(public._ss_ci('instructor_availability','hard',p_sid,NULL,
      jsonb_build_object('instructor_id',p_iid,'day_of_week',p_dow)));
  END IF;
  RETURN v;
END;$$;
REVOKE ALL ON FUNCTION public._ss_iavail_win(uuid,uuid,uuid,integer,time,time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_iavail_win(uuid,uuid,uuid,integer,time,time) TO service_role;

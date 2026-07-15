CREATE OR REPLACE FUNCTION public._ss_iavail_req(
  p_sid uuid,p_cid uuid,p_iid uuid,p_dow integer
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; code text; ext boolean; req boolean; cnt int;
BEGIN
  SELECT it.code,it.is_external INTO code,ext
  FROM public.instructors i LEFT JOIN public.instructor_types it ON it.id=i.instructor_type_id
  WHERE i.id=p_iid;
  req:=(lower(COALESCE(code,''))='from_other_college' OR COALESCE(ext,false));
  SELECT COUNT(*) INTO cnt FROM public.instructor_availability ia
  WHERE ia.instructor_id=p_iid AND ia.day_of_week=p_dow AND ia.is_preference=false AND ia.college_id=p_cid;
  IF cnt=0 AND req THEN
    v:=v||jsonb_build_array(public._ss_ci('instructor_availability_required','hard',p_sid,NULL,
      jsonb_build_object('instructor_id',p_iid,'day_of_week',p_dow)));
  END IF;
  RETURN v;
END;$$;
REVOKE ALL ON FUNCTION public._ss_iavail_req(uuid,uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_iavail_req(uuid,uuid,uuid,integer) TO service_role;

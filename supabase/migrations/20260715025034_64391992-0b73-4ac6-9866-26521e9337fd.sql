CREATE OR REPLACE FUNCTION public._ss_tmpl(
  p_sid uuid,p_cid uuid,p_sys text,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; cnt int; fits boolean;
BEGIN
  SELECT COUNT(*) INTO cnt FROM public.time_slot_templates tt
  WHERE tt.college_id=p_cid AND tt.is_active AND tt.day_of_week=p_dow
    AND (tt.study_system=p_sys OR tt.study_system='both' OR p_sys='both');
  IF cnt=0 THEN RETURN v; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.time_slot_templates tt
    WHERE tt.college_id=p_cid AND tt.is_active AND tt.day_of_week=p_dow
      AND (tt.study_system=p_sys OR tt.study_system='both' OR p_sys='both')
      AND p_st>=tt.start_time AND p_et<=tt.end_time
  ) INTO fits;
  IF NOT fits THEN
    v:=v||jsonb_build_array(public._ss_ci('study_system_time_template','hard',p_sid,NULL,
      jsonb_build_object('study_system',p_sys,'day_of_week',p_dow)));
  END IF;
  RETURN v;
END;$$;
REVOKE ALL ON FUNCTION public._ss_tmpl(uuid,uuid,text,integer,time,time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_tmpl(uuid,uuid,text,integer,time,time) TO service_role;
CREATE OR REPLACE FUNCTION public._ss_set(
  p_sid uuid,p_cid uuid,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; s record;
BEGIN
  SELECT working_days,day_start_time,day_end_time INTO s
  FROM public.scheduling_settings WHERE college_id=p_cid LIMIT 1;
  IF s.working_days IS NOT NULL AND cardinality(s.working_days)>0 AND NOT (p_dow=ANY(s.working_days)) THEN
    v:=v||jsonb_build_array(public._ss_ci('outside_working_days','hard',p_sid,NULL,
      jsonb_build_object('day_of_week',p_dow)));
  END IF;
  IF s.day_start_time IS NOT NULL AND s.day_end_time IS NOT NULL
     AND (p_st<s.day_start_time OR p_et>s.day_end_time) THEN
    v:=v||jsonb_build_array(public._ss_ci('outside_working_hours','hard',p_sid,NULL,
      jsonb_build_object('day_start_time',s.day_start_time,'day_end_time',s.day_end_time)));
  END IF;
  RETURN v;
END;$$;
REVOKE ALL ON FUNCTION public._ss_set(uuid,uuid,integer,time,time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_set(uuid,uuid,integer,time,time) TO service_role;
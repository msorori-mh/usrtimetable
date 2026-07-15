CREATE OR REPLACE FUNCTION public._ss_brk(
  p_sid uuid,p_cid uuid,p_dow integer,p_st time,p_et time
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb:='[]'::jsonb; b record;
BEGIN
  FOR b IN
    SELECT id,name FROM public.daily_breaks
    WHERE college_id=p_cid AND affects_scheduling
      AND p_dow=ANY(days) AND start_time<p_et AND p_st<end_time
  LOOP
    v:=v||jsonb_build_array(public._ss_ci('daily_break','hard',p_sid,NULL,
      jsonb_build_object('daily_break_id',b.id,'name',b.name)));
  END LOOP;
  RETURN v;
END;$$;
REVOKE ALL ON FUNCTION public._ss_brk(uuid,uuid,integer,time,time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_brk(uuid,uuid,integer,time,time) TO service_role;
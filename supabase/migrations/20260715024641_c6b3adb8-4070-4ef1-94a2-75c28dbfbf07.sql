CREATE OR REPLACE FUNCTION public._ss_ci(c text,s text,sid uuid,rid uuid,m jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
SELECT jsonb_build_object('code',c,'severity',s,'schedule_session_id',sid,'related_session_id',rid,'metadata',COALESCE(m,'{}'::jsonb));
$$;
REVOKE ALL ON FUNCTION public._ss_ci(text,text,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_ci(text,text,uuid,uuid,jsonb) TO service_role;
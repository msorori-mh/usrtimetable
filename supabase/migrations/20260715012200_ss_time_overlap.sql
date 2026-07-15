CREATE OR REPLACE FUNCTION public._ss_ov(a time,b time,c time,d time)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
SELECT a < d AND c < b;
$$;
REVOKE ALL ON FUNCTION public._ss_ov(time,time,time,time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_ov(time,time,time,time) TO service_role;

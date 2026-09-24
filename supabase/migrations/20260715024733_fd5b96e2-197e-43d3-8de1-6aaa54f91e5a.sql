CREATE OR REPLACE FUNCTION public._ss_sec_hit(p_sec uuid,p_peer_sec uuid,p_sg uuid,p_peer_sg uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
SELECT p_sec IS NOT NULL AND p_peer_sec IS NOT NULL AND p_sec=p_peer_sec
  AND (p_peer_sg IS NULL OR p_sg IS NULL OR p_peer_sg=p_sg);
$$;
REVOKE ALL ON FUNCTION public._ss_sec_hit(uuid,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_sec_hit(uuid,uuid,uuid,uuid) TO service_role;
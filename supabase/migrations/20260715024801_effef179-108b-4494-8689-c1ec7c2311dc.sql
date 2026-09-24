CREATE OR REPLACE FUNCTION public._ss_cap(sid uuid,st text,n integer,cap integer)
RETURNS jsonb LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=public AS $$
SELECT CASE
 WHEN n>0 AND cap+5<n AND st='confirmed' THEN
  public._ss_ci('room_capacity','hard',sid,NULL,jsonb_build_object('capacity',cap,'expected_students',n,'enrollment_count_status',st))
 WHEN n>0 AND cap+5<n AND st IN ('estimated','unverified','test') THEN
  public._ss_ci('room_capacity_unverified','soft',sid,NULL,jsonb_build_object('capacity',cap,'expected_students',n,'enrollment_count_status',st,'blocking',false))
 ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION public._ss_cap(uuid,text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_cap(uuid,text,integer,integer) TO service_role;
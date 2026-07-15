CREATE OR REPLACE FUNCTION public._ss_enroll(p_off uuid,p_exp integer, OUT n integer, OUT st text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  SELECT COALESCE(expected_students,0), COALESCE(enrollment_count_status,'unverified')
    INTO n,st FROM public.course_offerings WHERE id=p_off;
  IF COALESCE(p_exp,0)>0 THEN n:=p_exp; END IF;
  n:=COALESCE(n,0); st:=COALESCE(st,'unverified');
END;$$;
REVOKE ALL ON FUNCTION public._ss_enroll(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_enroll(uuid,integer) TO service_role;

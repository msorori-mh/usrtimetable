ALTER TABLE public.scheduling_settings
  ADD COLUMN IF NOT EXISTS enforce_instructor_availability boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.instructor_availability_enforced(p_college_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT ss.enforce_instructor_availability
       FROM public.scheduling_settings ss
      WHERE ss.college_id = p_college_id
      LIMIT 1),
    false);
$function$;

REVOKE ALL ON FUNCTION public.instructor_availability_enforced(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.instructor_availability_enforced(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._ss_iavail_req(p_sid uuid, p_cid uuid, p_iid uuid, p_dow integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb:='[]'::jsonb; code text; ext boolean; req boolean; cnt int;
BEGIN
  IF NOT public.instructor_availability_enforced(p_cid) THEN RETURN v; END IF;
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
END;$function$;

CREATE OR REPLACE FUNCTION public._ss_iavail_win(p_sid uuid, p_cid uuid, p_iid uuid, p_dow integer, p_st time without time zone, p_et time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb:='[]'::jsonb; cnt int; fits boolean; blocked boolean;
BEGIN
  IF NOT public.instructor_availability_enforced(p_cid) THEN RETURN v; END IF;
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
END;$function$;
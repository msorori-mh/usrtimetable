-- Report viewers are explicitly college-scoped. Preserve existing assignments;
-- only academic affairs continues to receive current and future colleges.
CREATE OR REPLACE FUNCTION public.assign_all_colleges_to_academic_affairs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.role <> 'institutional_viewer' OR NOT public.is_viewer_only(NEW.user_id) THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.user_colleges (user_id, college_id)
  SELECT NEW.user_id, c.id FROM public.colleges c
  ON CONFLICT (user_id, college_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_new_college_to_academic_affairs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.user_colleges (user_id, college_id)
  SELECT DISTINCT ur.user_id, NEW.id FROM public.user_roles ur
  WHERE ur.role = 'institutional_viewer'
    AND public.is_viewer_only(ur.user_id)
  ON CONFLICT (user_id, college_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

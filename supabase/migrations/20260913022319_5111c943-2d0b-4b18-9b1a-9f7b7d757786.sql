-- Viewer-only accounts (read_only or institutional_viewer, without any admin role)
-- read every college. Admin accounts are never widened by carrying a viewer role.
CREATE OR REPLACE FUNCTION public.is_viewer_only(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM public.user_roles
            WHERE user_id = _user_id
              AND role IN ('read_only', 'institutional_viewer')
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.user_roles
            WHERE user_id = _user_id
              AND role IN ('super_admin', 'college_admin')
         )
$function$;

REVOKE ALL ON FUNCTION public.is_viewer_only(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_viewer_only(uuid) TO authenticated, service_role;

-- Legacy predicate kept for compatibility; now delegates to the viewer rule.
CREATE OR REPLACE FUNCTION public.is_academic_affairs_only(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
           SELECT 1 FROM public.user_roles
            WHERE user_id = _user_id AND role = 'institutional_viewer'
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.user_roles
            WHERE user_id = _user_id AND role IN ('super_admin', 'college_admin')
         )
$function$;

-- Granting a viewer role assigns every existing college (read scope only).
CREATE OR REPLACE FUNCTION public.assign_all_colleges_to_academic_affairs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.role NOT IN ('read_only', 'institutional_viewer') THEN
    RETURN NEW;
  END IF;
  IF NOT public.is_viewer_only(NEW.user_id) THEN
    RETURN NEW; -- admin multi-role account keeps its own scope untouched
  END IF;
  INSERT INTO public.user_colleges (user_id, college_id)
  SELECT NEW.user_id, c.id FROM public.colleges c
  ON CONFLICT (user_id, college_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- A college created later is assigned to every viewer-only account.
CREATE OR REPLACE FUNCTION public.assign_new_college_to_academic_affairs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.user_colleges (user_id, college_id)
  SELECT DISTINCT ur.user_id, NEW.id
    FROM public.user_roles ur
   WHERE ur.role IN ('read_only', 'institutional_viewer')
     AND public.is_viewer_only(ur.user_id)
  ON CONFLICT (user_id, college_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- Trigger-only functions must not be callable by application roles.
REVOKE ALL ON FUNCTION public.assign_all_colleges_to_academic_affairs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_all_colleges_to_academic_affairs() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_new_college_to_academic_affairs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_new_college_to_academic_affairs() FROM anon, authenticated;

-- Backfill: existing viewer-only accounts (including read_only ones) get all colleges.
INSERT INTO public.user_colleges (user_id, college_id)
SELECT DISTINCT ur.user_id, c.id
  FROM public.user_roles ur
 CROSS JOIN public.colleges c
 WHERE ur.role IN ('read_only', 'institutional_viewer')
   AND public.is_viewer_only(ur.user_id)
ON CONFLICT (user_id, college_id) DO NOTHING;
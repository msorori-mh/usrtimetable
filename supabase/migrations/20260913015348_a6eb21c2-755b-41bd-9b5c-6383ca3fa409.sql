-- Academic affairs («إدارة الشؤون الأكاديمية», technical role institutional_viewer)
-- must cover EVERY college, present and future, while staying strictly read-only.
-- Coverage is expressed as ordinary public.user_colleges rows, so the existing
-- read scoping (user_in_college / can_view_college) keeps working unchanged.
-- No write policy, no write privilege and no role check is widened here.

CREATE OR REPLACE FUNCTION public.is_academic_affairs_only(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.user_roles
            WHERE user_id = _user_id AND role = 'institutional_viewer'
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.user_roles
            WHERE user_id = _user_id AND role IN ('super_admin', 'college_admin')
         )
$$;

REVOKE ALL ON FUNCTION public.is_academic_affairs_only(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_academic_affairs_only(uuid) TO authenticated, service_role;

-- A new college becomes visible to every academic-affairs account immediately.
CREATE OR REPLACE FUNCTION public.assign_new_college_to_academic_affairs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.user_colleges (user_id, college_id)
  SELECT DISTINCT ur.user_id, NEW.id
    FROM public.user_roles ur
   WHERE ur.role = 'institutional_viewer'
     AND public.is_academic_affairs_only(ur.user_id)
  ON CONFLICT (user_id, college_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_new_college_to_academic_affairs ON public.colleges;
CREATE TRIGGER trg_assign_new_college_to_academic_affairs
AFTER INSERT ON public.colleges
FOR EACH ROW EXECUTE FUNCTION public.assign_new_college_to_academic_affairs();

-- Granting the role assigns every existing college at once.
CREATE OR REPLACE FUNCTION public.assign_all_colleges_to_academic_affairs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role <> 'institutional_viewer' THEN
    RETURN NEW;
  END IF;
  IF NOT public.is_academic_affairs_only(NEW.user_id) THEN
    RETURN NEW; -- multi-role account keeps its own scope untouched
  END IF;
  INSERT INTO public.user_colleges (user_id, college_id)
  SELECT NEW.user_id, c.id FROM public.colleges c
  ON CONFLICT (user_id, college_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_all_colleges_to_academic_affairs ON public.user_roles;
CREATE TRIGGER trg_assign_all_colleges_to_academic_affairs
AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.assign_all_colleges_to_academic_affairs();

-- Backfill: existing academic-affairs accounts get every existing college.
INSERT INTO public.user_colleges (user_id, college_id)
SELECT DISTINCT ur.user_id, c.id
  FROM public.user_roles ur
 CROSS JOIN public.colleges c
 WHERE ur.role = 'institutional_viewer'
   AND public.is_academic_affairs_only(ur.user_id)
ON CONFLICT (user_id, college_id) DO NOTHING;
-- Academic affairs («إدارة الشؤون الأكاديمية», technical role institutional_viewer)
-- is NOT an institution-wide reader: its read scope is the colleges assigned in
-- public.user_colleges. Narrowing only — no write privilege is granted here.
CREATE OR REPLACE FUNCTION public.can_view_college(_user_id uuid, _college_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_super_admin(_user_id)
      OR public.user_in_college(_user_id, _college_id)
$$;
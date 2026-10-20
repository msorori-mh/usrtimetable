-- L-3: the last super_admin row cannot be deleted/updated away; others can.
BEGIN;
ALTER TABLE public.user_roles DISABLE TRIGGER trg_user_roles_rate_limit;  -- prod-only dependency
ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, email) VALUES
  ('00000012-0000-0000-0000-000000000001', 'l3a@example.invalid'),
  ('00000012-0000-0000-0000-000000000002', 'l3b@example.invalid');
ALTER TABLE auth.users ENABLE TRIGGER USER;
-- start from a clean slate inside the transaction: exactly two super admins
DELETE FROM public.user_roles WHERE role = 'super_admin'
  AND user_id NOT IN ('00000012-0000-0000-0000-000000000001', '00000012-0000-0000-0000-000000000002');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000012-0000-0000-0000-000000000001', 'super_admin'),
  ('00000012-0000-0000-0000-000000000002', 'super_admin');
DO $$
BEGIN
  -- removing one of two is fine
  DELETE FROM public.user_roles WHERE user_id = '00000012-0000-0000-0000-000000000002' AND role = 'super_admin';
  -- last one: delete refused
  BEGIN
    DELETE FROM public.user_roles WHERE role = 'super_admin';
    RAISE EXCEPTION 'L-3: last super admin deleted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'LAST_SUPER_ADMIN' THEN RAISE; END IF;
  END;
  -- last one: demotion refused
  BEGIN
    UPDATE public.user_roles SET role = 'read_only' WHERE role = 'super_admin';
    RAISE EXCEPTION 'L-3: last super admin demoted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'LAST_SUPER_ADMIN' THEN RAISE; END IF;
  END;
  -- cascade from auth.users refused too
  BEGIN
    DELETE FROM auth.users WHERE id = '00000012-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'L-3: last super admin removed via auth.users cascade';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'LAST_SUPER_ADMIN' THEN RAISE; END IF;
  END;
  -- non super-admin rows are unaffected
  INSERT INTO public.user_roles (user_id, role) VALUES ('00000012-0000-0000-0000-000000000002', 'read_only');
  DELETE FROM public.user_roles WHERE user_id = '00000012-0000-0000-0000-000000000002';
END $$;
ROLLBACK;

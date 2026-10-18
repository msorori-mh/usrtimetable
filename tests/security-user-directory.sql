-- L-8: institutional viewers see names + roles only (via list_user_directory),
-- not other users' profiles (emails), user_roles or user_colleges rows.
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) VALUES
  ('00000013-0000-0000-0000-000000000001', 'viewer@example.invalid'),
  ('00000013-0000-0000-0000-000000000002', 'other@example.invalid'),
  ('00000013-0000-0000-0000-000000000003', 'plain@example.invalid'),
  ('00000013-0000-0000-0000-000000000004', 'sa@example.invalid');
INSERT INTO public.profiles (id, email, full_name) VALUES
  ('00000013-0000-0000-0000-000000000001', 'viewer@example.invalid', 'Viewer'),
  ('00000013-0000-0000-0000-000000000002', 'other@example.invalid', 'Other Person'),
  ('00000013-0000-0000-0000-000000000003', 'plain@example.invalid', 'Plain'),
  ('00000013-0000-0000-0000-000000000004', 'sa@example.invalid', 'SA');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000013-0000-0000-0000-000000000001', 'institutional_viewer'),
  ('00000013-0000-0000-0000-000000000002', 'college_admin'),
  ('00000013-0000-0000-0000-000000000003', 'read_only'),
  ('00000013-0000-0000-0000-000000000004', 'super_admin');
INSERT INTO public.colleges (id, university_id, name) VALUES ('00000013-0000-0000-0000-0000000000c1', gen_random_uuid(), 'L8');
INSERT INTO public.user_colleges (user_id, college_id) VALUES
  ('00000013-0000-0000-0000-000000000002', '00000013-0000-0000-0000-0000000000c1');
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
-- institutional viewer
SELECT set_config('request.jwt.claim.sub', '00000013-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000013-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
DO $$
DECLARE r record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = '00000013-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'L-8: viewer reads other profiles (emails)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = '00000013-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'L-8: viewer reads other user_roles';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_colleges WHERE user_id = '00000013-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'L-8: viewer reads other user_colleges';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '00000013-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'L-8: viewer lost own profile';
  END IF;
  SELECT * INTO r FROM public.list_user_directory() WHERE id = '00000013-0000-0000-0000-000000000002';
  IF r.full_name IS DISTINCT FROM 'Other Person' OR r.roles IS DISTINCT FROM ARRAY['college_admin'] THEN
    RAISE EXCEPTION 'L-8: directory row wrong for viewer: %', row_to_json(r);
  END IF;
END $$;
-- the directory exposes exactly id, full_name, roles
DO $$
BEGIN
  IF (SELECT array_agg(a ORDER BY a) FROM unnest(
        (SELECT proargnames FROM pg_proc WHERE oid = 'public.list_user_directory()'::regprocedure)) a)
     IS DISTINCT FROM ARRAY['full_name','id','roles'] THEN
    RAISE EXCEPTION 'L-8: list_user_directory exposes unexpected columns';
  END IF;
END $$;

-- plain user: no rows
SELECT set_config('request.jwt.claim.sub', '00000013-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000013-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2"}', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.list_user_directory()) THEN
    RAISE EXCEPTION 'L-8: directory returned rows to a non-privileged user';
  END IF;
END $$;

-- super admin: still full table access
SELECT set_config('request.jwt.claim.sub', '00000013-0000-0000-0000-000000000004', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000013-0000-0000-0000-000000000004","role":"authenticated","aal":"aal2"}', true);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = '00000013-0000-0000-0000-000000000002' AND email IS NOT NULL)
     OR NOT EXISTS (SELECT 1 FROM public.user_colleges WHERE user_id = '00000013-0000-0000-0000-000000000002')
     OR NOT EXISTS (SELECT 1 FROM public.list_user_directory() WHERE id = '00000013-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'L-8: super admin lost access';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;

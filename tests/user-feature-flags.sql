-- L-7: the greeting special case is data-driven, set by an operator (no e-mail in the repo),
-- readable only by the owner (and super admins) and managed only by super admins.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'leader@example.edu'),
  ('00000000-0000-4000-8000-0000000000a2', 'other@example.edu'),
  ('00000000-0000-4000-8000-0000000000a3', 'admin@example.edu');
-- New accounts are marked must_change_password by a trigger; these fixtures are ready accounts.
UPDATE auth.users SET raw_app_meta_data = jsonb_build_object('must_change_password', false)
WHERE id IN ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2');

-- handle_new_user may auto-grant roles to new accounts: fix the fixture roles explicitly.
DELETE FROM public.user_roles WHERE user_id IN (
  '00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2','00000000-0000-4000-8000-0000000000a3');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'university_leadership'),
  ('00000000-0000-4000-8000-0000000000a2', 'read_only'),
  ('00000000-0000-4000-8000-0000000000a3', 'super_admin');

-- The operator step from the release runbook (flag one account by e-mail).
INSERT INTO public.user_feature_flags (user_id, flag)
SELECT u.id, 'omit_leadership_title' FROM auth.users u
WHERE lower(u.email) = 'leader@example.edu'
ON CONFLICT (user_id, flag) DO NOTHING;

DO $$ BEGIN
  IF (SELECT count(*) FROM public.user_feature_flags
      WHERE user_id = '00000000-0000-4000-8000-0000000000a1' AND flag = 'omit_leadership_title') <> 1 THEN
    RAISE EXCEPTION 'seed missing';
  END IF;
END $$;

-- Unknown flags are rejected.
DO $$ BEGIN
  BEGIN
    INSERT INTO public.user_feature_flags VALUES ('00000000-0000-4000-8000-0000000000a2', 'grant_admin');
    RAISE EXCEPTION 'unknown flag accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Owner reads own flag only.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1","iat":9999999999}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.user_feature_flags) <> 1 THEN RAISE EXCEPTION 'owner cannot read own flag'; END IF;
END $$;
-- Owner cannot self-manage.
DO $$ BEGIN
  BEGIN
    DELETE FROM public.user_feature_flags WHERE user_id = '00000000-0000-4000-8000-0000000000a1';
    IF FOUND THEN RAISE EXCEPTION 'owner deleted own flag'; END IF;
  END;
END $$;

-- A session that still has to change its temporary password sees nothing.
RESET ROLE;
UPDATE auth.users SET raw_app_meta_data = jsonb_build_object('must_change_password', true)
WHERE id = '00000000-0000-4000-8000-0000000000a1';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.user_feature_flags) <> 0 THEN RAISE EXCEPTION 'visible before password change'; END IF;
END $$;

-- Another user sees nothing and cannot insert.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a2', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal1","iat":9999999999}', true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.user_feature_flags) <> 0 THEN RAISE EXCEPTION 'flag leaked to other user'; END IF;
  BEGIN
    INSERT INTO public.user_feature_flags VALUES ('00000000-0000-4000-8000-0000000000a2', 'omit_leadership_title');
    RAISE EXCEPTION 'non-admin inserted a flag';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- Super admin manages flags.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a3', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal2","iat":9999999999}', true);
DO $$ BEGIN
  INSERT INTO public.user_feature_flags VALUES ('00000000-0000-4000-8000-0000000000a2', 'omit_leadership_title');
  IF (SELECT count(*) FROM public.user_feature_flags) <> 2 THEN RAISE EXCEPTION 'super admin cannot read all'; END IF;
  DELETE FROM public.user_feature_flags WHERE user_id = '00000000-0000-4000-8000-0000000000a2';
  IF NOT FOUND THEN RAISE EXCEPTION 'super admin cannot delete'; END IF;
END $$;

RESET ROLE;
ROLLBACK;

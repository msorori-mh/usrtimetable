-- L-2: admin_revoke_user_sessions deletes only the target user's sessions and
-- refresh tokens, works without the auth tables, and is service_role-only.
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('public.admin_revoke_user_sessions(uuid)') IS NULL THEN
    RAISE EXCEPTION 'L-2: admin_revoke_user_sessions missing';
  END IF;
  IF has_function_privilege('anon', 'public.admin_revoke_user_sessions(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_revoke_user_sessions(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.admin_revoke_user_sessions(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'L-2: wrong EXECUTE grants';
  END IF;
END $$;

-- without auth.sessions/refresh_tokens: no error
SET LOCAL ROLE service_role;
SELECT public.admin_revoke_user_sessions(gen_random_uuid());
RESET ROLE;

-- minimal GoTrue-shaped tables (only if missing in this environment)
DO $$
BEGIN
  IF to_regclass('auth.sessions') IS NULL THEN
    CREATE TABLE auth.sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL);
  END IF;
  IF to_regclass('auth.refresh_tokens') IS NULL THEN
    CREATE TABLE auth.refresh_tokens (id bigserial PRIMARY KEY, user_id varchar(255), session_id uuid, token varchar(255));
  END IF;
END $$;
INSERT INTO auth.sessions (id, user_id) VALUES
  ('00000011-0000-0000-0000-0000000000a1', '00000011-0000-0000-0000-000000000001'),
  ('00000011-0000-0000-0000-0000000000a2', '00000011-0000-0000-0000-000000000002');
INSERT INTO auth.refresh_tokens (user_id, session_id, token) VALUES
  ('00000011-0000-0000-0000-000000000001', '00000011-0000-0000-0000-0000000000a1', 't1'),
  ('00000011-0000-0000-0000-000000000002', '00000011-0000-0000-0000-0000000000a2', 't2');

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM public.admin_revoke_user_sessions('00000011-0000-0000-0000-000000000001');
  RAISE EXCEPTION 'L-2: authenticated revoked sessions';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT public.admin_revoke_user_sessions('00000011-0000-0000-0000-000000000001');
RESET ROLE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = '00000011-0000-0000-0000-000000000001')
     OR EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE user_id = '00000011-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'L-2: target sessions not revoked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = '00000011-0000-0000-0000-000000000002')
     OR NOT EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE user_id = '00000011-0000-0000-0000-000000000002') THEN
    RAISE EXCEPTION 'L-2: other users'' sessions were removed';
  END IF;
END $$;
ROLLBACK;

-- L-9: least privilege hardening.
--  1. anon/authenticated never need TRUNCATE, TRIGGER or REFERENCES on public
--     tables (Supabase default privileges grant ALL). TRUNCATE in particular
--     bypasses RLS. Revoke on existing tables and in default privileges.
--  2. SECURITY DEFINER routines whose search_path does not end with pg_temp
--     get pg_temp appended explicitly (existing schemas preserved, order kept),
--     so temporary objects can never shadow the names they resolve.

REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    BEGIN
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
        REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM anon, authenticated;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'L-9: cannot alter default privileges for supabase_admin; skipped';
    END;
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS security_private;
CREATE TABLE IF NOT EXISTS security_private.search_path_changes (
  migration text NOT NULL,
  routine regprocedure NOT NULL,
  old_search_path text NOT NULL,
  PRIMARY KEY (routine)
);
REVOKE ALL ON security_private.search_path_changes FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r record;
  v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, substr(c, length('search_path=') + 1) AS sp
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL unnest(p.proconfig) c
     WHERE p.prosecdef
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg\_%'
       AND c LIKE 'search_path=%'
       AND c NOT LIKE '%pg_temp%'
  LOOP
    v_new := CASE WHEN btrim(r.sp) IN ('', '""') THEN 'pg_temp' ELSE r.sp || ', pg_temp' END;
    INSERT INTO security_private.search_path_changes (migration, routine, old_search_path)
    VALUES ('20261020001400_l9', r.oid::regprocedure, r.sp)
    ON CONFLICT (routine) DO NOTHING;
    EXECUTE format('ALTER ROUTINE %s SET search_path = %s', r.oid::regprocedure, v_new);
  END LOOP;

  -- Definer routines with no search_path at all: pin a safe one.
  FOR r IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prosecdef
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg\_%'
       AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%')
  LOOP
    INSERT INTO security_private.search_path_changes (migration, routine, old_search_path)
    VALUES ('20261020001400_l9', r.oid::regprocedure, '<unset>')
    ON CONFLICT (routine) DO NOTHING;
    EXECUTE format('ALTER ROUTINE %s SET search_path = public, extensions, pg_temp', r.oid::regprocedure);
  END LOOP;
END $$;

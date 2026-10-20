-- H-1: SECURITY DEFINER functions in schema public were executable by anon
-- (Supabase default privileges GRANT EXECUTE directly to anon/authenticated,
-- and Postgres grants EXECUTE to PUBLIC by default).
--
-- (a) Revoke EXECUTE FROM PUBLIC, anon on every definer function in public,
--     except an explicit allow-list of functions that must stay callable
--     anonymously:
--       * resolve_report_verification(uuid)   -- public report verification page
--       * enforce_initial_password_change()   -- PostgREST pgrst.db_pre_request hook
--                                                (runs for anon and authenticated)
--     Before revoking PUBLIC, any function that authenticated can execute ONLY
--     through PUBLIC gets an explicit GRANT to authenticated so that logged-in
--     behaviour is unchanged.
-- (b) Revoke from authenticated on service-only helpers.
-- (c) Change default privileges so future functions are not executable by
--     PUBLIC/anon unless granted explicitly.

DO $$
DECLARE
  r record;
  v_allow constant text[] := ARRAY[
    'public.resolve_report_verification(uuid)',
    'public.enforce_initial_password_change()'
  ];
BEGIN
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS sig, p.proowner,
           coalesce(p.proacl, acldefault('f', p.proowner)) AS acl
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND p.prokind = 'f'
  LOOP
    -- Keep the pre-request hook and the public verifier callable by anon.
    IF ('public.' || regexp_replace(r.sig, '^public\.', '')) = ANY (v_allow) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.oid::regprocedure);
      CONTINUE;
    END IF;

    -- authenticated currently reaches the function only via PUBLIC (grantee 0)?
    IF has_function_privilege('authenticated', r.oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1 FROM aclexplode(r.acl) a
          WHERE a.privilege_type = 'EXECUTE'
            AND a.grantee = 'authenticated'::regrole::oid
       ) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.oid::regprocedure);
    END IF;

    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.oid::regprocedure);
  END LOOP;
END $$;

-- (b) Service-only helpers: never callable by end users.
--   _import_apply_academic_structure: internal helper of _import_dispatch (Q-1).
--   consume_security_limit: called only with service_role from
--     src/lib/users.functions.ts and src/lib/password-change.functions.ts.
--   seed_college_instructor_types: called only by the definer trigger
--     seed_new_college_instructor_types (not referenced from src/).
REVOKE ALL ON FUNCTION public._import_apply_academic_structure(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_security_limit(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_college_instructor_types(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._import_apply_academic_structure(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_security_limit(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.seed_college_instructor_types(uuid) TO service_role;

-- (c) Default privileges for functions created later by the migration owner.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    -- The built-in PUBLIC EXECUTE default is global; a schema-scoped entry
    -- cannot remove it, so revoke it globally for the owner as well.
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    BEGIN
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
      ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'H-1: cannot alter default privileges for supabase_admin; skipped';
    END;
  END IF;
END $$;

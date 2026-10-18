-- H-1 / Q-1 guard: no non-trigger SECURITY DEFINER function in schema public
-- may be executable by anon, except the explicit allow-list; service-only
-- helpers are not executable by authenticated; future functions do not get
-- PUBLIC/anon EXECUTE by default.
BEGIN;
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO v_bad
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef
     AND p.prokind = 'f'
     AND p.prorettype <> 'trigger'::regtype
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.oid NOT IN ('public.resolve_report_verification(uuid)'::regprocedure,
                       'public.enforce_initial_password_change()'::regprocedure);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'H-1: anon can execute definer functions: %', v_bad;
  END IF;

  -- allow-list must stay reachable (PostgREST pre-request hook runs for both roles)
  IF NOT has_function_privilege('anon', 'public.enforce_initial_password_change()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.enforce_initial_password_change()', 'EXECUTE') THEN
    RAISE EXCEPTION 'H-1: pre-request hook not executable by anon/authenticated';
  END IF;
  IF NOT has_function_privilege('anon', 'public.resolve_report_verification(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'H-1: resolve_report_verification not executable by anon';
  END IF;

  SELECT string_agg(s, ', ') INTO v_bad
    FROM unnest(ARRAY['public._import_apply_academic_structure(uuid,text,text,jsonb)',
                      'public.consume_security_limit(uuid,text)',
                      'public.seed_college_instructor_types(uuid)']) s
   WHERE has_function_privilege('authenticated', s, 'EXECUTE')
      OR NOT has_function_privilege('service_role', s, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'H-1: service-only helper grants wrong: %', v_bad;
  END IF;

  -- typical app RPCs remain callable by authenticated
  IF NOT has_function_privilege('authenticated', 'public.record_audit_log(text,text,uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'H-1: authenticated lost record_audit_log';
  END IF;
END $$;

-- Default privileges: a new function created by postgres is not anon-executable.
CREATE FUNCTION public.__h1_probe() RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS 'select 1';
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.__h1_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'H-1: default privileges still give anon EXECUTE on new functions';
  END IF;
END $$;

SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public._import_apply_academic_structure(gen_random_uuid(), 'departments', 'upsert', '[]'::jsonb);
    RAISE EXCEPTION 'H-1: anon executed _import_apply_academic_structure';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.record_audit_log('x', 'y', NULL, NULL, '{}'::jsonb);
    RAISE EXCEPTION 'H-1: anon executed record_audit_log';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;

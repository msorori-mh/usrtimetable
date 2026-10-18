-- Q-1: anon/authenticated must not be able to execute the definer helper
-- public._import_apply_academic_structure (it writes departments/programs).
BEGIN;
DO $$
BEGIN
  IF has_function_privilege('anon', 'public._import_apply_academic_structure(uuid,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Q-1: anon can execute _import_apply_academic_structure';
  END IF;
  IF has_function_privilege('authenticated', 'public._import_apply_academic_structure(uuid,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Q-1: authenticated can execute _import_apply_academic_structure';
  END IF;
  IF NOT has_function_privilege('service_role', 'public._import_apply_academic_structure(uuid,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Q-1: service_role lost EXECUTE on _import_apply_academic_structure';
  END IF;
END $$;

SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public._import_apply_academic_structure(gen_random_uuid(), 'departments', 'upsert',
      '[{"code":"X","name":"X"}]'::jsonb);
    RAISE EXCEPTION 'Q-1: anon call to _import_apply_academic_structure succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- expected
  END;
END $$;
RESET ROLE;
ROLLBACK;

DO $$
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.commit_plan_component_import_job_atomic_v2(uuid,timestamptz)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.commit_plan_component_import_job_atomic_v2(uuid,timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'SAFE_DISABLE_EXECUTE_REVOKE_FAILED';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.commit_import_job_atomic(uuid,timestamptz)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'SAFE_DISABLE_UNRELATED_IMPORT_REGRESSION';
  END IF;

  IF position(
    'ATOMIC_PLAN_COMPONENT_PERSISTENCE_RPC_UNAVAILABLE'
    IN pg_get_functiondef(
      'public.commit_import_job_atomic(uuid,timestamptz)'::regprocedure
    )
  ) = 0 THEN
    RAISE EXCEPTION 'SAFE_DISABLE_LEGACY_PLAN_BYPASS_REOPENED';
  END IF;
END $$;

SELECT 'PLAN_COMPONENT_ROOM_TYPE_ATOMIC_SAFE_DISABLE_PG17: PASS' AS result;

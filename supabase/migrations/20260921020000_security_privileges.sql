BEGIN;
-- Preserve authenticated entry points, remove anonymous execution of application
-- routines (extension members are excluded). QR receipts remain deliberately public.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid,p.oid::regprocedure AS sig,
   has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_allowed
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f'
   AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
 LOOP
  IF f.authenticated_allowed THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f.sig); END IF;
  EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon',f.sig);
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.resolve_report_verification(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.enforce_initial_password_change() TO anon;
REVOKE EXECUTE ON FUNCTION public._import_apply_academic_structure(uuid,text,text,jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.seed_college_instructor_types(uuid) FROM authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, PUBLIC;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;
ALTER VIEW public.v_instructor_delivery_workload SET (security_invoker=true);
-- New objects must be explicitly exposed by their migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon;
NOTIFY pgrst, 'reload schema';
COMMIT;

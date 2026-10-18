-- H-1 (d): version-scoped SECURITY DEFINER helpers must enforce can_view_college
-- (itcs_cutover_path_rules: super admin) for direct callers, while internal
-- composition (definer -> definer, service_role) keeps working.
BEGIN;
ALTER TABLE auth.users DISABLE TRIGGER USER;  -- fixture users bypass the provisioning guard
INSERT INTO auth.users (id, email) VALUES
  ('0000000a-0000-0000-0000-000000000001', 'h1-admin-a@example.invalid'),
  ('0000000a-0000-0000-0000-000000000002', 'h1-super@example.invalid');
ALTER TABLE auth.users ENABLE TRIGGER USER;
INSERT INTO public.universities (id, name) VALUES ('0000000a-0000-0000-0000-0000000000f0', 'H1 U');
INSERT INTO public.colleges (id, university_id, name) VALUES
  ('0000000a-0000-0000-0000-0000000000c1', '0000000a-0000-0000-0000-0000000000f0', 'H1 A'),
  ('0000000a-0000-0000-0000-0000000000c2', '0000000a-0000-0000-0000-0000000000f0', 'H1 B');
INSERT INTO public.academic_terms (id, college_id, name, code) VALUES
  ('0000000a-0000-0000-0000-0000000000d1', '0000000a-0000-0000-0000-0000000000c1', 'T', 'T'),
  ('0000000a-0000-0000-0000-0000000000d2', '0000000a-0000-0000-0000-0000000000c2', 'T', 'T');
INSERT INTO public.schedule_versions (id, college_id, academic_term_id, name) VALUES
  ('0000000a-0000-0000-0000-0000000000e1', '0000000a-0000-0000-0000-0000000000c1', '0000000a-0000-0000-0000-0000000000d1', 'vA'),
  ('0000000a-0000-0000-0000-0000000000e2', '0000000a-0000-0000-0000-0000000000c2', '0000000a-0000-0000-0000-0000000000d2', 'vB');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('0000000a-0000-0000-0000-000000000001', 'college_admin'),
  ('0000000a-0000-0000-0000-000000000002', 'super_admin')
  ON CONFLICT DO NOTHING;
INSERT INTO public.user_colleges (user_id, college_id) VALUES
  ('0000000a-0000-0000-0000-000000000001', '0000000a-0000-0000-0000-0000000000c1');

-- A definer wrapper (stands in for itcs_cutover_execute & co.) that performs its
-- own authorization; nested calls from it must not be re-checked.
CREATE FUNCTION public.__h1d_wrapper(p uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $f$
BEGIN
  PERFORM count(*) FROM public.version_effective_assignments(p);
  RETURN public.schedule_version_session_snapshot(p);
END $f$;
GRANT EXECUTE ON FUNCTION public.__h1d_wrapper(uuid) TO authenticated;
-- An INVOKER wrapper must not launder the check.
CREATE FUNCTION public.__h1d_invoker(p uuid) RETURNS text LANGUAGE plpgsql
SET search_path = public, pg_temp AS $f$
BEGIN
  RETURN public.schedule_version_session_snapshot(p);
END $f$;
GRANT EXECUTE ON FUNCTION public.__h1d_invoker(uuid) TO authenticated;

-- ---- college admin of A ----
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '0000000a-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
DO $$
DECLARE
  vA constant uuid := '0000000a-0000-0000-0000-0000000000e1';
  vB constant uuid := '0000000a-0000-0000-0000-0000000000e2';
  n int; ok boolean;
  stmts text[] := ARRAY[
    'SELECT count(*) FROM public.version_effective_assignments(%L)',
    'SELECT public.schedule_version_session_snapshot(%L)',
    'SELECT public.preview_version_session_moves(%L, ''[]''::jsonb)',
    'SELECT public.validate_version_assignment_allocation(%L, gen_random_uuid(), NULL)',
    'SELECT public.version_scoped_publish_gate(%L)'];
  s text;
BEGIN
  -- own college works (gate composes nested definer calls)
  FOREACH s IN ARRAY stmts LOOP
    EXECUTE format(s, vA);
  END LOOP;
  -- other college and unknown version are refused
  FOREACH s IN ARRAY stmts LOOP
    BEGIN
      EXECUTE format(s, vB);
      RAISE EXCEPTION 'H-1d: cross-college call allowed: %', s;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format(s, gen_random_uuid());
      RAISE EXCEPTION 'H-1d: unknown-version call allowed: %', s;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  -- definer composition is trusted
  PERFORM public.__h1d_wrapper(vB);
  BEGIN
    PERFORM public.__h1d_invoker(vB);
    RAISE EXCEPTION 'H-1d: invoker wrapper bypassed the check';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- path rules: super admin only
  BEGIN
    PERFORM public.itcs_cutover_path_rules(vA);
    RAISE EXCEPTION 'H-1d: non super admin ran itcs_cutover_path_rules';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- ---- super admin ----
SELECT set_config('request.jwt.claim.sub', '0000000a-0000-0000-0000-000000000002', true);
DO $$
DECLARE r jsonb;
BEGIN
  -- authorization must pass; the rule engine itself may depend on objects the
  -- local replay lacks, so only insufficient_privilege counts as failure here.
  BEGIN
    r := public.itcs_cutover_path_rules('0000000a-0000-0000-0000-0000000000e2');
  EXCEPTION
    WHEN insufficient_privilege THEN RAISE EXCEPTION 'H-1d: super admin refused by path rules';
    WHEN undefined_function OR undefined_table THEN NULL;
  END;
  PERFORM public.version_scoped_publish_gate('0000000a-0000-0000-0000-0000000000e2');
END $$;
RESET ROLE;

-- ---- service_role (no end user) ----
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
DO $$
BEGIN
  PERFORM count(*) FROM public.version_effective_assignments('0000000a-0000-0000-0000-0000000000e2');
  PERFORM public.schedule_version_session_snapshot('0000000a-0000-0000-0000-0000000000e2');
END $$;
RESET ROLE;
ROLLBACK;

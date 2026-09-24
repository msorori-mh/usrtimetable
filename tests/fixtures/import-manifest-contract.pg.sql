-- Run only against a disposable, fully migrated local database.
-- psql -v ON_ERROR_STOP=1 "$LOCAL_DATABASE_URL" -f tests/fixtures/import-manifest-contract.pg.sql
BEGIN;

INSERT INTO auth.users (id, aud, role, email, encrypted_password)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'import-a@test.invalid', ''),
  ('10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'import-b@test.invalid', '')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.universities (id, name, code)
VALUES ('20000000-0000-0000-0000-000000000001', 'Import Fixture University', 'IFU')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.colleges (id, university_id, name, code) VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'College A', 'IFA'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'College B', 'IFB')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('10000000-0000-0000-0000-000000000001', 'college_admin'),
  ('10000000-0000-0000-0000-000000000002', 'college_admin')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_colleges (user_id, college_id) VALUES
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002')
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
CREATE TEMP TABLE import_fixture (name text PRIMARY KEY, id uuid);
INSERT INTO import_fixture VALUES ('main', public.create_import_preview_manifest(
  '30000000-0000-0000-0000-000000000001', 'courses', 'upsert', 'fixture.xlsx', 1,
  '[{"rowNumber":1,"values":{"course_code":"CS101"}}]'::jsonb, '[]'::jsonb));

DO $$
DECLARE v_id uuid := (SELECT id FROM import_fixture WHERE name = 'main');
BEGIN
  BEGIN
    PERFORM public.claim_import_job_manifest(v_id,
      '30000000-0000-0000-0000-000000000001', 'courses', 'upsert',
      '[{"rowNumber":1,"values":{"course_code":"CS999"}}]'::jsonb);
    RAISE EXCEPTION 'same-count substitution was accepted';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;
  IF (SELECT status FROM public.import_jobs WHERE id = v_id) <> 'preview' THEN
    RAISE EXCEPTION 'failed claim changed status';
  END IF;
END $$;

SELECT public.claim_import_job_manifest((SELECT id FROM import_fixture WHERE name = 'main'),
  '30000000-0000-0000-0000-000000000001', 'courses', 'upsert',
  '[{"rowNumber":1,"values":{"course_code":"CS101"}}]'::jsonb);
DO $$
BEGIN
  BEGIN
    PERFORM public.claim_import_job_manifest((SELECT id FROM import_fixture WHERE name = 'main'),
      '30000000-0000-0000-0000-000000000001', 'courses', 'upsert',
      '[{"rowNumber":1,"values":{"course_code":"CS101"}}]'::jsonb);
    RAISE EXCEPTION 'replay was accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END $$;
SELECT public.finalize_import_job((SELECT id FROM import_fixture WHERE name = 'main'),
  '30000000-0000-0000-0000-000000000001', 1, 0, 0, 0, '[]'::jsonb);

DO $$
DECLARE v_id uuid := (SELECT id FROM import_fixture WHERE name = 'main');
BEGIN
  IF (SELECT status FROM public.import_jobs WHERE id = v_id) <> 'committed'
     OR NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_id = v_id AND action = 'import_commit') THEN
    RAISE EXCEPTION 'final status/audit not persisted';
  END IF;
END $$;

INSERT INTO import_fixture VALUES ('rollback', public.create_import_preview_manifest(
  '30000000-0000-0000-0000-000000000001', 'courses', 'insert_only', 'rollback.xlsx', 1,
  '[{"rowNumber":1,"values":{"course_code":"CS102"}}]'::jsonb, '[]'::jsonb));
CREATE FUNCTION pg_temp.reject_claim_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.action = 'import_claim' THEN RAISE EXCEPTION 'forced audit failure'; END IF; RETURN NEW; END $$;
CREATE TRIGGER fixture_reject_claim BEFORE INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_claim_audit();
DO $$
BEGIN
  BEGIN
    PERFORM public.claim_import_job_manifest((SELECT id FROM import_fixture WHERE name = 'rollback'),
      '30000000-0000-0000-0000-000000000001', 'courses', 'insert_only',
      '[{"rowNumber":1,"values":{"course_code":"CS102"}}]'::jsonb);
    RAISE EXCEPTION 'forced audit failure did not abort claim';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  IF (SELECT status FROM public.import_jobs WHERE id = (SELECT id FROM import_fixture WHERE name = 'rollback')) <> 'preview' THEN
    RAISE EXCEPTION 'claim did not roll back with audit';
  END IF;
END $$;
DROP TRIGGER fixture_reject_claim ON public.audit_logs;

SELECT public.claim_import_job_manifest((SELECT id FROM import_fixture WHERE name = 'rollback'),
  '30000000-0000-0000-0000-000000000001', 'courses', 'insert_only',
  '[{"rowNumber":1,"values":{"course_code":"CS102"}}]'::jsonb);
SELECT public.fail_import_job((SELECT id FROM import_fixture WHERE name = 'rollback'),
  '30000000-0000-0000-0000-000000000001', 'fixture recovery');

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.create_import_preview_manifest(
      '30000000-0000-0000-0000-000000000001', 'courses', 'upsert', 'forbidden.xlsx', 0, '[]', '[]');
    RAISE EXCEPTION 'cross-college preview was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

ROLLBACK;
\echo 'import-manifest-contract.pg.sql: PASS'

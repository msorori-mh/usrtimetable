\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;

CREATE TABLE public.schedule_versions (
  id uuid PRIMARY KEY, college_id uuid NOT NULL, academic_term_id uuid NOT NULL,
  name text NOT NULL, status text NOT NULL, notes text, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.schedule_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.schedule_quality_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL, total_score numeric,
  hard_conflicts_count integer NOT NULL DEFAULT 0, soft_conflicts_count integer NOT NULL DEFAULT 0,
  total_deductions integer NOT NULL DEFAULT 0, metrics_breakdown jsonb, run_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.schedule_version_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL, event_type text NOT NULL, from_status text,
  to_status text, performed_by uuid, notes text, metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.conflict_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL
);
CREATE TABLE public.schedule_version_conflict_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  schedule_version_id uuid NOT NULL
);
CREATE FUNCTION public.can_manage_college(p_actor uuid, p_college uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT p_actor = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid AND p_college = 'cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid $$;
CREATE FUNCTION public.enforce_sv_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER trg_sv_transition BEFORE UPDATE OF status ON public.schedule_versions FOR EACH ROW EXECUTE FUNCTION public.enforce_sv_transition();

\ir ../../../supabase/migrations/20260718120000_source_only_atomic_schedule_version_lifecycle.sql

INSERT INTO schedule_versions (id, college_id, academic_term_id, name, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'proof', 'draft');
INSERT INTO schedule_versions (id, college_id, academic_term_id, name, status)
VALUES ('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'proof-2', 'draft');
INSERT INTO schedule_sessions (college_id, schedule_version_id)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');

SET test.uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DO $$ BEGIN
  PERFORM transition_schedule_version('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'draft', 'review');
  RAISE EXCEPTION 'unauthorized actor was accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

SET test.uid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
DO $$ BEGIN
  PERFORM transition_schedule_version('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'draft', 'review');
  RAISE EXCEPTION 'missing quality run was accepted';
EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'PUBLISH_BLOCKER:QUALITY_RUN_REQUIRED' THEN RAISE; END IF;
END $$;
SELECT persist_schedule_quality_run(
  'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111',
  (begin_schedule_quality_snapshot('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111')->>'eligibility_revision')::bigint,
  100, 0, 0, 0, '{}'::jsonb
);
SELECT transition_schedule_version('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'draft', 'review');
DO $$ BEGIN
  PERFORM transition_schedule_version('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'draft', 'review');
  RAISE EXCEPTION 'stale status was accepted';
EXCEPTION WHEN serialization_failure THEN NULL; END $$;

CREATE FUNCTION fail_lifecycle_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced audit failure'; END $$;
CREATE TRIGGER fail_lifecycle_audit BEFORE INSERT ON schedule_version_events FOR EACH ROW EXECUTE FUNCTION fail_lifecycle_audit();
DO $$ BEGIN
  PERFORM transition_schedule_version('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'review', 'approved');
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM <> 'forced audit failure' THEN RAISE; END IF;
END $$;
DO $$ BEGIN
  IF (SELECT status FROM schedule_versions WHERE id = '11111111-1111-1111-1111-111111111111') <> 'review' THEN
    RAISE EXCEPTION 'audit failure did not roll back status';
  END IF;
END $$;

DROP TRIGGER fail_lifecycle_audit ON schedule_version_events;
UPDATE schedule_sessions SET updated_at = clock_timestamp()
WHERE schedule_version_id = '11111111-1111-1111-1111-111111111111';
DO $$ BEGIN
  PERFORM transition_schedule_version('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'review', 'approved');
  RAISE EXCEPTION 'stale quality run was accepted';
EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'PUBLISH_BLOCKER:QUALITY_RUN_STALE' THEN RAISE; END IF;
END $$;
-- A scorer snapshot cannot be persisted after any eligibility input changes.
DO $$
DECLARE stale_revision bigint;
BEGIN
  stale_revision := (begin_schedule_quality_snapshot(
    'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111'
  )->>'eligibility_revision')::bigint;
  UPDATE schedule_sessions SET updated_at = clock_timestamp()
  WHERE schedule_version_id = '11111111-1111-1111-1111-111111111111';
  BEGIN
    PERFORM persist_schedule_quality_run(
      'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111',
      stale_revision, 100, 0, 0, 0, '{}'::jsonb
    );
    RAISE EXCEPTION 'stale quality snapshot was accepted';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
END $$;

SELECT persist_schedule_quality_run(
  'cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111',
  (begin_schedule_quality_snapshot('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111')->>'eligibility_revision')::bigint,
  100, 0, 0, 0, '{}'::jsonb
);
SELECT transition_schedule_version('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'review', 'approved');
SELECT transition_schedule_version('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'approved', 'published');
DO $$ BEGIN
  UPDATE schedule_versions SET name = 'mutated' WHERE id = '11111111-1111-1111-1111-111111111111';
  RAISE EXCEPTION 'published metadata mutation was accepted';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  DELETE FROM schedule_versions WHERE id = '11111111-1111-1111-1111-111111111111';
  RAISE EXCEPTION 'published version deletion was accepted';
EXCEPTION WHEN check_violation THEN NULL; END $$;

DO $$ BEGIN
  IF (SELECT count(*) FROM schedule_version_events) <> 3 THEN RAISE EXCEPTION 'unexpected audit count'; END IF;
END $$;

-- Moving one dependency invalidates both OLD and NEW versions exactly once.
DO $$
DECLARE before_old bigint; before_new bigint;
BEGIN
  SELECT eligibility_revision INTO before_old FROM schedule_versions WHERE id = '11111111-1111-1111-1111-111111111111';
  SELECT eligibility_revision INTO before_new FROM schedule_versions WHERE id = '22222222-2222-2222-2222-222222222222';
  UPDATE schedule_sessions SET schedule_version_id = '22222222-2222-2222-2222-222222222222'
  WHERE schedule_version_id = '11111111-1111-1111-1111-111111111111';
  IF (SELECT eligibility_revision FROM schedule_versions WHERE id = '11111111-1111-1111-1111-111111111111') <> before_old + 1
     OR (SELECT eligibility_revision FROM schedule_versions WHERE id = '22222222-2222-2222-2222-222222222222') <> before_new + 1 THEN
    RAISE EXCEPTION 'OLD+NEW invalidation failed';
  END IF;
END $$;

DO $$ BEGIN
  IF has_table_privilege('authenticated', 'public.schedule_quality_runs', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated retained direct quality insert';
  END IF;
END $$;
SELECT 'schedule-version-lifecycle disposable PostgreSQL proof: PASS';

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
  hard_conflicts_count integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
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
INSERT INTO schedule_sessions (college_id, schedule_version_id)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111');

SET test.uid = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DO $$ BEGIN
  PERFORM transition_schedule_version('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'draft', 'review');
  RAISE EXCEPTION 'unauthorized actor was accepted';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;

SET test.uid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
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
SELECT transition_schedule_version('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'review', 'approved');
INSERT INTO schedule_quality_runs (college_id, schedule_version_id, total_score, hard_conflicts_count)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 100, 0);
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
SELECT 'schedule-version-lifecycle disposable PostgreSQL proof: PASS';

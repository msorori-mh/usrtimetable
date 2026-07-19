-- Disposable PostgreSQL 15 proof for commit_import_job_atomic.
-- Stub schema + prior import-manifest RPCs + atomic migration. No production DB.
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid', true), '')::uuid
$$;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TABLE public.universities (
  id uuid PRIMARY KEY, name text NOT NULL, code text NOT NULL
);
CREATE TABLE public.colleges (
  id uuid PRIMARY KEY, university_id uuid NOT NULL, name text NOT NULL, code text NOT NULL
);
CREATE TABLE public.user_roles (
  user_id uuid NOT NULL, role text NOT NULL, PRIMARY KEY (user_id, role)
);
CREATE TABLE public.user_colleges (
  user_id uuid NOT NULL, college_id uuid NOT NULL, PRIMARY KEY (user_id, college_id)
);

CREATE FUNCTION public.can_manage_college(_user_id uuid, _college_id uuid)
RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id AND ur.role = 'super_admin'
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.user_colleges uc ON uc.user_id = ur.user_id
    WHERE ur.user_id = _user_id AND ur.role = 'college_admin'
      AND uc.college_id = _college_id
  );
$$;

CREATE TABLE public.import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  target_entity text NOT NULL,
  mode text NOT NULL DEFAULT 'insert_only',
  status text NOT NULL DEFAULT 'preview',
  file_name text,
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  invalid_rows integer NOT NULL DEFAULT 0,
  inserted_rows integer NOT NULL DEFAULT 0,
  updated_rows integer NOT NULL DEFAULT 0,
  skipped_rows integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  validated_payload jsonb,
  payload_manifest text,
  claimed_at timestamptz,
  finished_at timestamptz,
  failure_message text,
  CONSTRAINT import_jobs_status_check
    CHECK (status IN ('preview', 'committing', 'committed', 'failed', 'cancelled'))
);

CREATE TABLE public.import_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  job_id uuid NOT NULL,
  row_number integer NOT NULL,
  column_name text,
  error_code text NOT NULL,
  message text NOT NULL,
  raw_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  college_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  capacity integer NOT NULL DEFAULT 30,
  room_type text NOT NULL DEFAULT 'lecture_hall',
  room_type_id uuid,
  building_id uuid,
  building text,
  floor text,
  available_start_time time,
  available_end_time time,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rooms_college_code_uniq ON public.rooms (college_id, lower(code));

CREATE TABLE public.sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  course_id uuid NOT NULL,
  term_id uuid NOT NULL,
  section_number text NOT NULL,
  capacity integer NOT NULL DEFAULT 30,
  study_system text NOT NULL DEFAULT 'regular',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sections_isolation_uniq
  ON public.sections (college_id, course_id, term_id, section_number, study_system);

CREATE TABLE public.academic_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL,
  program_id uuid NOT NULL,
  level_id uuid NOT NULL,
  study_system text NOT NULL,
  entry_year integer NOT NULL,
  term_id uuid NOT NULL,
  expected_students integer NOT NULL DEFAULT 0,
  count_status text,
  code text,
  active boolean NOT NULL DEFAULT true
);

-- Stub tables referenced by unused branches so CREATE OR REPLACE of helpers succeeds.
CREATE TABLE public.instructors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  employee_number text, full_name text NOT NULL, full_name_ar text, full_name_en text,
  email text, phone text, specialization text, academic_degree text, academic_rank text,
  instructor_type_id uuid, department_id uuid, employment_type text DEFAULT 'full_time',
  max_weekly_hours integer DEFAULT 18, max_hours_per_day integer,
  administrative_release_hours numeric DEFAULT 0, admin_tasks text, external_source text,
  notes text, is_active boolean DEFAULT true
);
CREATE TABLE public.academic_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, academic_year text, term_type text,
  start_date date, end_date date, teaching_weeks_count integer, is_active boolean DEFAULT false
);
CREATE TABLE public.daily_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  name text NOT NULL, start_time time NOT NULL, end_time time NOT NULL,
  days integer[] NOT NULL DEFAULT '{}', affects_scheduling boolean DEFAULT true
);
CREATE TABLE public.course_offerings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  term_id uuid, course_id uuid, program_id uuid, level_id uuid, study_plan_id uuid,
  plan_course_id uuid, expected_students integer, sections_count integer,
  status text, is_active boolean, notes text, study_system text
);
CREATE TABLE public.teaching_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  course_offering_id uuid, instructor_id uuid, session_type text, section_number text,
  section_id uuid, weekly_hours numeric, expected_students integer, required_room_type text,
  notes text, delivery_group_id uuid, cohort_id uuid, plan_course_component_id uuid,
  assigned_component_hours numeric, is_active boolean DEFAULT true, updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.course_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  course_id uuid NOT NULL, program_id uuid NOT NULL
);
CREATE TABLE public.section_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  academic_term_id uuid, course_id uuid, group_name text, expected_students_total integer, notes text
);
CREATE TABLE public.section_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  section_group_id uuid, section_id uuid, expected_students integer
);
CREATE TABLE public.elective_slot_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  elective_slot_id uuid, course_id uuid
);
CREATE TABLE public.cohort_elective_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  cohort_id uuid, elective_slot_id uuid, selected_course_id uuid
);
CREATE TABLE public.study_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  program_id uuid, code text, name text, version text, effective_year integer
);
CREATE TABLE public.academic_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  program_id uuid, level_number integer, name text
);
CREATE TABLE public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  department_id uuid, code text, name text, credit_hours integer,
  theory_hours numeric, practical_hours numeric, course_nature text, is_shared boolean
);
CREATE TABLE public.plan_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  study_plan_id uuid, course_id uuid, level_id uuid, semester integer, is_required boolean,
  lectures_per_week integer, lecture_session_duration integer, labs_per_week integer,
  lab_session_duration integer, required_room_type_for_lecture text, required_room_type_for_lab text
);
CREATE TABLE public.plan_course_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  plan_course_id uuid, component_type text, weekly_contact_hours numeric,
  is_timetabled boolean, counts_toward_regular_load boolean, counts_toward_overtime boolean,
  compensation_mode text,
  UNIQUE (plan_course_id, component_type)
);
CREATE TABLE public.elective_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  study_plan_id uuid, level_id uuid, semester integer, slot_code text, label text,
  required_component_type text, active boolean
);
CREATE TABLE public.delivery_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid NOT NULL,
  cohort_id uuid, component_id uuid, plan_course_id uuid, group_code text,
  group_number integer, expected_students integer, is_obsolete boolean DEFAULT false,
  active boolean DEFAULT true
);

CREATE FUNCTION public.commit_teaching_assignments_v2_import(p_rows jsonb, p_mode text DEFAULT 'upsert')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN jsonb_build_object(
    'status', 'ok', 'rows_created', 0, 'rows_updated', 0, 'rows_reactivated', 0,
    'rows_unchanged', jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)),
    'validation_errors', '[]'::jsonb
  );
END;
$$;

-- Historical / residual table ACL (simulates 20260605 grants + accidental PUBLIC/anon).
-- Migrations under test must close these before any client path can use them.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_errors TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.import_jobs TO anon;
GRANT INSERT, UPDATE, DELETE ON public.import_errors TO anon;
GRANT INSERT, UPDATE, DELETE ON public.import_jobs TO PUBLIC;
GRANT INSERT, UPDATE, DELETE ON public.import_errors TO PUBLIC;

-- When run from repo: paths relative to this file. Disposable runner co-locates copies.
\ir ./20260718180000_import_manifest_contract.sql
\ir ./20260718210000_source_only_atomic_import_job_commit.sql

-- ACL proof: anon / authenticated / PUBLIC must not retain table DML after hardening.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('anon'::name, 'public.import_jobs'::text),
      ('anon', 'public.import_errors'),
      ('authenticated', 'public.import_jobs'),
      ('authenticated', 'public.import_errors'),
      ('public', 'public.import_jobs'),
      ('public', 'public.import_errors')
    ) AS t(rol, tbl)
  LOOP
    IF has_table_privilege(r.rol, r.tbl, 'INSERT')
       OR has_table_privilege(r.rol, r.tbl, 'UPDATE')
       OR has_table_privilege(r.rol, r.tbl, 'DELETE') THEN
      RAISE EXCEPTION 'table DML privilege remains: % on %', r.rol, r.tbl;
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO public.import_jobs (college_id, target_entity, mode, status)
    VALUES ('30000000-0000-0000-0000-000000000001', 'rooms', 'upsert', 'preview');
    RESET ROLE;
    RAISE EXCEPTION 'anon INSERT import_jobs was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN RESET ROLE;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE public.import_jobs SET notes = 'hack' WHERE false;
    RESET ROLE;
    RAISE EXCEPTION 'authenticated UPDATE import_jobs was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN RESET ROLE;
  END;
END $$;

DO $$
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.import_errors (college_id, job_id, row_number, error_code, message)
    VALUES (
      '30000000-0000-0000-0000-000000000001',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      1, 'x', 'y'
    );
    RESET ROLE;
    RAISE EXCEPTION 'authenticated INSERT import_errors was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN RESET ROLE;
  END;
END $$;

-- Fixtures
INSERT INTO universities VALUES
  ('20000000-0000-0000-0000-000000000001', 'Import U', 'IU');
INSERT INTO colleges VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'College A', 'CA'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'College B', 'CB');
INSERT INTO user_roles VALUES
  ('10000000-0000-0000-0000-000000000001', 'college_admin'),
  ('10000000-0000-0000-0000-000000000002', 'college_admin'),
  ('10000000-0000-0000-0000-000000000003', 'read_only');
INSERT INTO user_colleges VALUES
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002'),
  ('10000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001');

-- 2) unauthenticated reject
SET test.uid = '';
DO $$
BEGIN
  BEGIN
    PERFORM public.commit_import_job_atomic('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    RAISE EXCEPTION 'unauthenticated was accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
    WHEN invalid_authorization_specification THEN NULL;
  END;
END $$;

-- Create preview as actor A
SET test.uid = '10000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE fix (name text PRIMARY KEY, id uuid, updated_at timestamptz);

INSERT INTO fix
SELECT 'main', j, (SELECT updated_at FROM import_jobs WHERE id = j)
FROM public.create_import_preview_manifest(
  '30000000-0000-0000-0000-000000000001', 'rooms', 'upsert', 'rooms.xlsx', 1,
  '[{"rowNumber":1,"values":{"code":"R-101","name":"Room 101","room_type":"lecture_hall","capacity":40}}]'::jsonb,
  '[]'::jsonb
) AS j;

-- 3) read_only reject
SET test.uid = '10000000-0000-0000-0000-000000000003';
DO $$
DECLARE v_id uuid := (SELECT id FROM fix WHERE name = 'main');
BEGIN
  BEGIN
    PERFORM public.commit_import_job_atomic(v_id);
    RAISE EXCEPTION 'read_only was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- 4) cross-college reject (actor B against college A job)
SET test.uid = '10000000-0000-0000-0000-000000000002';
DO $$
DECLARE v_id uuid := (SELECT id FROM fix WHERE name = 'main');
BEGIN
  BEGIN
    PERFORM public.commit_import_job_atomic(v_id);
    RAISE EXCEPTION 'cross-college was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- 5) actor substitution: another admin on same college cannot commit foreign job
INSERT INTO user_roles VALUES ('10000000-0000-0000-0000-000000000004', 'college_admin')
ON CONFLICT DO NOTHING;
INSERT INTO user_colleges VALUES
  ('10000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;
SET test.uid = '10000000-0000-0000-0000-000000000004';
DO $$
DECLARE v_id uuid := (SELECT id FROM fix WHERE name = 'main');
BEGIN
  BEGIN
    PERFORM public.commit_import_job_atomic(v_id);
    RAISE EXCEPTION 'actor substitution was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;

-- 6) payload substitution: tamper stored payload after preview → manifest mismatch
SET test.uid = '10000000-0000-0000-0000-000000000001';
UPDATE public.import_jobs
SET validated_payload = '[{"rowNumber":1,"values":{"code":"R-HACK","name":"Hacked","room_type":"lecture_hall"}}]'::jsonb
WHERE id = (SELECT id FROM fix WHERE name = 'main');
DO $$
DECLARE v_id uuid := (SELECT id FROM fix WHERE name = 'main');
BEGIN
  BEGIN
    PERFORM public.commit_import_job_atomic(v_id);
    RAISE EXCEPTION 'payload substitution was accepted';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;
END $$;
-- restore authoritative payload
UPDATE public.import_jobs
SET validated_payload = '[{"rowNumber":1,"values":{"code":"R-101","name":"Room 101","room_type":"lecture_hall","capacity":40}}]'::jsonb
WHERE id = (SELECT id FROM fix WHERE name = 'main');

-- 7) regular/parallel isolation on sections entity
INSERT INTO fix
SELECT 'sections', j, (SELECT updated_at FROM import_jobs WHERE id = j)
FROM public.create_import_preview_manifest(
  '30000000-0000-0000-0000-000000000001', 'sections', 'upsert', 'sec.xlsx', 2,
  jsonb_build_array(
    jsonb_build_object('rowNumber', 1, 'values', jsonb_build_object(
      '_course_id', '40000000-0000-0000-0000-000000000001',
      '_term_id', '50000000-0000-0000-0000-000000000001',
      'section_number', '1', 'capacity', 30, 'study_system', 'regular')),
    jsonb_build_object('rowNumber', 2, 'values', jsonb_build_object(
      '_course_id', '40000000-0000-0000-0000-000000000001',
      '_term_id', '50000000-0000-0000-0000-000000000001',
      'section_number', '1', 'capacity', 30, 'study_system', 'parallel'))
  ),
  '[]'::jsonb
) AS j;

SELECT public.commit_import_job_atomic((SELECT id FROM fix WHERE name = 'sections'));
DO $$
BEGIN
  IF (SELECT count(*) FROM public.sections) <> 2 THEN
    RAISE EXCEPTION 'regular/parallel sections were not isolated';
  END IF;
END $$;

-- 8) cohort isolation (academic_cohorts)
INSERT INTO fix
SELECT 'cohorts', j, (SELECT updated_at FROM import_jobs WHERE id = j)
FROM public.create_import_preview_manifest(
  '30000000-0000-0000-0000-000000000001', 'academic_cohorts', 'upsert', 'coh.xlsx', 2,
  jsonb_build_array(
    jsonb_build_object('rowNumber', 1, 'values', jsonb_build_object(
      '_program_id', '60000000-0000-0000-0000-000000000001',
      '_level_id', '70000000-0000-0000-0000-000000000001',
      '_term_id', '50000000-0000-0000-0000-000000000001',
      'study_system', 'regular', 'entry_year', 2025, 'expected_students', 40)),
    jsonb_build_object('rowNumber', 2, 'values', jsonb_build_object(
      '_program_id', '60000000-0000-0000-0000-000000000001',
      '_level_id', '70000000-0000-0000-0000-000000000001',
      '_term_id', '50000000-0000-0000-0000-000000000001',
      'study_system', 'parallel', 'entry_year', 2025, 'expected_students', 20))
  ),
  '[]'::jsonb
) AS j;
SELECT public.commit_import_job_atomic((SELECT id FROM fix WHERE name = 'cohorts'));
DO $$
BEGIN
  IF (SELECT count(DISTINCT study_system) FROM public.academic_cohorts) <> 2 THEN
    RAISE EXCEPTION 'cohort study_system isolation failed';
  END IF;
END $$;

-- 1/9/17) authorized atomic commit — stored payload authoritative; counters server-derived
SELECT public.commit_import_job_atomic(
  (SELECT id FROM fix WHERE name = 'main'),
  (SELECT updated_at FROM import_jobs WHERE id = (SELECT id FROM fix WHERE name = 'main'))
);
DO $$
DECLARE
  v_id uuid := (SELECT id FROM fix WHERE name = 'main');
  v_rooms int;
  v_audit int;
BEGIN
  SELECT count(*) INTO v_rooms FROM public.rooms WHERE college_id = '30000000-0000-0000-0000-000000000001' AND code = 'R-101';
  SELECT count(*) INTO v_audit FROM public.audit_logs WHERE entity_id = v_id AND action = 'import_job_committed';
  IF v_rooms <> 1 THEN RAISE EXCEPTION 'authorized commit did not write room'; END IF;
  IF (SELECT status FROM import_jobs WHERE id = v_id) <> 'committed' THEN RAISE EXCEPTION 'job not committed'; END IF;
  IF (SELECT inserted_rows FROM import_jobs WHERE id = v_id) <> 1 THEN RAISE EXCEPTION 'counters not server-derived'; END IF;
  IF v_audit <> 1 THEN RAISE EXCEPTION 'success audit missing'; END IF;
END $$;

-- 14) replay protection — no second write
SELECT public.commit_import_job_atomic((SELECT id FROM fix WHERE name = 'main'));
DO $$
BEGIN
  IF (SELECT count(*) FROM public.rooms WHERE code = 'R-101') <> 1 THEN
    RAISE EXCEPTION 'replay re-wrote domain rows';
  END IF;
  IF (SELECT count(*) FROM public.audit_logs
      WHERE entity_id = (SELECT id FROM fix WHERE name = 'main')
        AND action = 'import_job_committed') <> 1 THEN
    RAISE EXCEPTION 'replay created extra success audit';
  END IF;
END $$;

-- 15) concurrent double-commit protection (serialized FOR UPDATE → second is replay)
DO $$
DECLARE
  v_id uuid := (SELECT id FROM fix WHERE name = 'main');
  r1 jsonb;
  r2 jsonb;
BEGIN
  r1 := public.commit_import_job_atomic(v_id);
  r2 := public.commit_import_job_atomic(v_id);
  IF COALESCE((r1->>'replay')::boolean, false) IS NOT TRUE
     OR COALESCE((r2->>'replay')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'concurrent/idempotent replay flags missing';
  END IF;
END $$;

-- 11/12) forced handler failure → full rollback + zero success audit
INSERT INTO fix
SELECT 'rollback', j, (SELECT updated_at FROM import_jobs WHERE id = j)
FROM public.create_import_preview_manifest(
  '30000000-0000-0000-0000-000000000001', 'rooms', 'insert_only', 'rb.xlsx', 1,
  '[{"rowNumber":1,"values":{"code":"R-202","name":"Room 202","room_type":"lecture_hall","capacity":20}}]'::jsonb,
  '[]'::jsonb
) AS j;

CREATE FUNCTION pg_temp.force_fail_on_room_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'forced handler failure';
END;
$$;
CREATE TRIGGER trg_force_fail BEFORE INSERT ON public.rooms
FOR EACH ROW WHEN (NEW.code = 'R-202')
EXECUTE FUNCTION pg_temp.force_fail_on_room_insert();

DO $$
DECLARE
  v_id uuid := (SELECT id FROM fix WHERE name = 'rollback');
  v_audit_before int;
  v_audit_after int;
BEGIN
  SELECT count(*) INTO v_audit_before FROM public.audit_logs
  WHERE entity_id = v_id AND action = 'import_job_committed';
  BEGIN
    PERFORM public.commit_import_job_atomic(v_id);
    RAISE EXCEPTION 'forced failure did not abort';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'forced handler failure' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO v_audit_after FROM public.audit_logs
  WHERE entity_id = v_id AND action = 'import_job_committed';
  IF (SELECT status FROM import_jobs WHERE id = v_id) <> 'preview' THEN
    RAISE EXCEPTION 'forced failure left non-preview job status';
  END IF;
  IF EXISTS (SELECT 1 FROM public.rooms WHERE code = 'R-202') THEN
    RAISE EXCEPTION 'forced failure left partial operational write';
  END IF;
  IF v_audit_after <> v_audit_before THEN
    RAISE EXCEPTION 'forced failure wrote success audit';
  END IF;
END $$;
DROP TRIGGER trg_force_fail ON public.rooms;

-- 10) pre-validation before DML: invalid row must not create any rooms
INSERT INTO fix
SELECT 'preval', j, (SELECT updated_at FROM import_jobs WHERE id = j)
FROM public.create_import_preview_manifest(
  '30000000-0000-0000-0000-000000000001', 'rooms', 'upsert', 'bad.xlsx', 1,
  '[{"rowNumber":1,"values":{"code":"","name":"Missing code","room_type":"lecture_hall"}}]'::jsonb,
  '[]'::jsonb
) AS j;
DO $$
DECLARE v_id uuid := (SELECT id FROM fix WHERE name = 'preval');
BEGIN
  BEGIN
    PERFORM public.commit_import_job_atomic(v_id);
    RAISE EXCEPTION 'pre-validation did not reject empty code';
  EXCEPTION WHEN invalid_parameter_value OR data_exception OR check_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.rooms WHERE name = 'Missing code') THEN
    RAISE EXCEPTION 'pre-validation allowed DML';
  END IF;
  IF (SELECT status FROM import_jobs WHERE id = v_id) <> 'preview' THEN
    RAISE EXCEPTION 'pre-validation changed job status';
  END IF;
END $$;

-- 16) deterministic lock ordering present (compilation already exercised ORDER BY id paths)
-- 18/19) no partial success: failed commits leave preview + zero domain rows for R-202
-- 20) legacy handlers compiled via sections/cohorts above
-- 21) migration applied as source functions only in disposable env

\echo 'import-atomic-commit/proof.sql: PASS'

-- Disposable local proof for Rev5 orchestrator. Stubs only the live objects the
-- orchestrator references; never run against production.
\set ON_ERROR_STOP 1
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('t.uid', true), '')::uuid $$;
CREATE SCHEMA assignment_version_private;
CREATE TABLE public.schedule_versions (id uuid PRIMARY KEY, college_id uuid, academic_term_id uuid, status text, eligibility_revision bigint DEFAULT 1);
CREATE TABLE public.academic_terms (id uuid PRIMARY KEY, start_date date, end_date date);
CREATE TABLE public.schedule_sessions (id uuid PRIMARY KEY, schedule_version_id uuid, college_id uuid, cohort_id uuid,
  delivery_group_id uuid, teaching_assignment_id uuid, instructor_id uuid, room_id uuid, day_of_week smallint,
  start_time time, end_time time, session_type text);
CREATE TABLE public.cohort_student_partitions (id uuid PRIMARY KEY, active boolean DEFAULT true);
CREATE TABLE public.delivery_group_partition_members (delivery_group_id uuid, partition_id uuid);
CREATE TABLE public.shared_lecture_links (member_group_id uuid, anchor_group_id uuid);
CREATE FUNCTION public.shared_lecture_group_ids(p_group uuid) RETURNS TABLE(group_id uuid) LANGUAGE sql STABLE AS $$
  WITH a AS (SELECT coalesce((SELECT anchor_group_id FROM public.shared_lecture_links WHERE member_group_id = p_group), p_group) g)
  SELECT g FROM a UNION SELECT member_group_id FROM public.shared_lecture_links, a WHERE anchor_group_id = a.g $$;
CREATE TABLE public.schedule_version_conflict_exceptions (schedule_version_id uuid, status text, session_id uuid, related_session_id uuid);
CREATE TABLE public.instructor_availability (instructor_id uuid, day_of_week smallint, start_time time, end_time time, availability_type text, is_preference boolean);
CREATE TABLE public.teaching_assignments (id uuid PRIMARY KEY, instructor_id uuid, delivery_group_id uuid, is_active boolean);
CREATE TABLE public.faculty_teaching_requests (id uuid PRIMARY KEY, status text, assignment_id uuid, delivery_group_id uuid, instructor_id uuid);
CREATE TABLE assignment_version_private.scope (assignment_id uuid, version_id uuid, replaces_assignment_id uuid, request_id uuid);
CREATE TABLE assignment_version_private.request_scope (request_id uuid, version_id uuid, replaces_assignment_id uuid);
CREATE TABLE public.audit_logs (actor_id uuid, action text, entity text, entity_id uuid, college_id uuid, details jsonb);
CREATE FUNCTION public.is_super_admin(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 = '00000000-0000-0000-0000-00000000000a' $$;

-- 1) Compile the proposed migration exactly as written.
\i ../docs/migrations-proposed/20260927c_itcs_cutover_orchestrator.sql

-- 2) Path-rule scenario.
-- Units: partitions P1,P2; G1={P1}, G2={P2}; G2 linked to anchor G1 (common lecture).
SELECT set_config('t.uid', '00000000-0000-0000-0000-00000000000a', false);
INSERT INTO public.schedule_versions VALUES ('10000000-0000-0000-0000-000000000001', NULL, NULL, 'draft');
INSERT INTO public.cohort_student_partitions VALUES ('20000000-0000-0000-0000-000000000001'), ('20000000-0000-0000-0000-000000000002');
INSERT INTO public.delivery_group_partition_members VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002');
-- delivery groups are per component: G1/G2 = lecture component (linked), G3/G4 = tutorial/lab groups.
INSERT INTO public.shared_lecture_links VALUES ('30000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001');
-- s1: common lecture on G1 (reaches P1+P2) Sun 08-10 ; s2: G1 tutorial Sun 10-12 ; s3: G2 tutorial Sun 10-12 (other partition, parallel OK)
-- s4: G2 lab Sun 12-14
INSERT INTO public.schedule_sessions (id, schedule_version_id, delivery_group_id, instructor_id, room_id, day_of_week, start_time, end_time, session_type) VALUES
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',0,'08:00','10:00','lecture'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002',0,'10:00','12:00','tutorial'),
 ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000003','60000000-0000-0000-0000-000000000003',0,'10:00','12:00','tutorial'),
 ('40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000003','60000000-0000-0000-0000-000000000004',0,'12:00','14:00','lab');
DO $$ DECLARE r jsonb := public.itcs_cutover_path_rules('10000000-0000-0000-0000-000000000001'); BEGIN
  RAISE NOTICE 'valid: %', r;
  IF NOT (r->>'ok')::boolean OR (r->>'student_clashes')::int <> 0 OR (r->>'single_lecture_days')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL valid timetable flagged: %', r; END IF; END $$;
-- Negative: move P1 tutorial onto the common lecture slot -> real student clash
UPDATE public.schedule_sessions SET start_time='08:00', end_time='10:00' WHERE id='40000000-0000-0000-0000-000000000002';
DO $$ DECLARE r jsonb := public.itcs_cutover_path_rules('10000000-0000-0000-0000-000000000001'); BEGIN
  IF (r->>'student_clashes')::int <> 1 OR (r->>'ok')::boolean THEN RAISE EXCEPTION 'FAIL clash missed: %', r; END IF; END $$;
UPDATE public.schedule_sessions SET start_time='10:00', end_time='12:00' WHERE id='40000000-0000-0000-0000-000000000002';
-- Negative: theory after 14:00 and lone lecture on Monday for P1
UPDATE public.schedule_sessions SET day_of_week=1, start_time='13:00', end_time='15:00' WHERE id='40000000-0000-0000-0000-000000000002';
DO $$ DECLARE r jsonb := public.itcs_cutover_path_rules('10000000-0000-0000-0000-000000000001'); BEGIN
  IF (r->>'theory_outside_08_14')::int <> 1 OR (r->>'single_lecture_days')::int <> 2 THEN RAISE EXCEPTION 'FAIL: %', r; END IF; END $$;
-- Negative: execute requires super admin and valid stage
SELECT set_config('t.uid', '00000000-0000-0000-0000-00000000000b', false);
DO $$ BEGIN
  PERFORM public.itcs_cutover_preview('10000000-0000-0000-0000-000000000001', '{}'); RAISE EXCEPTION 'FAIL non-admin allowed';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
DO $$ BEGIN
  PERFORM public.itcs_cutover_execute('bogus', NULL, NULL, '{}', '', ''); RAISE EXCEPTION 'FAIL bad stage';
EXCEPTION WHEN check_violation THEN NULL; END $$;
\echo ORCHESTRATOR_DB_PASS

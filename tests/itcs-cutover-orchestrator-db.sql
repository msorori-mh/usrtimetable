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
--  cohort partitions P1,P2 ; groups G1{P1}, G2{P2}, anchor A shared lecture linking G1+G2.
INSERT INTO public.schedule_versions VALUES ('00000000-0000-0000-0000-0000000000v1'::text::uuid, NULL, NULL, 'draft') ON CONFLICT DO NOTHING;

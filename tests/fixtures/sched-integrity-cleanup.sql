-- Removes a COMMITTED sched-integrity fixture (used only by tests that must commit it).
-- Disposable database only; replica mode skips guard triggers for the cleanup deletes.
BEGIN;
CREATE SCHEMA IF NOT EXISTS tsched;
CREATE OR REPLACE FUNCTION tsched.id(text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5('tsched:'||$1)::uuid $$;
SET LOCAL session_replication_role = replica;
DELETE FROM public.schedule_sessions WHERE college_id IN (tsched.id('A'), tsched.id('B'));
DELETE FROM public.schedule_versions WHERE college_id IN (tsched.id('A'), tsched.id('B'));
DO $c$ BEGIN IF to_regclass('public.shared_lecture_links') IS NOT NULL THEN
  DELETE FROM public.shared_lecture_links WHERE college_id = tsched.id('A'); END IF; END $c$;
DELETE FROM public.delivery_group_partition_members WHERE college_id = tsched.id('A');
DELETE FROM public.delivery_groups WHERE college_id = tsched.id('A');
DELETE FROM public.cohort_student_partitions WHERE college_id = tsched.id('A');
DELETE FROM public.academic_cohorts WHERE college_id = tsched.id('A');
DELETE FROM public.plan_course_components WHERE college_id = tsched.id('A');
DELETE FROM public.plan_courses WHERE college_id = tsched.id('A');
DELETE FROM public.course_offerings WHERE college_id = tsched.id('A');
DELETE FROM public.courses WHERE college_id = tsched.id('A');
DELETE FROM public.study_plans WHERE college_id = tsched.id('A');
DELETE FROM public.academic_levels WHERE college_id = tsched.id('A');
DELETE FROM public.academic_programs WHERE college_id = tsched.id('A');
DELETE FROM public.departments WHERE college_id = tsched.id('A');
DELETE FROM public.instructors WHERE college_id = tsched.id('A');
DELETE FROM public.rooms WHERE college_id = tsched.id('A');
DELETE FROM public.academic_terms WHERE college_id IN (tsched.id('A'), tsched.id('B'));
DELETE FROM public.user_colleges WHERE college_id IN (tsched.id('A'), tsched.id('B'));
DELETE FROM public.user_roles WHERE user_id IN (tsched.id('admin-a'), tsched.id('admin-b'), tsched.id('super'), tsched.id('viewer-a'));
DELETE FROM auth.users WHERE id IN (tsched.id('admin-a'), tsched.id('admin-b'), tsched.id('super'), tsched.id('viewer-a'));
DELETE FROM public.colleges WHERE id IN (tsched.id('A'), tsched.id('B'));
DELETE FROM public.universities WHERE id = tsched.id('uni');
DROP SCHEMA IF EXISTS tsched CASCADE;
COMMIT;

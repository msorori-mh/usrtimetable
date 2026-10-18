-- H-3: every view in public runs with security_invoker, and
-- v_instructor_delivery_workload only exposes the caller's colleges, while
-- owner-rights (SECURITY DEFINER) readers still see everything.
BEGIN;
DO $$
DECLARE v text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO v FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
     AND NOT coalesce(c.reloptions && ARRAY['security_invoker=true','security_invoker=on'], false);
  IF v IS NOT NULL THEN RAISE EXCEPTION 'H-3: views without security_invoker: %', v; END IF;
END $$;

-- Fixture rows inserted with triggers/FK checks off (data shape only).
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) VALUES ('0000000b-0000-0000-0000-000000000001', 'h3@example.invalid');
INSERT INTO public.user_roles (user_id, role) VALUES ('0000000b-0000-0000-0000-000000000001', 'college_admin');
INSERT INTO public.colleges (id, university_id, name) VALUES
  ('0000000b-0000-0000-0000-0000000000c1', gen_random_uuid(), 'H3 A'),
  ('0000000b-0000-0000-0000-0000000000c2', gen_random_uuid(), 'H3 B');
INSERT INTO public.user_colleges (user_id, college_id) VALUES
  ('0000000b-0000-0000-0000-000000000001', '0000000b-0000-0000-0000-0000000000c1');
INSERT INTO public.instructors (id, college_id, full_name) VALUES
  ('0000000b-0000-0000-0000-0000000000a1', '0000000b-0000-0000-0000-0000000000c1', 'IA'),
  ('0000000b-0000-0000-0000-0000000000a2', '0000000b-0000-0000-0000-0000000000c2', 'IB');
INSERT INTO public.teaching_assignments (college_id, course_offering_id, instructor_id, delivery_group_id, assigned_component_hours) VALUES
  ('0000000b-0000-0000-0000-0000000000c1', gen_random_uuid(), '0000000b-0000-0000-0000-0000000000a1', gen_random_uuid(), 3),
  ('0000000b-0000-0000-0000-0000000000c2', gen_random_uuid(), '0000000b-0000-0000-0000-0000000000a2', gen_random_uuid(), 3);
SET LOCAL session_replication_role = origin;

-- owner / definer readers see both colleges
DO $$
BEGIN
  IF (SELECT count(*) FROM public.v_instructor_delivery_workload
       WHERE college_id IN ('0000000b-0000-0000-0000-0000000000c1','0000000b-0000-0000-0000-0000000000c2')) <> 2 THEN
    RAISE EXCEPTION 'H-3: owner no longer sees all workload rows';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '0000000b-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"0000000b-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.v_instructor_delivery_workload WHERE college_id = '0000000b-0000-0000-0000-0000000000c2') THEN
    RAISE EXCEPTION 'H-3: college A user reads college B workload through the view';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.v_instructor_delivery_workload WHERE college_id = '0000000b-0000-0000-0000-0000000000c1') THEN
    RAISE EXCEPTION 'H-3: college A user lost own workload rows';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;

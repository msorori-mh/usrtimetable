-- H-4: authenticated managers may only INSERT draft, non-disposable,
-- non-retired schedule versions.
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) VALUES ('0000000c-0000-0000-0000-000000000001', 'h4@example.invalid');
INSERT INTO public.user_roles (user_id, role) VALUES ('0000000c-0000-0000-0000-000000000001', 'college_admin');
INSERT INTO public.colleges (id, university_id, name) VALUES ('0000000c-0000-0000-0000-0000000000c1', gen_random_uuid(), 'H4');
INSERT INTO public.academic_terms (id, college_id, name, code) VALUES
  ('0000000c-0000-0000-0000-0000000000d1', '0000000c-0000-0000-0000-0000000000c1', 'T', 'T');
INSERT INTO public.user_colleges (user_id, college_id) VALUES
  ('0000000c-0000-0000-0000-000000000001', '0000000c-0000-0000-0000-0000000000c1');
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '0000000c-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"0000000c-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
DO $$
DECLARE st text;
BEGIN
  -- legitimate draft insert still works
  INSERT INTO public.schedule_versions (college_id, academic_term_id, name, status)
  VALUES ('0000000c-0000-0000-0000-0000000000c1', '0000000c-0000-0000-0000-0000000000d1', 'draft ok', 'draft');

  FOREACH st IN ARRAY ARRAY['published', 'approved', 'review', 'archived'] LOOP
    BEGIN
      INSERT INTO public.schedule_versions (college_id, academic_term_id, name, status)
      VALUES ('0000000c-0000-0000-0000-0000000000c1', '0000000c-0000-0000-0000-0000000000d1', 'bad ' || st, st);
      RAISE EXCEPTION 'H-4: direct insert with status % accepted', st;
    EXCEPTION WHEN insufficient_privilege THEN NULL;  -- RLS violation (42501)
    END;
  END LOOP;
  BEGIN
    INSERT INTO public.schedule_versions (college_id, academic_term_id, name, status, retired_at)
    VALUES ('0000000c-0000-0000-0000-0000000000c1', '0000000c-0000-0000-0000-0000000000d1', 'retired', 'draft', now());
    RAISE EXCEPTION 'H-4: pre-retired insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;

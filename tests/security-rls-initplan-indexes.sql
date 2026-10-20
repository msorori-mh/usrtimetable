-- M-4: FK/college_id indexes exist; RLS policies evaluate auth.uid() once per
-- statement; RLS still isolates colleges after the rewrite.
BEGIN;
DO $$
DECLARE v text;
BEGIN
  SELECT string_agg(format('%s.%s', tablename, policyname), ', ') INTO v
    FROM pg_policies
   WHERE schemaname = 'public'
     AND (replace(coalesce(qual, ''), '( SELECT auth.uid() AS uid)', '') LIKE '%auth.uid()%'
       OR replace(coalesce(with_check, ''), '( SELECT auth.uid() AS uid)', '') LIKE '%auth.uid()%');
  IF v IS NOT NULL THEN RAISE EXCEPTION 'M-4: policies with per-row auth.uid(): %', v; END IF;

  SELECT string_agg(k.conrelid::regclass::text || '(' || k.conname || ')', ', ') INTO v
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
   WHERE k.contype = 'f' AND c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
     AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = k.conrelid AND i.indpred IS NULL
                       AND (i.indkey::int2[])[0:cardinality(k.conkey) - 1] @> k.conkey
                       AND (i.indkey::int2[])[0:cardinality(k.conkey) - 1] <@ k.conkey);
  IF v IS NOT NULL THEN RAISE EXCEPTION 'M-4: unindexed foreign keys: %', v; END IF;

  SELECT string_agg(c.relname, ', ') INTO v
    FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'college_id' AND NOT a.attisdropped
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
     AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND (i.indkey::int2[])[0] = a.attnum);
  IF v IS NOT NULL THEN RAISE EXCEPTION 'M-4: tables without a college_id index: %', v; END IF;
END $$;

SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email) VALUES
  ('0000000f-0000-0000-0000-000000000001', 'm4a@example.invalid'),
  ('0000000f-0000-0000-0000-000000000002', 'm4none@example.invalid');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('0000000f-0000-0000-0000-000000000001', 'college_admin'),
  ('0000000f-0000-0000-0000-000000000002', 'college_admin');
INSERT INTO public.colleges (id, university_id, name) VALUES
  ('0000000f-0000-0000-0000-0000000000c1', gen_random_uuid(), 'M4 A'),
  ('0000000f-0000-0000-0000-0000000000c2', gen_random_uuid(), 'M4 B');
INSERT INTO public.user_colleges (user_id, college_id) VALUES
  ('0000000f-0000-0000-0000-000000000001', '0000000f-0000-0000-0000-0000000000c1');
INSERT INTO public.instructors (id, college_id, full_name) VALUES
  ('0000000f-0000-0000-0000-0000000000a1', '0000000f-0000-0000-0000-0000000000c1', 'IA'),
  ('0000000f-0000-0000-0000-0000000000a2', '0000000f-0000-0000-0000-0000000000c2', 'IB');
SET LOCAL session_replication_role = origin;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '0000000f-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claims', '{"sub":"0000000f-0000-0000-0000-000000000001","role":"authenticated","aal":"aal2"}', true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.instructors WHERE id IN ('0000000f-0000-0000-0000-0000000000a1','0000000f-0000-0000-0000-0000000000a2')) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.instructors WHERE id = '0000000f-0000-0000-0000-0000000000a1') THEN
    RAISE EXCEPTION 'M-4: RLS isolation on instructors broken for college A user';
  END IF;
  IF (SELECT count(*) FROM public.colleges WHERE id IN ('0000000f-0000-0000-0000-0000000000c1','0000000f-0000-0000-0000-0000000000c2')) > 1 THEN
    RAISE EXCEPTION 'M-4: college A user sees college B';
  END IF;
  -- write path: can update own college instructor, not the other one
  UPDATE public.instructors SET full_name = 'IA2' WHERE id = '0000000f-0000-0000-0000-0000000000a2';
  IF FOUND THEN RAISE EXCEPTION 'M-4: updated another college''s instructor'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', '0000000f-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claims', '{"sub":"0000000f-0000-0000-0000-000000000002","role":"authenticated","aal":"aal2"}', true);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.instructors WHERE id IN ('0000000f-0000-0000-0000-0000000000a1','0000000f-0000-0000-0000-0000000000a2')) THEN
    RAISE EXCEPTION 'M-4: user without colleges sees instructors';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;

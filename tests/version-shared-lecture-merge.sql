-- Run only in an empty disposable database (psql -v ON_ERROR_STOP=1 -f ...).
-- Regression checks for public.merge_version_shared_lecture and
-- public.unmerge_version_shared_lecture: a draft can reproduce a published
-- shared lecture of several cohorts, each keeping its own group, without any
-- global merge, and every guard stays closed.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION public.can_manage_college(u uuid, c uuid) RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT u = '00000000-0000-0000-0000-0000000000a1' AND c = '00000000-0000-0000-0000-0000000000c1' $$;
CREATE TABLE public.schedule_versions(id uuid PRIMARY KEY, college_id uuid, academic_term_id uuid, status text);
CREATE TABLE public.academic_cohorts(id uuid PRIMARY KEY, college_id uuid, term_id uuid, study_system text, active boolean);
CREATE TABLE public.courses(id uuid PRIMARY KEY, code text, name text);
CREATE TABLE public.plan_courses(id uuid PRIMARY KEY, course_id uuid);
CREATE TABLE public.plan_course_components(id uuid PRIMARY KEY, component_type text, is_timetabled boolean, weekly_contact_hours numeric);
CREATE TABLE public.delivery_groups(id uuid PRIMARY KEY, college_id uuid, cohort_id uuid, plan_course_id uuid, component_id uuid,
  active boolean, is_obsolete boolean, expected_students integer, capacity_limit integer);
CREATE TABLE public.shared_lecture_links(member_group_id uuid, anchor_group_id uuid, college_id uuid);
CREATE TABLE public.schedule_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), schedule_version_id uuid, delivery_group_id uuid,
  replaced_by_split boolean DEFAULT false);
CREATE TABLE public.audit_logs(id bigserial PRIMARY KEY, actor_id uuid, action text NOT NULL, entity text NOT NULL, entity_id uuid,
  college_id uuid, details jsonb);
CREATE SCHEMA schedule_version_delivery_private;
CREATE TABLE schedule_version_delivery_private.scope(version_id uuid, cohort_id uuid, college_id uuid, PRIMARY KEY(version_id, cohort_id));
CREATE TABLE schedule_version_delivery_private.group_facts(version_id uuid, group_id uuid, cohort_id uuid, college_id uuid,
  expected_students integer, capacity_limit integer, group_code text, PRIMARY KEY(version_id, group_id));
CREATE TABLE schedule_version_delivery_private.partner_group_facts(version_id uuid, group_id uuid, college_id uuid,
  expected_students integer CHECK (expected_students > 0), capacity_limit integer CHECK (capacity_limit > 0), PRIMARY KEY(version_id, group_id));
CREATE TABLE schedule_version_delivery_private.shared_link_facts(version_id uuid, anchor_group_id uuid, member_group_id uuid, college_id uuid,
  PRIMARY KEY(version_id, anchor_group_id, member_group_id));

\ir ../supabase/migrations/20261015200000_version_shared_lecture_merge.sql

-- Fixture: college c1, term t1; draft d1, published p1, a draft of another college x1.
INSERT INTO public.schedule_versions VALUES
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000e1','draft'),
 ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000e1','published');
-- Cohorts 1..6 (AT, AR, EN, IS level 1; AR level 3; MA level 1).
INSERT INTO public.academic_cohorts SELECT ('00000000-0000-0000-0000-00000000010'||n)::uuid,
 '00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000e1','regular',true FROM generate_series(1,6) n;
INSERT INTO public.courses VALUES
 ('00000000-0000-0000-0000-000000000201','USR03','مهارات اللغة الإنجليزية (1)'),
 ('00000000-0000-0000-0000-000000000202','USR03','مهارات اللغة الانجليزية (1)'),
 ('00000000-0000-0000-0000-000000000203','ISA103','مقدمة في علم الحديث'),
 ('00000000-0000-0000-0000-000000000204','ARA322','مقدمة في علم الحديث'),
 ('00000000-0000-0000-0000-000000000205','USR05','الثقافة الإسلامية (1)'),
 ('00000000-0000-0000-0000-000000000206','ISX105','ثقافة إسلامية (1)'),
 ('00000000-0000-0000-0000-000000000207','ARA317','النحو (4)');
INSERT INTO public.plan_courses SELECT ('00000000-0000-0000-0000-00000000030'||n)::uuid, ('00000000-0000-0000-0000-00000000020'||n)::uuid
 FROM generate_series(1,7) n;
INSERT INTO public.plan_course_components VALUES
 ('00000000-0000-0000-0000-000000000401','theory',true,2),
 ('00000000-0000-0000-0000-000000000402','theory',true,3),
 ('00000000-0000-0000-0000-000000000403','practical',true,2);
-- groups: g1..g4 USR03 for AT/AR/EN (course 201) and IS (course 202, same code);
-- g5 ISA103 (IS), g6 ARA322 (AR L3); g7 USR05 (AT), g8 ISX105 (MA, same name);
-- g9 ARA317 (AR L3, other course); g10 USR03 for MA with 3 weekly hours; g11 practical.
INSERT INTO public.delivery_groups VALUES
 ('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401',true,false,29,29),
 ('00000000-0000-0000-0000-000000000502','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401',true,false,15,15),
 ('00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000401',true,false,57,57),
 ('00000000-0000-0000-0000-000000000504','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000401',true,false,80,220),
 ('00000000-0000-0000-0000-000000000505','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000401',true,false,80,80),
 ('00000000-0000-0000-0000-000000000506','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000304','00000000-0000-0000-0000-000000000401',true,false,14,14),
 ('00000000-0000-0000-0000-000000000507','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000305','00000000-0000-0000-0000-000000000401',true,false,29,29),
 ('00000000-0000-0000-0000-000000000508','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000306','00000000-0000-0000-0000-000000000401',true,false,80,80),
 ('00000000-0000-0000-0000-000000000509','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000307','00000000-0000-0000-0000-000000000401',true,false,14,14),
 ('00000000-0000-0000-0000-000000000510','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000402',true,false,80,80),
 ('00000000-0000-0000-0000-000000000511','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000403',true,false,80,80);

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_code text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE p_code || '%' THEN
      RAISE EXCEPTION 'expected %, got %', p_code, SQLERRM;
    END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'expected %, but the call succeeded: %', p_code, p_sql;
END $$;

SET test.uid = '00000000-0000-0000-0000-0000000000a1';

-- 1. Four cohorts attend one lecture, as in the published timetable.
DO $$ DECLARE r jsonb; BEGIN
  r := public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
    '00000000-0000-0000-0000-000000000501',
    ARRAY['00000000-0000-0000-0000-000000000502','00000000-0000-0000-0000-000000000503','00000000-0000-0000-0000-000000000504']::uuid[],
    'مطابقة دمج الجدول المنشور');
  IF (r->>'added')::int <> 3 OR (r->>'expected_students')::int <> 181 THEN
    RAISE EXCEPTION 'four-cohort merge: %', r;
  END IF;
  IF (SELECT count(*) FROM schedule_version_delivery_private.partner_group_facts) <> 4 THEN
    RAISE EXCEPTION 'every merged group needs its own size fact';
  END IF;
  IF EXISTS (SELECT 1 FROM public.shared_lecture_links) THEN
    RAISE EXCEPTION 'a version merge must not create a global merge';
  END IF;
  -- Idempotent repeat.
  r := public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
    '00000000-0000-0000-0000-000000000501', ARRAY['00000000-0000-0000-0000-000000000502']::uuid[],
    'مطابقة دمج الجدول المنشور');
  IF (r->>'added')::int <> 0 THEN RAISE EXCEPTION 'repeat added rows: %', r; END IF;
END $$;

-- 2. The same lecture under two course codes with the same name, and a name
--    spelled with/without the article.
SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000505', ARRAY['00000000-0000-0000-0000-000000000506']::uuid[], 'علم الحديث مع العربي م3');
SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000507', ARRAY['00000000-0000-0000-0000-000000000508']::uuid[], 'الثقافة الإسلامية مشتركة');

-- 3. Guards.
SELECT pg_temp.expect_error($q$SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000505', ARRAY['00000000-0000-0000-0000-000000000509']::uuid[], 'مقرر مختلف تماما')$q$,
  'VERSION_SHARED_COURSE_MISMATCH');
SELECT pg_temp.expect_error($q$SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000501', ARRAY['00000000-0000-0000-0000-000000000510']::uuid[], 'ساعات مختلفة للمقرر')$q$,
  'VERSION_SHARED_CONTEXT_MISMATCH');
SELECT pg_temp.expect_error($q$SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000501', ARRAY['00000000-0000-0000-0000-000000000511']::uuid[], 'مجموعة عملية لا تدمج')$q$,
  'VERSION_SHARED_THEORY_ONLY');
SELECT pg_temp.expect_error($q$SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-000000000509', ARRAY['00000000-0000-0000-0000-000000000506']::uuid[], 'الجدول المنشور ثابت')$q$,
  'VERSION_SHARED_DRAFT_ONLY');
SELECT pg_temp.expect_error($q$SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000503', ARRAY['00000000-0000-0000-0000-000000000504']::uuid[], 'عضو مدمج سابقا كمرساة')$q$,
  'VERSION_SHARED_CHAIN_FORBIDDEN');
SELECT pg_temp.expect_error($q$SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000510', ARRAY['00000000-0000-0000-0000-000000000502']::uuid[], 'عضو مرتبط بمرساة أخرى')$q$,
  'VERSION_SHARED_CONTEXT_MISMATCH');
SELECT pg_temp.expect_error($q$SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000501', ARRAY['00000000-0000-0000-0000-000000000501']::uuid[], 'المرساة لا تكون عضوا')$q$,
  'VERSION_SHARED_INVALID_MEMBERS');
SELECT pg_temp.expect_error($q$SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000509', ARRAY['00000000-0000-0000-0000-000000000506']::uuid[], 'قصير')$q$,
  'VERSION_SHARED_REASON_REQUIRED');
-- A member of one lecture cannot join another anchor.
UPDATE public.delivery_groups SET plan_course_id='00000000-0000-0000-0000-000000000304'
 WHERE id='00000000-0000-0000-0000-000000000509';
SELECT pg_temp.expect_error($q$SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000509', ARRAY['00000000-0000-0000-0000-000000000506']::uuid[], 'عضو مرتبط بمحاضرة أخرى')$q$,
  'VERSION_SHARED_SAME_COHORT');
-- A group already in a global merge stays with the global model.
INSERT INTO public.shared_lecture_links VALUES ('00000000-0000-0000-0000-000000000509','00000000-0000-0000-0000-000000000510','00000000-0000-0000-0000-0000000000c1');
SELECT pg_temp.expect_error($q$SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000505', ARRAY['00000000-0000-0000-0000-000000000509']::uuid[], 'مدمج دمجا عاما سابقا')$q$,
  'VERSION_SHARED_GLOBAL_LINK_EXISTS');
DELETE FROM public.shared_lecture_links;
-- Already a member of another lecture in this draft.
UPDATE public.delivery_groups SET cohort_id='00000000-0000-0000-0000-000000000106'
 WHERE id='00000000-0000-0000-0000-000000000509';
SELECT pg_temp.expect_error($q$SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000509', ARRAY['00000000-0000-0000-0000-000000000506']::uuid[], 'عضو في محاضرة أخرى')$q$,
  'VERSION_SHARED_ALREADY_LINKED');
-- A member that already has its own session in the draft.
INSERT INTO public.schedule_sessions(schedule_version_id, delivery_group_id)
VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000509');
SELECT pg_temp.expect_error($q$SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000505', ARRAY['00000000-0000-0000-0000-000000000509']::uuid[], 'عضو له جلسة مستقلة')$q$,
  'VERSION_SHARED_SCHEDULED');
DELETE FROM public.schedule_sessions;
-- Another college's manager cannot merge here.
SET test.uid = '00000000-0000-0000-0000-0000000000a2';
SELECT pg_temp.expect_error($q$SELECT public.merge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000509', ARRAY['00000000-0000-0000-0000-000000000510']::uuid[], 'مستخدم غير مخول')$q$,
  'insufficient_privilege');
SELECT pg_temp.expect_error($q$SELECT public.unmerge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000502', 'مستخدم غير مخول')$q$, 'insufficient_privilege');
SET test.uid = '00000000-0000-0000-0000-0000000000a1';

-- 4. Unmerge only before the lecture is placed.
INSERT INTO public.schedule_sessions(schedule_version_id, delivery_group_id)
VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000501');
SELECT pg_temp.expect_error($q$SELECT public.unmerge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000502', 'فصل العربي عن المحاضرة')$q$, 'VERSION_SHARED_SCHEDULED');
DELETE FROM public.schedule_sessions;
SELECT public.unmerge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000502', 'فصل العربي عن المحاضرة');
SELECT pg_temp.expect_error($q$SELECT public.unmerge_version_shared_lecture('00000000-0000-0000-0000-0000000000d1',
  '00000000-0000-0000-0000-000000000502', 'فصل العربي عن المحاضرة')$q$, 'VERSION_SHARED_NOT_LINKED');

DO $$ BEGIN
  IF (SELECT count(*) FROM schedule_version_delivery_private.shared_link_facts) <> 4 THEN
    RAISE EXCEPTION 'unexpected link facts: %', (SELECT count(*) FROM schedule_version_delivery_private.shared_link_facts);
  END IF;
  IF (SELECT count(*) FROM public.audit_logs WHERE action='merge_version_shared_lecture') <> 4
     OR (SELECT count(*) FROM public.audit_logs WHERE action='unmerge_version_shared_lecture') <> 1 THEN
    RAISE EXCEPTION 'audit rows missing';
  END IF;
  IF has_function_privilege('anon','public.merge_version_shared_lecture(uuid,uuid,uuid[],text)','EXECUTE') THEN
    RAISE EXCEPTION 'anon can merge';
  END IF;
END $$;
SELECT 'VERSION_SHARED_LECTURE_MERGE_OK';

-- Synthetic fixtures for an isolated, disposable database only.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
END $$;
CREATE SCHEMA auth;
CREATE SCHEMA schedule_version_delivery_private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE FUNCTION public.can_view_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT u=md5('reader')::uuid AND c=md5('college')::uuid $$;
CREATE TABLE schedule_versions(id uuid PRIMARY KEY,college_id uuid,academic_term_id uuid);
CREATE TABLE academic_cohorts(id uuid PRIMARY KEY,college_id uuid,term_id uuid);
CREATE TABLE delivery_groups(id uuid PRIMARY KEY,college_id uuid,cohort_id uuid);
CREATE TABLE teaching_assignments(id uuid PRIMARY KEY,is_active boolean);
CREATE TABLE schedule_sessions(id uuid PRIMARY KEY,schedule_version_id uuid,college_id uuid,delivery_group_id uuid,teaching_assignment_id uuid,day_of_week integer,replaced_by_split boolean);
CREATE TABLE shared_lecture_links(anchor_group_id uuid,member_group_id uuid);
CREATE TABLE schedule_version_delivery_private.scope(version_id uuid,cohort_id uuid);
CREATE TABLE schedule_version_delivery_private.partner_group_facts(version_id uuid,group_id uuid);
CREATE TABLE schedule_version_delivery_private.shared_link_facts(version_id uuid,college_id uuid,anchor_group_id uuid,member_group_id uuid);
CREATE TABLE test_catalogue(version_id uuid,group_id uuid);
-- Dependency contract: exact catalogue membership, maximum batch size 100.
CREATE FUNCTION schedule_version_delivery_group_catalog(v uuid,cohorts uuid[])
RETURNS TABLE(id uuid) LANGUAGE plpgsql STABLE AS $$ BEGIN
  IF cardinality(cohorts)>100 THEN RAISE EXCEPTION 'oversized batch'; END IF;
  RETURN QUERY SELECT g.id FROM delivery_groups g JOIN test_catalogue c ON c.group_id=g.id
    WHERE c.version_id=v AND g.cohort_id=ANY(cohorts);
END $$;
INSERT INTO schedule_versions VALUES
  (md5('draft')::uuid,md5('college')::uuid,md5('term')::uuid),
  (md5('old-version')::uuid,md5('college')::uuid,md5('term')::uuid),
  (md5('foreign-version')::uuid,md5('foreign-college')::uuid,md5('term')::uuid);
INSERT INTO academic_cohorts VALUES
  (md5('frozen-cohort')::uuid,md5('college')::uuid,md5('term')::uuid),
  (md5('unscoped-cohort')::uuid,md5('college')::uuid,md5('term')::uuid),
  (md5('foreign-cohort')::uuid,md5('foreign-college')::uuid,md5('term')::uuid),
  (md5('other-term-cohort')::uuid,md5('college')::uuid,md5('other-term')::uuid);
INSERT INTO academic_cohorts SELECT md5('batch-cohort-'||n)::uuid,md5('college')::uuid,md5('term')::uuid FROM generate_series(1,101) n;
INSERT INTO delivery_groups SELECT md5(label)::uuid,md5('college')::uuid,md5('frozen-cohort')::uuid
  FROM unnest(ARRAY['anchor','member','missing','old-parent','new-operational-member','partner-anchor','partner-member','direct-only']) label;
INSERT INTO delivery_groups SELECT md5(label)::uuid,md5('college')::uuid,md5('unscoped-cohort')::uuid
  FROM unnest(ARRAY['unscoped-anchor','unscoped-member']) label;
INSERT INTO delivery_groups VALUES
  (md5('foreign-group')::uuid,md5('foreign-college')::uuid,md5('foreign-cohort')::uuid),
  (md5('other-term-group')::uuid,md5('college')::uuid,md5('other-term-cohort')::uuid);
INSERT INTO delivery_groups SELECT md5('batch-group-'||n)::uuid,md5('college')::uuid,md5('batch-cohort-'||n)::uuid FROM generate_series(1,101) n;
INSERT INTO test_catalogue SELECT md5('draft')::uuid,id FROM delivery_groups
  WHERE id NOT IN (md5('member')::uuid,md5('old-parent')::uuid,md5('direct-only')::uuid);
INSERT INTO schedule_version_delivery_private.scope VALUES(md5('draft')::uuid,md5('frozen-cohort')::uuid);
INSERT INTO schedule_version_delivery_private.partner_group_facts VALUES(md5('draft')::uuid,md5('partner-anchor')::uuid);
INSERT INTO schedule_version_delivery_private.shared_link_facts VALUES
  (md5('draft')::uuid,md5('college')::uuid,md5('anchor')::uuid,md5('member')::uuid),
  (md5('old-version')::uuid,md5('college')::uuid,md5('anchor')::uuid,md5('new-operational-member')::uuid);
INSERT INTO shared_lecture_links VALUES
  (md5('anchor')::uuid,md5('new-operational-member')::uuid),
  (md5('unscoped-anchor')::uuid,md5('unscoped-member')::uuid),
  (md5('partner-anchor')::uuid,md5('partner-member')::uuid);
INSERT INTO teaching_assignments VALUES(md5('active')::uuid,true),(md5('inactive')::uuid,false);
INSERT INTO schedule_sessions VALUES
  (md5('tuesday')::uuid,md5('draft')::uuid,md5('college')::uuid,md5('anchor')::uuid,md5('active')::uuid,2,false),
  (md5('saturday')::uuid,md5('draft')::uuid,md5('college')::uuid,md5('anchor')::uuid,md5('active')::uuid,6,NULL),
  (md5('duplicate')::uuid,md5('draft')::uuid,md5('college')::uuid,md5('anchor')::uuid,md5('active')::uuid,2,false),
  (md5('replaced')::uuid,md5('draft')::uuid,md5('college')::uuid,md5('anchor')::uuid,md5('active')::uuid,1,true),
  (md5('inactive')::uuid,md5('draft')::uuid,md5('college')::uuid,md5('anchor')::uuid,md5('inactive')::uuid,3,false),
  (md5('no-assignment')::uuid,md5('draft')::uuid,md5('college')::uuid,md5('anchor')::uuid,NULL,4,false),
  (md5('old-session')::uuid,md5('old-version')::uuid,md5('college')::uuid,md5('anchor')::uuid,md5('active')::uuid,5,false),
  (md5('foreign-session')::uuid,md5('draft')::uuid,md5('foreign-college')::uuid,md5('anchor')::uuid,md5('active')::uuid,4,false),
  (md5('fallback')::uuid,md5('draft')::uuid,md5('college')::uuid,md5('unscoped-anchor')::uuid,md5('active')::uuid,0,false),
  (md5('partner')::uuid,md5('draft')::uuid,md5('college')::uuid,md5('partner-anchor')::uuid,md5('active')::uuid,1,false),
  (md5('direct')::uuid,md5('draft')::uuid,md5('college')::uuid,md5('direct-only')::uuid,md5('active')::uuid,3,false);
CREATE TEMP TABLE before_reads AS SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) fingerprint FROM schedule_sessions s;

-- INSTALL_MIGRATION

SELECT set_config('test.actor',md5('reader'),true);
CREATE TEMP TABLE result AS SELECT public.schedule_version_assignment_placement_context(md5('draft')::uuid) payload;
CREATE FUNCTION check_test(ok boolean,message text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF;
END $$;
CREATE FUNCTION result_group(label text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT g FROM result CROSS JOIN LATERAL jsonb_array_elements(payload->'groups') g WHERE g->>'group_id'=md5(label)::uuid::text
$$;
SELECT check_test(result_group('anchor')->'days'='[6,2]'::jsonb,'direct days, deduplication, inactive and split exclusion');
SELECT check_test(result_group('member')->'days'='[6,2]'::jsonb AND result_group('member')->'shared_lecture'='true'::jsonb AND result_group('member')->'in_version'='true'::jsonb,'shared member inheritance');
SELECT check_test(result_group('new-operational-member')->'days'='[]'::jsonb AND result_group('new-operational-member')->'shared_lecture'='false'::jsonb,'operational and historical links must not leak into frozen version');
SELECT check_test(result_group('unscoped-member')->'days'='[0]'::jsonb,'unscoped fallback');
SELECT check_test(result_group('partner-member')->'days'='[]'::jsonb,'partner snapshot blocks operational link fallback');
SELECT check_test(result_group('missing')->'in_version'='true'::jsonb AND result_group('missing')->'days'='[]'::jsonb,'genuine unscheduled group retained');
SELECT check_test(result_group('old-parent')->'in_version'='false'::jsonb AND result_group('old-parent')->'days'='[]'::jsonb,'old parent outside catalogue');
SELECT check_test(result_group('direct-only')->'in_version'='true'::jsonb AND result_group('direct-only')->'days'='[3]'::jsonb,'actual direct sessions retained');
SELECT check_test(result_group('foreign-group') IS NULL AND result_group('other-term-group') IS NULL,'college and term isolation');
SELECT check_test(result_group('batch-group-101')->'in_version'='true'::jsonb,'catalogue batching above 100 cohorts');
SELECT check_test((SELECT count(*) FROM result CROSS JOIN LATERAL jsonb_array_elements(payload->'groups'))=111,'complete group set');
SELECT check_test((SELECT fingerprint FROM before_reads)=(SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM schedule_sessions s),'read-only schedule');
SELECT check_test(NOT has_function_privilege('anon','schedule_version_assignment_placement_context(uuid)','EXECUTE'),'anonymous access revoked');
SELECT check_test(has_function_privilege('authenticated','schedule_version_assignment_placement_context(uuid)','EXECUTE'),'authenticated access allowed');
DO $$ BEGIN
  BEGIN PERFORM schedule_version_assignment_placement_context(md5('foreign-version')::uuid); RAISE EXCEPTION 'foreign college accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM schedule_version_assignment_placement_context(md5('absent')::uuid); RAISE EXCEPTION 'unknown version accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('test.actor','',true);
  BEGIN PERFORM schedule_version_assignment_placement_context(md5('draft')::uuid); RAISE EXCEPTION 'anonymous accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('test.actor',md5('outsider'),true);
  BEGIN PERFORM schedule_version_assignment_placement_context(md5('draft')::uuid); RAISE EXCEPTION 'unauthorized reader accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;

\set ON_ERROR_STOP on
\ir faculty-numbering.sql
\ir ../supabase/migrations/20260918060000_stable_university_faculty_registry.sql
DO $$ BEGIN
  IF EXISTS ((SELECT * FROM instructors EXCEPT SELECT * FROM before_instructors) UNION ALL
    (SELECT * FROM before_instructors EXCEPT SELECT * FROM instructors)) THEN RAISE EXCEPTION 'instructor data changed'; END IF;
  IF (SELECT count(*) FROM faculty_identities)<>2 THEN RAISE EXCEPTION 'name-only merge'; END IF;
  IF (SELECT count(*) FROM faculty_identities WHERE university_number LIKE 'USABA-HUM-%')<>2 THEN RAISE EXCEPTION 'affiliation prefix'; END IF;
END $$;
UPDATE instructors SET affiliation_college_id=college_id,employee_number='UPDATED' WHERE id='00000000-0000-0000-0000-000000000021';
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000002',false);
SET ROLE authenticated;
DO $$ BEGIN
  IF (SELECT count(*) FROM get_instructor_university_numbers(ARRAY['00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000022']::uuid[]))<>1 THEN RAISE EXCEPTION 'college leak'; END IF;
  BEGIN
    PERFORM link_verified_faculty_identity('00000000-0000-0000-0000-000000000021','USABA-HUM-000002');
    RAISE EXCEPTION 'viewer can link';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM 1 FROM faculty_identities;
    RAISE EXCEPTION 'registry exposed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('test.actor','00000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
SELECT link_verified_faculty_identity('00000000-0000-0000-0000-000000000021','USABA-HUM-000002');
RESET ROLE;
INSERT INTO instructors VALUES('00000000-0000-0000-0000-000000000023','00000000-0000-0000-0000-000000000011',null,null,'New hourly',now());
DO $$ BEGIN
  IF (SELECT count(DISTINCT identity_id) FROM faculty_identity_links WHERE instructor_id IN ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000022'))<>1 THEN RAISE EXCEPTION 'link failed'; END IF;
  IF (SELECT count(*) FROM faculty_identity_aliases)<>1 THEN RAISE EXCEPTION 'old code lost'; END IF;
  IF NOT EXISTS(SELECT 1 FROM faculty_identities WHERE university_number='USABA-ITCS-000003') THEN RAISE EXCEPTION 'automatic numbering failed'; END IF;
  IF (SELECT count(*) FROM audit_logs)<>1 THEN RAISE EXCEPTION 'audit missing'; END IF;
END $$;
SELECT 'FACULTY_NUMBERING_PASS';

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const target = process.env.COMPACTION_TEST_DATABASE_URL;
const url = target ? new URL(target) : null;
if (
  process.env.COMPACTION_TEST_DISPOSABLE !== "1" ||
  !url ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  !url.pathname.endsWith("_test")
)
  throw new Error("Disposable localhost database required");
test("support head persists; academic compatibility, quotas, clearing, tenant isolation and read-only permissions", () => {
  const migration = readFileSync(
    new URL("../supabase/sql/instructor_support_departments.sql", import.meta.url),
    "utf8",
  );
  const sql = `BEGIN;
 DROP SCHEMA public CASCADE; CREATE SCHEMA public;
 GRANT USAGE ON SCHEMA public TO authenticated;
 CREATE TABLE colleges(id uuid PRIMARY KEY);
 CREATE TABLE departments(id uuid PRIMARY KEY,college_id uuid);
 CREATE TABLE instructor_types(id uuid PRIMARY KEY,code text);
 CREATE TABLE instructors(id uuid PRIMARY KEY,college_id uuid,department_id uuid,
 affiliation_college_id uuid,affiliation_department_id uuid,administrative_department_id uuid,
 administrative_position text,administrative_release_hours numeric,max_weekly_hours numeric,instructor_type_id uuid);
 CREATE FUNCTION can_manage_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u=md5('manager')::uuid AND c=md5('college')::uuid $$;
 CREATE FUNCTION can_view_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u IN (md5('manager')::uuid,md5('reader')::uuid) AND c=md5('college')::uuid $$;
 INSERT INTO colleges VALUES(md5('college')::uuid),(md5('other')::uuid);
 INSERT INTO departments VALUES(md5('academic')::uuid,md5('college')::uuid);
 INSERT INTO instructor_types VALUES(md5('hourly')::uuid,'con');
 ${migration}
 CREATE TRIGGER trg_instructors_hr_affiliation BEFORE INSERT OR UPDATE ON instructors
 FOR EACH ROW EXECUTE FUNCTION enforce_instructor_hr_affiliation();
 INSERT INTO support_departments(id,college_id,name) VALUES
 (md5('quality')::uuid,md5('college')::uuid,'قسم الجودة'),
 (md5('otherquality')::uuid,md5('other')::uuid,'قسم الجودة');
 INSERT INTO instructors(id,college_id,department_id,administrative_position,administrative_support_department_id,max_weekly_hours,administrative_release_hours)
 VALUES(md5('teacher')::uuid,md5('college')::uuid,md5('academic')::uuid,'department_head',md5('quality')::uuid,12,2);
 DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM instructors WHERE department_id=md5('academic')::uuid AND administrative_support_department_id=md5('quality')::uuid AND max_weekly_hours=12 AND administrative_release_hours=2) THEN RAISE EXCEPTION 'support save failed'; END IF;
 BEGIN
 UPDATE instructors SET administrative_department_id=md5('academic')::uuid;
 RAISE EXCEPTION 'both accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='both accepted' THEN RAISE; END IF; END;
 BEGIN
 UPDATE instructors SET administrative_support_department_id=md5('otherquality')::uuid;
 RAISE EXCEPTION 'cross tenant accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='cross tenant accepted' THEN RAISE; END IF; END;
 BEGIN
 UPDATE instructors SET administrative_support_department_id=NULL;
 RAISE EXCEPTION 'missing head accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='missing head accepted' THEN RAISE; END IF; END;
 END $$;
 UPDATE instructors SET administrative_support_department_id=NULL,administrative_department_id=md5('academic')::uuid;
 UPDATE instructors SET administrative_position=NULL;
 DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM instructors WHERE administrative_department_id IS NOT NULL OR administrative_support_department_id IS NOT NULL) THEN RAISE EXCEPTION 'not cleared'; END IF;
 END $$;
 UPDATE instructors SET administrative_position='department_head',administrative_support_department_id=md5('quality')::uuid;
 UPDATE instructors SET instructor_type_id=md5('hourly')::uuid;
 DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM instructors WHERE administrative_position IS NOT NULL OR administrative_support_department_id IS NOT NULL OR administrative_release_hours<>0) THEN RAISE EXCEPTION 'hourly not cleared'; END IF;
 IF has_function_privilege('anon','enforce_instructor_hr_affiliation()','EXECUTE') THEN RAISE EXCEPTION 'trigger exposed'; END IF;
 END $$;
 SELECT set_config('request.jwt.claim.sub',md5('manager'),true);
 SET LOCAL ROLE authenticated;
 INSERT INTO support_departments(college_id,name) VALUES(md5('college')::uuid,'الدعم');
 DO $$ BEGIN
 BEGIN
 INSERT INTO support_departments(college_id,name) VALUES(md5('other')::uuid,'forbidden');
 RAISE EXCEPTION 'foreign write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT count(*) FROM support_departments)<>2 THEN RAISE EXCEPTION 'foreign rows visible'; END IF;
 END $$;
 UPDATE support_departments SET name='الدعم المؤسسي' WHERE name='الدعم';
 SELECT set_config('request.jwt.claim.sub',md5('reader'),true);
 DO $$ BEGIN
 BEGIN
 INSERT INTO support_departments(college_id,name) VALUES(md5('college')::uuid,'forbidden');
 RAISE EXCEPTION 'reader insert accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE support_departments SET name='forbidden' WHERE name='الدعم المؤسسي';
 IF FOUND THEN RAISE EXCEPTION 'reader update accepted'; END IF;
 END $$;
 RESET ROLE;
 ${migration}
 DO $$ BEGIN
 IF (SELECT count(*) FROM support_departments)<>3 THEN RAISE EXCEPTION 'idempotence changed data'; END IF;
 END $$;
 ROLLBACK;`;
  const r = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "--dbname", target], {
    input: sql,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(r.status, 0, r.stderr || String(r.error));
});

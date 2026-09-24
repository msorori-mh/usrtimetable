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
test("program selection persists, rejects cross-college and stale writes, supports clearing and RLS", () => {
  const migration = readFileSync(
    new URL("../supabase/sql/course_program_links.sql", import.meta.url),
    "utf8",
  );
  const fixture = `BEGIN;
    DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO authenticated;
    CREATE TABLE colleges(id uuid PRIMARY KEY);
    CREATE TABLE academic_programs(id uuid PRIMARY KEY,college_id uuid);
    CREATE TABLE courses(id uuid PRIMARY KEY,college_id uuid,course_nature text,is_shared boolean,updated_at timestamptz);
    CREATE TABLE study_plans(id uuid PRIMARY KEY,college_id uuid,program_id uuid,is_active boolean);
    CREATE TABLE plan_courses(id uuid PRIMARY KEY,college_id uuid,course_id uuid,study_plan_id uuid);
    CREATE FUNCTION public.can_manage_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u=md5('manager')::uuid AND c=md5('college')::uuid $$;
    CREATE FUNCTION public.can_view_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u IN (md5('manager')::uuid,md5('reader')::uuid) AND c=md5('college')::uuid $$;
    INSERT INTO colleges VALUES(md5('college')::uuid),(md5('other')::uuid);
    INSERT INTO academic_programs VALUES(md5('p1')::uuid,md5('college')::uuid),(md5('p2')::uuid,md5('college')::uuid),(md5('p3')::uuid,md5('other')::uuid);
    INSERT INTO courses VALUES(md5('course')::uuid,md5('college')::uuid,'department',false,'2026-01-01');
    INSERT INTO study_plans VALUES(md5('plan')::uuid,md5('college')::uuid,md5('p1')::uuid,true);
    INSERT INTO plan_courses VALUES(md5('pc')::uuid,md5('college')::uuid,md5('course')::uuid,md5('plan')::uuid);
    GRANT SELECT ON academic_programs, courses TO authenticated; GRANT UPDATE ON courses TO authenticated;
    CREATE TABLE public.course_programs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), college_id uuid, course_id uuid, program_id uuid, UNIQUE(college_id,course_id,program_id));
    ALTER TABLE course_programs ENABLE ROW LEVEL SECURITY;
    CREATE POLICY cp_read ON course_programs FOR SELECT TO authenticated USING(can_view_college(auth.uid(),college_id));
    CREATE POLICY cp_insert ON course_programs FOR INSERT TO authenticated WITH CHECK(can_manage_college(auth.uid(),college_id));
    CREATE POLICY cp_delete ON course_programs FOR DELETE TO authenticated USING(can_manage_college(auth.uid(),college_id));
    GRANT SELECT,INSERT,DELETE ON course_programs TO authenticated;
    ${migration}
    SELECT set_config('request.jwt.claim.sub',md5('manager'),true);
    SET LOCAL ROLE authenticated;
    SELECT save_course_programs(md5('college')::uuid,md5('course')::uuid,'college',ARRAY[md5('p1')::uuid,md5('p2')::uuid], '2026-01-01',true);
    DO $$ BEGIN
      IF (SELECT count(*) FROM course_programs)<>2 THEN RAISE EXCEPTION 'selection not saved'; END IF;
      IF NOT (SELECT is_shared FROM courses LIMIT 1) THEN RAISE EXCEPTION 'shared flag not updated'; END IF;
      BEGIN
        PERFORM save_course_programs(md5('college')::uuid,md5('course')::uuid,'college',ARRAY[md5('p3')::uuid], (SELECT updated_at FROM courses LIMIT 1),false);
        RAISE EXCEPTION 'cross college accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM='cross college accepted' THEN RAISE; END IF; END;
      IF (SELECT count(*) FROM course_programs)<>2 THEN RAISE EXCEPTION 'rejection changed links'; END IF;
      BEGIN
        PERFORM save_course_programs(md5('college')::uuid,md5('course')::uuid,'college','{}','2026-01-01',true);
        RAISE EXCEPTION 'stale write accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM='stale write accepted' THEN RAISE; END IF; END;
    END $$;
    SELECT set_config('request.jwt.claim.sub',md5('reader'),true);
    DO $$ BEGIN
      BEGIN
        PERFORM save_course_programs(md5('college')::uuid,md5('course')::uuid,'college','{}',(SELECT updated_at FROM courses LIMIT 1),false);
        RAISE EXCEPTION 'reader write accepted';
      EXCEPTION WHEN raise_exception THEN IF SQLERRM='reader write accepted' THEN RAISE; END IF; END;
    END $$;
    SELECT set_config('request.jwt.claim.sub',md5('manager'),true);
    SELECT save_course_programs(md5('college')::uuid,md5('course')::uuid,'department','{}',(SELECT updated_at FROM courses LIMIT 1),false);
    RESET ROLE;
    ${migration}
    DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM course_programs) THEN RAISE EXCEPTION 'removed choices restored'; END IF;
      IF (SELECT is_shared FROM courses LIMIT 1) THEN RAISE EXCEPTION 'clear did not reset shared'; END IF;
      IF has_function_privilege('anon','public.save_course_programs(uuid,uuid,text,uuid[],timestamptz,boolean)','EXECUTE') THEN RAISE EXCEPTION 'anonymous RPC granted'; END IF;
    END $$;
    ROLLBACK;`;
  const result = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "--dbname", target], {
    input: fixture,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});

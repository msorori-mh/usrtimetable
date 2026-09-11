import test, { before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const target = process.env.HEADCOUNT_TEST_DATABASE_URL;
const url = target ? new URL(target) : null;
if (process.env.HEADCOUNT_TEST_DISPOSABLE !== "1" || !url || !["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/headcount_import_test") throw new Error("A disposable localhost headcount_import_test database is required");
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--dbname", target];
function sql(s) {
  const r = spawnSync("psql", args, { input: s, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr || String(r.error)); return r.stdout.trim();
}
const id = (s) => `md5('${s}')::uuid`;
const asManager = `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',md5('manager'),true);`;
const payload = (s, n = 20) => `(SELECT jsonb_build_object('cohort_id',c.id,'term_id',c.term_id,'cohort_version',md5(to_jsonb(c)::text),'expected_version',CASE WHEN h.id IS NULL THEN NULL ELSE md5(to_jsonb(h)::text) END,'registered_student_count',${n},'eligible_student_count',${n},'expected_attendance_count',${n},'reserve_margin',0,'scheduling_headcount',${n},'exam_eligible_count',${n},'source','TEST_ONLY','notes',NULL,'allow_over_eligible',false) FROM academic_cohorts c LEFT JOIN scheduling_cohort_term_headcounts h ON h.cohort_id=c.id WHERE c.id=${id(s)})`;
const call = (rows, action = "save", college = "college") => `public.import_scheduling_headcounts(${id(college)},${rows},'${action}')`;
before(() => {
  assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"), "0");
  sql(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE TABLE colleges(id uuid PRIMARY KEY);
    CREATE TABLE academic_programs(id uuid PRIMARY KEY,college_id uuid,code text,name text);
    CREATE TABLE academic_levels(id uuid PRIMARY KEY,program_id uuid,level_number int);
    CREATE TABLE academic_terms(id uuid PRIMARY KEY,college_id uuid,code text,name text,is_active boolean,UNIQUE(id,college_id));
    CREATE TABLE academic_cohorts(id uuid PRIMARY KEY,college_id uuid,program_id uuid,level_id uuid,term_id uuid,code text,study_system text,entry_year int,expected_students int,active boolean,UNIQUE(id,college_id));
    CREATE TABLE course_offerings(id uuid PRIMARY KEY); CREATE TABLE plan_course_components(id uuid PRIMARY KEY);
    CREATE TABLE audit_logs(actor_id uuid,action text,entity text,entity_id uuid,college_id uuid,details jsonb);
    CREATE FUNCTION can_manage_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u=md5('manager')::uuid AND c=md5('college')::uuid $$;
    CREATE FUNCTION can_view_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u IN(md5('manager')::uuid,md5('viewer')::uuid) AND c=md5('college')::uuid $$;
    CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=clock_timestamp(); RETURN NEW; END $$;
    INSERT INTO auth.users VALUES(${id("manager")}),(${id("viewer")}); INSERT INTO colleges VALUES(${id("college")}),(${id("other")});
    INSERT INTO academic_programs VALUES(${id("program")},${id("college")},'cs','TEST_ONLY');
    INSERT INTO academic_levels VALUES(${id("level")},${id("program")},1);
    INSERT INTO academic_terms VALUES(${id("term")},${id("college")},'T1','TEST_ONLY',true);
    INSERT INTO academic_cohorts SELECT md5(n)::uuid,${id("college")},${id("program")},${id("level")},${id("term")},n,'regular',2026,20,true FROM unnest(ARRAY['a','b']) n;
    GRANT SELECT ON academic_cohorts,academic_terms TO authenticated;`);
  // Use the real foundation's schema, RLS and single-row save/approve functions.
  const foundation = read("supabase/migrations/20260721180000_source_only_scheduling_headcount_foundation.sql");
  sql(foundation.slice(foundation.indexOf("CREATE TABLE"), foundation.indexOf("CREATE OR REPLACE FUNCTION public.upsert_scheduling_headcount_override")));
  sql(read("supabase/sql/scheduling_headcount_import.sql"));
});
function check(name, body, manager = true) {
  test(name, () => sql(`BEGIN; ${manager ? asManager : "SELECT set_config('request.jwt.claim.sub',md5('manager'),true);"} DO $$ DECLARE a jsonb; b jsonb; r jsonb; BEGIN ${body} END $$; ROLLBACK;`));
}
check("batch save, bulk approval and identical retry preserve approval and revision count", `
  r := ${call(`jsonb_build_array(${payload("a")},${payload("b")})`)};
  IF (r->>'changed')::int<>2 OR (SELECT count(*) FROM scheduling_cohort_term_headcounts WHERE approval_status='draft')<>2 THEN RAISE EXCEPTION 'save failed'; END IF;
  r := ${call(`jsonb_build_array(${payload("a")},${payload("b")})`, "approve")};
  IF (r->>'changed')::int<>2 THEN RAISE EXCEPTION 'approve failed'; END IF;
  r := ${call(`jsonb_build_array(${payload("a")},${payload("b")})`)};
  IF (r->>'changed')::int<>0 OR (SELECT count(*) FROM scheduling_cohort_term_headcounts WHERE approval_status='approved')<>2 OR (SELECT count(*) FROM scheduling_headcount_revisions)<>4 THEN RAISE EXCEPTION 'retry mutated approval'; END IF;
`);
check("a failing second row rolls back counts, revisions and audit together", `
  a := ${payload("a")}; b := ${payload("b")};
  BEGIN PERFORM ${call("jsonb_build_array(a,b || jsonb_build_object('registered_student_count',NULL))")}; RAISE EXCEPTION 'unexpected success'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  IF (SELECT count(*) FROM scheduling_cohort_term_headcounts)<>0 OR (SELECT count(*) FROM scheduling_headcount_revisions)<>0 OR (SELECT count(*) FROM audit_logs)<>0 THEN RAISE EXCEPTION 'partial save'; END IF;
`, false);
check("anonymous and read-only users cannot read context, save or approve", `
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN PERFORM ${call("'[]'::jsonb")}; RAISE EXCEPTION 'anonymous accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub',md5('viewer'),true);
  BEGIN PERFORM public.get_scheduling_headcount_import_context(${id("college")}); RAISE EXCEPTION 'viewer accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM ${call("'[]'::jsonb", "approve")}; RAISE EXCEPTION 'viewer approved'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
`);
check("cross-college, duplicate, inactive and over-eligible payloads are rejected", `
  a := ${payload("a")};
  BEGIN PERFORM ${call("jsonb_build_array(a)", "save", "other")}; RAISE EXCEPTION 'foreign accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM ${call("jsonb_build_array(a,a)")}; RAISE EXCEPTION 'duplicate accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM ${call("jsonb_build_array(a || jsonb_build_object('scheduling_headcount',25))")}; RAISE EXCEPTION 'over eligible accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
`);
check("stale preview and edits between save and approval fail without partial changes", `
  a := ${payload("a")}; PERFORM ${call("jsonb_build_array(a)")};
  BEGIN PERFORM ${call("jsonb_build_array(a)")}; RAISE EXCEPTION 'stale absent row accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END;
  a := ${payload("a")}; PERFORM ${call(`jsonb_build_array(${payload("a", 22)})`)};
  BEGIN PERFORM ${call("jsonb_build_array(a)", "approve")}; RAISE EXCEPTION 'stale approval accepted'; EXCEPTION WHEN serialization_failure THEN NULL; END;
  IF (SELECT scheduling_headcount FROM scheduling_cohort_term_headcounts)<>22 OR (SELECT approval_status FROM scheduling_cohort_term_headcounts)<>'draft' THEN RAISE EXCEPTION 'stale request mutated values'; END IF;
`);
check("approval cannot save new values and exact approved retry is a no-op", `
  BEGIN PERFORM ${call(`jsonb_build_array(${payload("a")})`, "approve")}; RAISE EXCEPTION 'new approved'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM ${call(`jsonb_build_array(${payload("a")})`)};
  BEGIN PERFORM ${call(`jsonb_build_array(${payload("a", 21)})`, "approve")}; RAISE EXCEPTION 'changed approved'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM ${call(`jsonb_build_array(${payload("a")})`, "approve")};
  r := ${call(`jsonb_build_array(${payload("a")})`, "approve")}; IF (r->>'changed')::int<>0 THEN RAISE EXCEPTION 'duplicate approval'; END IF;
`);
check("context is scoped and batch RPCs are not exposed to anon", `
  r := public.get_scheduling_headcount_import_context(${id("college")});
  IF jsonb_array_length(r->'cohorts')<>2 OR r->'cohorts'->0->>'program_code'<>'cs' THEN RAISE EXCEPTION 'context mismatch'; END IF;
  IF has_function_privilege('anon','public.import_scheduling_headcounts(uuid,jsonb,text)','EXECUTE') THEN RAISE EXCEPTION 'anon execute'; END IF;
`);

test("overlapping batches serialize and the second stale writer cannot overwrite", async () => {
  const p = sql(`SELECT ${payload("a")}`);
  const quoted = `'${p.replaceAll("'", "''")}'::jsonb`;
  const first = spawn("psql", args, { stdio: ["pipe", "pipe", "pipe"] });
  let error = ""; first.stderr.on("data", (chunk) => { error += chunk; });
  const done = new Promise((resolve) => first.on("close", resolve));
  first.stdin.end(`BEGIN; ${asManager} SELECT ${call(`jsonb_build_array(${quoted})`)}; SELECT pg_sleep(1); COMMIT;`);
  // Observe the first transaction's granted table lock; do not rely on timing alone.
  let locked = false;
  for (let i = 0; i < 100; i++) {
    if (sql("SELECT count(*) FROM pg_locks WHERE relation='public.scheduling_cohort_term_headcounts'::regclass AND mode='ShareRowExclusiveLock' AND granted") === "1") { locked = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(locked, "first writer did not obtain the batch lock");
  const second = spawnSync("psql", args, { input: `BEGIN; ${asManager} SELECT ${call(`jsonb_build_array(${quoted} || jsonb_build_object('registered_student_count',99))`)}; COMMIT;`, encoding: "utf8", timeout: 10000 });
  assert.equal(await done, 0, error); assert.notEqual(second.status, 0);
  assert.match(second.stderr, /بعد المعاينة/);
  assert.equal(sql("SELECT registered_student_count FROM scheduling_cohort_term_headcounts"), "20");
});

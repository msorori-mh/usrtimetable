import test, { before } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const target = process.env.COORDINATION_TEST_DATABASE_URL;
const url = target ? new URL(target) : null;
if (
  process.env.COORDINATION_TEST_DISPOSABLE !== "1" ||
  !url ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/coordination_test"
)
  throw new Error("Disposable localhost coordination_test is required");
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--dbname", target];
function sql(input, error) {
  const r = spawnSync("psql", args, {
    input,
    encoding: "utf8",
    timeout: 30000,
  });
  if (error) {
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, error);
  } else assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout.trim();
}
const id = (s) => `md5('${s}')::uuid`;
const session = (name, college, version, start = "08:00", end = "10:00") =>
  `INSERT INTO schedule_sessions VALUES(${id(name)},${id(college)},${id(version)},${id("teacher")},1,'${start}','${end}',false);`;
before(() => {
  assert.equal(sql("select count(*) from pg_tables where schemaname='public'"), "0");
  sql(`
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION can_manage_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u=c $$;
    CREATE FUNCTION can_view_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u=c OR u=md5('viewer')::uuid $$;
    CREATE TABLE academic_terms(id uuid PRIMARY KEY,college_id uuid,start_date date,end_date date);
    CREATE TABLE schedule_versions(id uuid PRIMARY KEY,college_id uuid,academic_term_id uuid REFERENCES academic_terms,status text);
    CREATE TABLE schedule_sessions(id uuid PRIMARY KEY,college_id uuid,schedule_version_id uuid REFERENCES schedule_versions,
      instructor_id uuid,day_of_week integer,start_time time,end_time time,replaced_by_split boolean);
    CREATE TABLE teaching_assignments(college_id uuid,instructor_id uuid,is_active boolean);
    CREATE TABLE audit_logs(actor_id uuid,action text,entity text,entity_id uuid,college_id uuid,details jsonb);
    CREATE FUNCTION _ss_ci(c text,s text,a uuid,b uuid,m jsonb) RETURNS jsonb LANGUAGE sql AS $$
      SELECT jsonb_build_object('code',c,'severity',s,'schedule_session_id',a,'related_session_id',b,'metadata',m) $$;
    ALTER TABLE schedule_versions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE schedule_sessions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY versions ON schedule_versions FOR ALL TO authenticated USING(can_manage_college(auth.uid(),college_id)) WITH CHECK(can_manage_college(auth.uid(),college_id));
    CREATE POLICY sessions ON schedule_sessions FOR ALL TO authenticated USING(can_manage_college(auth.uid(),college_id)) WITH CHECK(can_manage_college(auth.uid(),college_id));
    GRANT USAGE ON SCHEMA auth TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    INSERT INTO academic_terms VALUES
      (${id("ta")},${id("a")},'2026-09-06','2027-01-14'),
      (${id("tb")},${id("b")},'2026-09-06','2027-01-14'),
      (${id("tc")},${id("c")},'2027-02-01','2027-05-15');
    INSERT INTO schedule_versions VALUES
      (${id("va")},${id("a")},${id("ta")},'draft'),
      (${id("vb")},${id("b")},${id("tb")},'draft'),
      (${id("vc")},${id("c")},${id("tc")},'draft');
    INSERT INTO teaching_assignments SELECT md5(c)::uuid,${id("teacher")},true FROM unnest(ARRAY['a','b','c']) c;
  `);
  sql(
    readFileSync(
      new URL("../supabase/sql/cross_college_coordination.sql", import.meta.url),
      "utf8",
    ),
  );
});
const auth = (college) =>
  `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',${id(college)}::text,true);`;

test("unselected drafts do not reserve a teacher; selection rejects conflicts atomically", () => {
  sql(
    `BEGIN; ${session("a1", "a", "va")} ${session("b1", "b", "vb")}
    ${auth("a")} SELECT set_schedule_coordination_version(${id("a")},${id("va")});
    RESET ROLE; ${auth("b")} SELECT set_schedule_coordination_version(${id("b")},${id("vb")}); COMMIT;`,
    /CROSS_COLLEGE_INSTRUCTOR_CONFLICT/,
  );
  assert.equal(sql("select count(*) from schedule_sessions"), "0");
});
test("published version blocks direct INSERT and UPDATE; adjacent times and different terms allowed", () => {
  sql(
    `BEGIN; UPDATE schedule_versions SET status='published' WHERE id=${id("vb")}; ${session("b1", "b", "vb")}
    ${session("a1", "a", "va")} COMMIT;`,
    /CROSS_COLLEGE_INSTRUCTOR_CONFLICT/,
  );
  sql(`BEGIN; UPDATE schedule_versions SET status='published' WHERE id=${id("vb")}; ${session("b1", "b", "vb")}
    ${session("a1", "a", "va", "10:00", "12:00")} ${session("c1", "c", "vc")}
    SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;`);
  sql(
    `BEGIN; UPDATE schedule_versions SET status='published' WHERE id=${id("vb")}; ${session("b1", "b", "vb")}
    ${session("a1", "a", "va", "10:00", "12:00")}
    UPDATE schedule_sessions SET start_time='09:00' WHERE id=${id("a1")}; COMMIT;`,
    /CROSS_COLLEGE_INSTRUCTOR_CONFLICT/,
  );
});
test("final-state swaps are accepted and split replacements do not occupy teacher time", () => {
  sql(`BEGIN; UPDATE schedule_versions SET is_coordination=true;
    ${session("a1", "a", "va")} ${session("b1", "b", "vb", "10:00", "12:00")}
    UPDATE schedule_sessions SET start_time='10:00',end_time='12:00' WHERE id=${id("a1")};
    UPDATE schedule_sessions SET start_time='08:00',end_time='10:00' WHERE id=${id("b1")};
    SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;`);
  sql(`BEGIN; UPDATE schedule_versions SET is_coordination=true;
    ${session("a1", "a", "va")} ${session("b1", "b", "vb")}
    UPDATE schedule_sessions SET replaced_by_split=true WHERE id=${id("b1")};
    SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;`);
});
test("publishing a conflicting draft and changing term dates cannot bypass protection", () => {
  sql(
    `BEGIN; ${session("a1", "a", "va")} ${session("b1", "b", "vb")}
    UPDATE schedule_versions SET is_coordination=true WHERE id=${id("va")};
    UPDATE schedule_versions SET status='published' WHERE id=${id("vb")}; COMMIT;`,
    /CROSS_COLLEGE_INSTRUCTOR_CONFLICT/,
  );
  sql(
    `BEGIN; UPDATE schedule_versions SET is_coordination=true;
    ${session("a1", "a", "va")} ${session("c1", "c", "vc")}
    UPDATE academic_terms SET start_date='2026-09-06' WHERE id=${id("tc")}; COMMIT;`,
    /CROSS_COLLEGE_INSTRUCTOR_CONFLICT/,
  );
  sql(
    `BEGIN; UPDATE schedule_versions SET is_coordination=true WHERE id=${id("va")};
    UPDATE academic_terms SET start_date=null WHERE id=${id("ta")}; COMMIT;`,
    /COORDINATION_TERM_DATES_REQUIRED/,
  );
});
test("viewer and other-college manager cannot select or query; internal helpers inaccessible", () => {
  for (const user of ["viewer", "b"])
    sql(
      `BEGIN; ${auth(user)}
    SELECT set_schedule_coordination_version(${id("a")},${id("va")});`,
      /FORBIDDEN/,
    );
  sql(
    `BEGIN; ${auth("b")} SELECT * FROM get_schedule_external_busy(${id("a")},${id("va")});`,
    /FORBIDDEN/,
  );
  sql(
    `BEGIN; ${auth("a")} SELECT * FROM schedule_coordination_private.busy(${id("va")});`,
    /permission denied/,
  );
});
test("busy response discloses only assigned instructor and time, with no foreign IDs", () => {
  const out =
    sql(`BEGIN; UPDATE schedule_versions SET status='published' WHERE id=${id("vb")}; ${session("secret", "b", "vb")}
    ${auth("a")} SELECT row_to_json(b) FROM get_schedule_external_busy(${id("a")},${id("va")}) b; ROLLBACK;`);
  const row = JSON.parse(out.split("\n").find((x) => x.startsWith("{")));
  assert.deepEqual(Object.keys(row).sort(), [
    "day_of_week",
    "end_time",
    "instructor_id",
    "start_time",
  ]);
});
test("one coordination version per college and term", () => {
  sql(
    `BEGIN; UPDATE schedule_versions SET is_coordination=true WHERE id=${id("va")};
    INSERT INTO schedule_versions VALUES(${id("va2")},${id("a")},${id("ta")},'draft',true); COMMIT;`,
    /schedule_one_coordination_per_term/,
  );
});

test("concurrent colleges cannot both commit an overlapping shared instructor", async () => {
  sql("UPDATE schedule_versions SET is_coordination=true;");
  const first = spawn("psql", args, { stdio: ["pipe", "pipe", "pipe"] });
  let output = "",
    err = "";
  first.stdout.on("data", (b) => {
    output += b;
  });
  first.stderr.on("data", (b) => {
    err += b;
  });
  const finished = new Promise((resolve) => first.on("close", resolve));
  first.stdin.end(
    `BEGIN; ${session("raceA", "a", "va")} SELECT 'LOCKED'; SELECT pg_sleep(2); COMMIT;`,
  );
  for (let n = 0; n < 100 && !output.includes("LOCKED"); n++)
    await new Promise((r) => setTimeout(r, 20));
  assert.match(output, /LOCKED/);
  // Spawn asynchronously so Node can drain both connections while the DB serializes writes.
  const second = spawn("psql", args, { stdio: ["pipe", "pipe", "pipe"] });
  let secondError = "";
  second.stderr.on("data", (b) => {
    secondError += b;
  });
  second.stdout.resume();
  const secondFinished = new Promise((resolve) => second.on("close", resolve));
  second.stdin.end(`BEGIN; ${session("raceB", "b", "vb")} COMMIT;`);
  assert.equal(await finished, 0, err);
  assert.notEqual(await secondFinished, 0);
  assert.match(secondError, /CROSS_COLLEGE_INSTRUCTOR_CONFLICT/);
  assert.equal(sql("SELECT count(*) FROM schedule_sessions"), "1");
  sql("DELETE FROM schedule_sessions; UPDATE schedule_versions SET is_coordination=false;");
});

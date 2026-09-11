import test, { before } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Deliberately no default URL: this suite must never target a linked Supabase project.
const target = process.env.COMPACTION_TEST_DATABASE_URL;
const url = target ? new URL(target) : null;
if (
  process.env.COMPACTION_TEST_DISPOSABLE !== "1" ||
  !url ||
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  !url.pathname.endsWith("_test")
)
  throw new Error("A disposable localhost *_test PostgreSQL database is required");
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--dbname", target];
function sql(source, extra = []) {
  const r = spawnSync("psql", [...args, ...extra], {
    input: source,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout.trim();
}
before(() => {
  assert.equal(
    sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"),
    "0",
    "database must start empty",
  );
  sql(undefined, [
    "-f",
    fileURLToPath(new URL("./fixtures/atomic-compaction/setup.sql", import.meta.url)),
  ]);
});
const actor = "SELECT set_config('request.jwt.claim.sub',test_support.id('manager')::text,true);";
const one = "test_support.move('one-b','10:00')";
function check(name, body) {
  test(name, () => sql(`BEGIN; ${actor} ${body} ROLLBACK;`));
}
function rejected(moves, code, extra = "") {
  return `DO $$ DECLARE b jsonb := test_support.state(); r jsonb; BEGIN
    r := test_support.apply(${moves} ${extra});
    PERFORM test_support.assert(r->>'code'='${code}' AND (r->>'applied')::integer=0,r::text);
    PERFORM test_support.assert(test_support.state()=b,'rejection changed state'); END $$;`;
}

check(
  "ordered two-move success preserves durations and records one protected receipt",
  `
  SET LOCAL ROLE authenticated;
  SELECT test_support.assert((test_support.apply(jsonb_build_array(
    test_support.move('one-b','14:00'),test_support.move('one-a','12:00')))->>'ok')::boolean,'batch rejected');
  RESET ROLE;
  SELECT test_support.assert((SELECT count(*)=2 AND sum(end_time-start_time)=interval '4 hours'
    FROM schedule_sessions WHERE college_id=test_support.id('one')),'hours changed');
  SELECT test_support.assert((SELECT count(*)=1 FROM schedule_compaction_receipts),'receipt missing');
  SELECT test_support.assert((SELECT count(*)=3 FROM audit_logs),'move/summary audits missing');
`,
);
check(
  "a second-move conflict rolls back the first move, revision, and audits",
  rejected(
    "jsonb_build_array(test_support.move('one-a','10:00'),test_support.move('one-b','10:00'))",
    "BLOCKED_CONFLICTS",
  ),
);
check(
  "repeated moves use the original timestamp for preflight and the locked timestamp per step",
  `
  SELECT test_support.assert((test_support.apply(jsonb_build_array(
    test_support.move('one-b','14:00'),test_support.move('one-b','10:00')))->>'ok')::boolean,'repeat rejected');
  SELECT test_support.assert((SELECT start_time='10:00' FROM schedule_sessions WHERE id=test_support.id('one-b')),'wrong final time');
`,
);
check(
  "identical operation retry is idempotent and altered payload is rejected",
  `
  DO $$ DECLARE p jsonb:=jsonb_build_array(${one}); rev bigint; ts timestamptz; r jsonb; b jsonb;
  BEGIN
    SELECT eligibility_revision,updated_at INTO rev,ts FROM schedule_versions WHERE id=test_support.id('one-version');
    r:=apply_schedule_compaction(test_support.id('one'),test_support.id('one-version'),test_support.id('op'),rev,ts,p);
    PERFORM test_support.assert((r->>'ok')::boolean,r::text); b:=test_support.state();
    PERFORM test_support.assert(apply_schedule_compaction(test_support.id('one'),test_support.id('one-version'),test_support.id('op'),rev,ts,p)=r,'retry result differs');
    PERFORM test_support.assert(test_support.state()=b,'retry executed twice');
    r:=apply_schedule_compaction(test_support.id('one'),test_support.id('one-version'),test_support.id('op'),rev,ts,jsonb_set(p,'{0,day_of_week}','1'));
    PERFORM test_support.assert(r->>'code'='OPERATION_ID_CONFLICT',r::text);
    PERFORM test_support.assert(test_support.state()=b,'conflicting retry mutated');
  END $$;
`,
);
check(
  "summary audit failure rolls back sessions and the already-inserted receipt",
  `
  CREATE FUNCTION test_support.fail_summary() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='atomic_compaction' THEN RAISE EXCEPTION 'TEST_ONLY audit failure'; END IF; RETURN NEW; END $$;
  CREATE TRIGGER test_fail_summary BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION test_support.fail_summary();
  ${rejected(`jsonb_build_array(${one})`, "BATCH_FAILED")}
`,
);
check(
  "missing identity, read-only actor and foreign manager cannot apply",
  `
  DO $$ DECLARE who text; r jsonb; b jsonb:=test_support.state(); BEGIN
    FOREACH who IN ARRAY ARRAY['','reader','foreign-manager'] LOOP
      PERFORM set_config('request.jwt.claim.sub',CASE WHEN who='' THEN '' ELSE test_support.id(who)::text END,true);
      r:=test_support.apply(jsonb_build_array(${one}));
      PERFORM test_support.assert(r->>'code'='FORBIDDEN',r::text);
    END LOOP;
    PERFORM test_support.assert(test_support.state()=b,'unauthorized write');
  END $$;
`,
);
check(
  "foreign-college sessions cannot be smuggled into the batch",
  rejected("jsonb_build_array(test_support.move('two-b','10:00'))", "SESSION_SCOPE_MISMATCH"),
);
check(
  "foreign-college rooms cannot be used",
  rejected(
    `jsonb_build_array(jsonb_set(${one},'{room_id}',to_jsonb(test_support.id('two-room'))))`,
    "ROOM_SCOPE_MISMATCH",
  ),
);
check(
  "a non-draft version rejects compaction",
  `
  UPDATE schedule_versions SET status='review' WHERE id=test_support.id('one-version');
  ${rejected(`jsonb_build_array(${one})`, "VERSION_LOCKED")}
`,
);
check(
  "locked sessions and replaced split parents reject compaction",
  `
  UPDATE schedule_sessions SET is_locked=true WHERE id=test_support.id('one-b');
  ${rejected(`jsonb_build_array(${one})`, "SESSION_LOCKED")}
  UPDATE schedule_sessions SET is_locked=false,replaced_by_split=true WHERE id=test_support.id('one-b');
  ${rejected(`jsonb_build_array(${one})`, "SESSION_LOCKED")}
`,
);
check(
  "stale session timestamp and duration changes reject before mutation",
  `
  ${rejected(`jsonb_build_array(jsonb_set(${one},'{expected_updated_at}','"2000-01-01T00:00:00Z"'))`, "STALE_SESSION")}
  ${rejected(`jsonb_build_array(jsonb_set(${one},'{end_time}','"13:00:00"'))`, "DURATION_OR_TARGET_INVALID")}
`,
);
check(
  "snapshot revision detects changed student partitions",
  `
  DO $$ DECLARE rev bigint; ts timestamptz; p jsonb:=jsonb_build_array(${one}); r jsonb; b jsonb; BEGIN
    SELECT eligibility_revision,updated_at INTO rev,ts FROM schedule_versions WHERE id=test_support.id('one-version');
    INSERT INTO cohort_student_partitions(college_id,cohort_id,partition_code,headcount)
      VALUES(test_support.id('one'),test_support.id('one-cohort'),'TEST_ONLY',30);
    b:=test_support.state();
    r:=apply_schedule_compaction(test_support.id('one'),test_support.id('one-version'),test_support.id('op'),rev,ts,p);
    PERFORM test_support.assert(r->>'code'='STALE_SNAPSHOT',r::text);
    PERFORM test_support.assert(test_support.state()=b,'stale preview wrote');
  END $$;
`,
);
check(
  "all added snapshot input tables invalidate revisions; other colleges stay unchanged",
  `
  DO $$ DECLARE t text; r bigint; foreign_rev bigint; BEGIN
    SELECT eligibility_revision INTO foreign_rev FROM schedule_versions WHERE id=test_support.id('two-version');
    FOREACH t IN ARRAY ARRAY['academic_cohorts','delivery_groups','delivery_group_partition_members',
      'cohort_student_partitions','instructor_types','room_unavailability','scheduling_settings','plan_course_components','daily_breaks','academic_terms'] LOOP
      PERFORM test_support.assert(EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=('public.'||t)::regclass
        AND tgname='trg_compaction_input_revision'),'missing trigger '||t);
    END LOOP;
    SELECT eligibility_revision INTO r FROM schedule_versions WHERE id=test_support.id('one-version');
    UPDATE scheduling_settings SET notes='TEST_ONLY' WHERE college_id=test_support.id('one');
    UPDATE delivery_groups SET expected_students=31 WHERE id=test_support.id('one-group');
    UPDATE academic_cohorts SET expected_students=31 WHERE id=test_support.id('one-cohort');
    PERFORM test_support.assert((SELECT eligibility_revision=r+3 FROM schedule_versions WHERE id=test_support.id('one-version')),'revision increments missing');
    PERFORM test_support.assert((SELECT eligibility_revision=foreign_rev FROM schedule_versions WHERE id=test_support.id('two-version')),'other college invalidated');
  END $$;
`,
);
check(
  "existing assignment-hours guard remains authoritative",
  `
  UPDATE teaching_assignments SET assigned_component_hours=2 WHERE id=test_support.id('one-assignment');
  ${rejected(`jsonb_build_array(${one})`, "OVER_SCHEDULED")}
`,
);
check(
  "existing room capacity and unresolved-warning guards remain authoritative",
  `
  UPDATE rooms SET capacity=1 WHERE id=test_support.id('one-room');
  DO $$ DECLARE r jsonb; b jsonb:=test_support.state(); BEGIN
    r:=test_support.apply(jsonb_build_array(${one}));
    PERFORM test_support.assert(r->>'code' IN ('BLOCKED_CONFLICTS','BLOCKED_WARNINGS'),r::text);
    PERFORM test_support.assert(test_support.state()=b,'capacity rejection changed state');
  END $$;
`,
);
check(
  "a sixth attendance day is rejected on the server without deleting teaching hours",
  `
  UPDATE plan_course_components SET weekly_contact_hours=16 WHERE id=test_support.id('one-component');
  UPDATE teaching_assignments SET assigned_component_hours=16 WHERE id=test_support.id('one-assignment');
  INSERT INTO schedule_sessions(college_id,schedule_version_id,course_offering_id,instructor_id,room_id,
    teaching_assignment_id,cohort_id,plan_course_component_id,delivery_group_id,day_of_week,start_time,end_time,expected_students)
  SELECT college_id,schedule_version_id,course_offering_id,instructor_id,room_id,teaching_assignment_id,cohort_id,
    plan_course_component_id,delivery_group_id,d,'08:00','10:00',expected_students
  FROM schedule_sessions CROSS JOIN generate_series(1,4) d WHERE id=test_support.id('one-a');
  ${rejected("jsonb_build_array(test_support.move('one-a','08:00',6))", "ATTENDANCE_DAY_LIMIT")}
`,
);
check(
  "new receipts have RLS, no direct client access, and no anonymous RPC execution",
  `
  SELECT test_support.assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.schedule_compaction_receipts'::regclass),'RLS missing');
  SELECT test_support.assert(NOT has_table_privilege('authenticated','schedule_compaction_receipts','INSERT,UPDATE,DELETE,SELECT'),'receipt table exposed');
  SELECT test_support.assert(NOT has_function_privilege('anon','public.apply_schedule_compaction(uuid,uuid,uuid,bigint,timestamptz,jsonb)','EXECUTE'),'anonymous execute');
  SELECT test_support.assert(NOT has_function_privilege('service_role','public.apply_schedule_compaction(uuid,uuid,uuid,bigint,timestamptz,jsonb)','EXECUTE'),'service role unexpectedly granted');
  SET LOCAL ROLE authenticated;
  DO $$ BEGIN
    BEGIN INSERT INTO schedule_compaction_receipts(operation_id) VALUES(gen_random_uuid());
      RAISE EXCEPTION 'forged receipt accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END $$;
`,
);
check(
  "receipt lookup requires the same actor and college; missing receipt is unconfirmed",
  `
  SELECT test_support.apply(jsonb_build_array(${one}));
  SELECT test_support.assert((get_schedule_compaction_result(test_support.id('one'),test_support.id('one-version'),test_support.id('op'))->>'ok')::boolean,'receipt lookup failed');
  SELECT test_support.assert(get_schedule_compaction_result(test_support.id('one'),test_support.id('one-version'),test_support.id('absent'))->>'code'='UNCONFIRMED','absence is not rollback');
  SELECT set_config('request.jwt.claim.sub',test_support.id('foreign-manager')::text,true);
  SELECT test_support.assert(get_schedule_compaction_result(test_support.id('one'),test_support.id('one-version'),test_support.id('op'))->>'code'='FORBIDDEN','foreign receipt disclosed');
`,
);
check(
  "empty and malformed batches fail without exposing SQL details",
  `
  ${rejected("'[]'::jsonb", "INVALID_BATCH_SIZE")}
  ${rejected(`jsonb_build_array(jsonb_set(${one},'{room_id}','"bad-uuid"'))`, "INVALID_REQUEST")}
`,
);

check(
  "weekly room closure rejects the entire batch",
  `
  INSERT INTO room_unavailability(college_id,room_id,day_of_week,start_time,end_time)
    VALUES(test_support.id('one'),test_support.id('one-room'),0,'10:00','11:00');
  ${rejected(`jsonb_build_array(${one})`, "ROOM_CLOSED")}
`,
);
check(
  "date-bounded room closure inside the term rejects the matching weekday",
  `
  UPDATE academic_terms SET start_date='2026-09-01',end_date='2026-12-31' WHERE id=test_support.id('one-term');
  INSERT INTO room_unavailability(college_id,room_id,start_date,end_date,start_time,end_time)
    VALUES(test_support.id('one'),test_support.id('one-room'),'2026-09-06','2026-09-06','10:00','11:00');
  ${rejected(`jsonb_build_array(${one})`, "ROOM_CLOSED")}
`,
);
check(
  "closures on a different weekday or outside the term do not reject valid moves",
  `
  UPDATE academic_terms SET start_date='2026-09-01',end_date='2026-12-31' WHERE id=test_support.id('one-term');
  INSERT INTO room_unavailability(college_id,room_id,start_date,end_date,start_time,end_time) VALUES
    (test_support.id('one'),test_support.id('one-room'),'2026-09-07','2026-09-07','10:00','11:00'),
    (test_support.id('one'),test_support.id('one-room'),'2026-08-02','2026-08-02','10:00','11:00');
  SELECT test_support.assert((test_support.apply(jsonb_build_array(${one}))->>'ok')::boolean,'unrelated closure blocked');
`,
);
check(
  "date-specific closures fail closed if term dates are unavailable",
  `
  INSERT INTO room_unavailability(college_id,room_id,start_date,end_date)
    VALUES(test_support.id('one'),test_support.id('one-room'),'2026-09-06','2026-09-06');
  ${rejected(`jsonb_build_array(${one})`, "ROOM_CLOSURE_REQUIRES_TERM_DATES")}
`,
);
check(
  "term date edits invalidate a prepared snapshot",
  `
  DO $$ DECLARE rev bigint; ts timestamptz; p jsonb:=jsonb_build_array(${one}); r jsonb; BEGIN
    SELECT eligibility_revision,updated_at INTO rev,ts FROM schedule_versions WHERE id=test_support.id('one-version');
    UPDATE academic_terms SET start_date='2026-09-01',end_date='2026-12-31' WHERE id=test_support.id('one-term');
    r:=apply_schedule_compaction(test_support.id('one'),test_support.id('one-version'),test_support.id('op'),rev,ts,p);
    PERFORM test_support.assert(r->>'code'='STALE_SNAPSHOT',r::text);
  END $$;
`,
);

async function hold(lockSql) {
  const child = spawn("psql", args, { stdio: ["pipe", "pipe", "pipe"] });
  let out = "",
    err = "";
  child.stderr.on("data", (d) => {
    err += d;
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`lock setup timed out: ${err}`)), 5000);
    child.stdout.on("data", (d) => {
      out += d;
      if (out.includes("LOCK_HELD")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => {
      if (code) {
        clearTimeout(timer);
        reject(new Error(err));
      }
    });
  });
  child.stdin.write(`BEGIN; ${lockSql};\n\\echo LOCK_HELD\n`);
  try {
    await ready;
  } catch (e) {
    child.kill();
    throw e;
  }
  return () =>
    new Promise((resolve, reject) => {
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(err))));
      child.stdin.end("ROLLBACK;\n");
    });
}
for (const [name, statement] of [
  [
    "version advisory lock",
    "SELECT pg_advisory_xact_lock(hashtextextended(test_support.id('one-version')::text,9174))",
  ],
  [
    "session lock held by an existing single-move writer",
    "SELECT id FROM schedule_sessions WHERE id=test_support.id('one-b') FOR UPDATE",
  ],
  [
    "assignment lock held by an existing writer",
    "SELECT id FROM teaching_assignments WHERE id=test_support.id('one-assignment') FOR UPDATE",
  ],
  [
    "input edit before its revision commits",
    "UPDATE scheduling_settings SET notes='TEST_ONLY concurrent' WHERE college_id=test_support.id('one')",
  ],
]) {
  test(`concurrency: ${name} rejects promptly and leaves no partial writes`, async () => {
    const release = await hold(statement);
    try {
      sql(
        `BEGIN; SET LOCAL statement_timeout='3s'; ${actor} ${rejected(`jsonb_build_array(${one})`, "VERSION_BUSY")} ROLLBACK;`,
      );
    } finally {
      await release();
    }
  });
}

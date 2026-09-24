import test, { before } from "node:test";
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
function sql(input) {
  const r = spawnSync(
    "psql",
    ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--dbname", target],
    { input, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout.trim();
}
before(() => {
  const sources = [
    "partition_extended_day",
    "partition_extended_statement",
    "atomic_schedule_relayout",
  ]
    .map((n) => readFileSync(new URL(`../supabase/sql/${n}.sql`, import.meta.url), "utf8"))
    .join("\n");
  sql(`BEGIN;${sources}
 CREATE FUNCTION test_support.relayout(moves jsonb,op text DEFAULT 'joint-op',cap integer DEFAULT 3) RETURNS jsonb LANGUAGE sql VOLATILE AS $$
 SELECT public.apply_schedule_relayout(test_support.id('one'),test_support.id('one-version'),test_support.id(op),eligibility_revision,updated_at,moves,cap) FROM schedule_versions WHERE id=test_support.id('one-version') $$;
 COMMIT;`);
});
const actor = "SELECT set_config('request.jwt.claim.sub',test_support.id('manager')::text,true);";
const swap =
  "jsonb_build_array(test_support.move('one-a','12:00'),test_support.move('one-b','08:00'))";
function check(name, body) {
  test(name, () => sql(`BEGIN;${actor}${body}ROLLBACK;`));
}
function rejected(moves, code, extra = "") {
  return `DO $$ DECLARE b jsonb:=test_support.state();r jsonb;BEGIN r:=test_support.relayout(${moves}${extra});PERFORM test_support.assert(r->>'code'='${code}' AND (r->>'applied')::int=0,r::text);PERFORM test_support.assert(test_support.state()=b,'rollback changed state');END $$;`;
}
check(
  "simultaneous two-way swap succeeds and records protected receipt",
  `SET LOCAL ROLE authenticated; SELECT test_support.assert((test_support.relayout(${swap})->>'ok')::boolean,'swap rejected');RESET ROLE;SELECT test_support.assert((SELECT count(*)=1 FROM schedule_compaction_receipts),'receipt missing');SELECT test_support.assert((SELECT sum(end_time-start_time)=interval '4 hours' FROM schedule_sessions WHERE college_id=test_support.id('one')),'hours changed');`,
);
check(
  "final overlap rolls back all rows, revisions and audits",
  rejected(
    "jsonb_build_array(test_support.move('one-a','10:00'),test_support.move('one-b','10:00'))",
    "FINAL_STATE_CONFLICT",
  ),
);
check(
  "duplicate session cannot create nondeterministic update",
  rejected(
    "jsonb_build_array(test_support.move('one-a','10:00'),test_support.move('one-a','12:00'))",
    "DUPLICATE_SESSION",
  ),
);
check(
  "reader cannot apply simultaneous plan",
  `SELECT set_config('request.jwt.claim.sub',test_support.id('reader')::text,true);${rejected(swap, "FORBIDDEN")}`,
);
check(
  "locked session preserves entire batch",
  `UPDATE schedule_sessions SET is_locked=true WHERE id=test_support.id('one-a');${rejected(swap, "SESSION_LOCKED")}`,
);
check(
  "final extended-day swap is allowed while a second extended day is rejected",
  `
 UPDATE schedule_sessions SET day_of_week=CASE WHEN id=test_support.id('one-a') THEN 0 ELSE 1 END,start_time='14:00',end_time='16:00' WHERE college_id=test_support.id('one');
 UPDATE schedule_sessions SET start_time='08:00',end_time='10:00' WHERE id=test_support.id('one-b');
 UPDATE scheduling_settings SET extended_day_policy_enabled=true WHERE college_id=test_support.id('one');
 SELECT test_support.assert((test_support.relayout(jsonb_build_array(test_support.move('one-a','08:00',0),test_support.move('one-b','14:00',1)))->>'ok')::boolean,'extended swap rejected');
 DO $$ BEGIN
  BEGIN UPDATE schedule_sessions SET start_time='14:00',end_time='16:00' WHERE id=test_support.id('one-a');RAISE EXCEPTION 'second day accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 END $$;
`,
);
check(
  "bulk update cannot introduce two extended days from zero",
  `
 UPDATE scheduling_settings SET extended_day_policy_enabled=true WHERE college_id=test_support.id('one');
 DO $$ DECLARE b jsonb:=test_support.state();BEGIN
 BEGIN UPDATE schedule_sessions SET day_of_week=CASE WHEN id=test_support.id('one-a') THEN 0 ELSE 1 END,start_time='14:00',end_time='16:00' WHERE college_id=test_support.id('one');RAISE EXCEPTION 'bulk violation accepted';EXCEPTION WHEN check_violation THEN NULL;END;
 PERFORM test_support.assert(test_support.state()=b,'failed statement leaked');END $$;
`,
);
check(
  "successful retry reuses receipt without reapplying",
  `DO $$ DECLARE moves jsonb:=${swap}; rev bigint;ts timestamptz;r jsonb;b jsonb;BEGIN SELECT eligibility_revision,updated_at INTO rev,ts FROM schedule_versions WHERE id=test_support.id('one-version');r:=test_support.relayout(moves);PERFORM test_support.assert((r->>'ok')::boolean,r::text);b:=test_support.state();r:=public.apply_schedule_relayout(test_support.id('one'),test_support.id('one-version'),test_support.id('joint-op'),rev,ts,moves,3);PERFORM test_support.assert((r->>'ok')::boolean AND test_support.state()=b,'retry reapplied');END $$;`,
);

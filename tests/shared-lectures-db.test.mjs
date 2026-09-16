import test, { before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cases } from "./shared-lecture-cases.mjs";
const target = process.env.SHARED_LECTURES_TEST_DATABASE_URL;
const url = target ? new URL(target) : null;
if (
  process.env.SHARED_LECTURES_TEST_DISPOSABLE !== "1" ||
  !url ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/shared_lectures_test"
) {
  throw new Error("A disposable localhost shared_lectures_test database is required");
}
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
  assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"), "0");
  for (const path of [
    "tests/fixtures/shared-lecture-runtime.sql",
    "supabase/sql/shared_lectures.sql",
    "supabase/sql/shared_lecture_runtime.sql",
    "supabase/sql/materialize_operational_group_reads.sql",
    "tests/fixtures/shared-lecture-seed.sql",
  ]) {
    sql(readFileSync(new URL("../" + path, import.meta.url), "utf8"));
  }
});
for (const [name, body] of cases) {
  test(name, () =>
    sql(
      "BEGIN; SELECT set_config('request.jwt.claim.sub',md5('manager'),true);" + body + "ROLLBACK;",
    ),
  );
}

test("operational snapshot calculates each source group once, preserving all fields", () => {
  sql(`BEGIN; SET LOCAL track_functions='pl';
    SELECT set_config('request.jwt.claim.sub',md5('manager'),true);
    DO $$ DECLARE before_calls bigint; after_calls bigint; expected bigint; BEGIN
      SELECT coalesce(sum(calls),0) INTO before_calls FROM pg_stat_xact_user_functions WHERE funcname='operational_delivery_group';
      PERFORM jsonb_agg(v) FROM operational_delivery_groups v;
      SELECT coalesce(sum(calls),0) INTO after_calls FROM pg_stat_xact_user_functions WHERE funcname='operational_delivery_group';
      SELECT count(*) INTO expected FROM delivery_groups;
      IF after_calls-before_calls<>expected THEN RAISE EXCEPTION 'Repeated operational group evaluation: % vs %',after_calls-before_calls,expected; END IF;
      IF EXISTS((SELECT * FROM operational_delivery_groups EXCEPT ALL SELECT (operational_delivery_group(g.id)).* FROM delivery_groups g)
        UNION ALL (SELECT (operational_delivery_group(g.id)).* FROM delivery_groups g EXCEPT ALL SELECT * FROM operational_delivery_groups))
        THEN RAISE EXCEPTION 'Operational fields changed'; END IF;
    END $$; ROLLBACK;`);
});

test("operational view keeps invoker permissions on its base table", () => {
  sql(`BEGIN; REVOKE SELECT ON delivery_groups FROM authenticated;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub',md5('viewer'),true);
    DO $$ BEGIN
      BEGIN PERFORM * FROM operational_delivery_groups; RAISE EXCEPTION 'View bypassed base permissions';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$; ROLLBACK;`);
});

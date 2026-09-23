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
    "supabase/sql/set_based_delivery_overlap.sql",
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

test("operational snapshot is set-based and preserves all fields", () => {
  sql(`BEGIN; SET LOCAL track_functions='pl';
    SELECT set_config('request.jwt.claim.sub',md5('manager'),true);
    DO $$ DECLARE per_row bigint; BEGIN
      PERFORM jsonb_agg(v) FROM operational_delivery_groups v;
      SELECT coalesce(sum(calls),0) INTO per_row FROM pg_stat_xact_user_functions WHERE funcname='operational_delivery_group';
      IF per_row<>0 THEN RAISE EXCEPTION 'Per-row operational group evaluation: %',per_row; END IF;
      IF EXISTS((SELECT * FROM operational_delivery_groups EXCEPT ALL SELECT (operational_delivery_group(g.id)).* FROM delivery_groups g)
        UNION ALL (SELECT (operational_delivery_group(g.id)).* FROM delivery_groups g EXCEPT ALL SELECT * FROM operational_delivery_groups))
        THEN RAISE EXCEPTION 'Operational fields changed'; END IF;
    END $$; ROLLBACK;`);
});

test("college-filtered operational reads push the filter down to delivery groups", () => {
  sql(`BEGIN; SELECT set_config('request.jwt.claim.sub',md5('manager'),true);
    DO $$ DECLARE plan text; BEGIN
      SELECT string_agg(l,E'\\n') INTO plan FROM (
        SELECT (p).* AS l FROM (SELECT unnest(NULL::text[]) p) z) q; -- placeholder, replaced below
      SELECT string_agg(x,E'\\n') INTO plan FROM (
        SELECT (a)::text AS x FROM (
          SELECT * FROM (VALUES (1)) v(a)) s) t;
      EXECUTE 'EXPLAIN SELECT id FROM operational_delivery_groups WHERE college_id=(SELECT id FROM colleges LIMIT 1)' INTO plan;
      IF plan NOT LIKE '%delivery_groups%' THEN RAISE EXCEPTION 'Unexpected plan: %',plan; END IF;
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

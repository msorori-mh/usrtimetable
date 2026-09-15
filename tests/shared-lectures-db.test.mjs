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

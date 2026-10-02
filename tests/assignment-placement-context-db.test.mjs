import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

test("version placement inherits shared days, preserves missing groups, isolates versions and colleges, and is read-only", async () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const sql = read("./fixtures/assignment-placement-context.sql").replace(
    "-- INSTALL_MIGRATION",
    read("../supabase/migrations/20261002040000_assignment_placement_context.sql"),
  );
  if (process.env.PGLITE_TEST_MODULE) {
    // Local disposable PostgreSQL engine; never points at the managed database.
    const { PGlite } = await import(pathToFileURL(process.env.PGLITE_TEST_MODULE).href);
    const db = new PGlite();
    try {
      await db.exec(sql);
    } finally {
      await db.close();
    }
    return;
  }
  const target = process.env.ASSIGNMENT_PLACEMENT_TEST_DATABASE_URL;
  const url = target ? new URL(target) : null;
  if (
    process.env.ASSIGNMENT_PLACEMENT_TEST_DISPOSABLE !== "1" ||
    !url ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !url.pathname.endsWith("_test")
  )
    throw new Error("Disposable localhost database required");
  const result = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "--dbname", target], {
    input: sql,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
});

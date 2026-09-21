import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync("scripts/local-db/backup-restore-drill.sh", "utf8");
const runbook = readFileSync("docs/operations/supabase-backup-restore.md", "utf8");

test("restore drill fails closed before any destructive restore", () => {
  const restoreAt = script.indexOf("\npg_restore \\\n");

  assert.ok(restoreAt > 0);
  for (const guard of [
    "RESTORE_DRILL_ACK",
    "SOURCE_DATABASE_URL",
    "RESTORE_DATABASE_URL",
    "source and restore targets must differ",
    "production project cannot be a restore target",
    "target database name must start with restore_drill_",
  ]) {
    const guardAt = script.indexOf(guard);
    assert.ok(guardAt >= 0 && guardAt < restoreAt, `${guard} must precede pg_restore`);
  }
});

test("restore drill limits the dump to the public schema and verifies the result", () => {
  assert.match(script, /--schema=public/);
  assert.match(script, /--exit-on-error/);
  assert.match(script, /public table count mismatch/);
  assert.match(script, /RESTORE_DRILL_PASS/);
});

test("runbook separates platform recovery from the logical drill", () => {
  assert.match(runbook, /PITR/);
  assert.match(runbook, /لا تُنفذ الاستعادة فوق قاعدة الإنتاج/);
  assert.match(runbook, /DISPOSABLE_ONLY/);
  assert.match(runbook, /HOLD/);
});

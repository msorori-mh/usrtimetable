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

test("restore drill dumps the application schemas and verifies every table's row count", () => {
  // Supabase platform schemas are excluded, public and the *_private schemas are included,
  // extensions are recreated first (schema-filtered dumps omit CREATE EXTENSION).
  assert.match(script, /platform_schemas=/);
  assert.match(script, /'storage'/);
  assert.match(script, /--schema=\$schema/);
  assert.match(script, /create extension if not exists/);
  assert.match(script, /INCLUDE_AUTH/);
  assert.match(script, /--exit-on-error/);
  const restoreCall = script.slice(script.indexOf("\npg_restore \\\n"));
  assert.doesNotMatch(restoreCall.slice(0, restoreCall.indexOf('"$work_dir/app.dump"')), /--clean/);
  assert.match(script, /restore target is not empty/);
  assert.match(script, /per-table row count mismatch/);
  assert.match(script, /RESTORE_DRILL_PASS/);
});

test("restore drill reads the production ref from config and writes secret-free evidence", () => {
  assert.doesNotMatch(script, /emzytxqkxjjhsivqxdiu/);
  assert.match(script, /supabase\/config\.toml/);
  assert.match(script, /docs\/operations\/drills/);
  const evidence = script.slice(script.indexOf('> "$evidence_file"') - 600);
  assert.doesNotMatch(evidence, /DATABASE_URL"?\s*\)?\s*$/m);
  assert.doesNotMatch(script, /printf[^\n]*\$(?:SOURCE|RESTORE)_DATABASE_URL/);
});

test("runbook separates platform recovery from the logical drill", () => {
  assert.match(runbook, /PITR/);
  assert.match(runbook, /لا تُنفذ الاستعادة فوق قاعدة الإنتاج/);
  assert.match(runbook, /DISPOSABLE_ONLY/);
  assert.match(runbook, /HOLD/);
  assert.match(runbook, /RPO/);
  assert.match(runbook, /RTO/);
  assert.match(runbook, /INCLUDE_AUTH=1/);
});

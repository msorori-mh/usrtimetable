import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20260926083000_quota_confirmation_noop_affiliation.sql",
  import.meta.url,
);

test("quota-only reconciliation does not rewrite an unchanged home affiliation", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /i\.affiliation_college_id IS DISTINCT FROM p_home_college_id/,
    "the instructor row is updated only when the home college actually changes",
  );
  assert.match(
    sql,
    /i\.affiliation_department_id IS NOT NULL[\s\S]*NOT EXISTS\([\s\S]*d\.college_id=p_home_college_id/,
    "an invalid department is still cleared even when the college is unchanged",
  );
  assert.match(
    sql,
    /ON CONFLICT\(identity_id\) DO UPDATE[\s\S]*quota_confirmed=excluded\.quota_confirmed/,
    "quota confirmation still persists through the authoritative decision",
  );
  assert.match(sql, /'faculty_home_reconciled'/, "the audit trail remains mandatory");
  assert.match(
    sql,
    /v_old\.updated_at IS DISTINCT FROM p_expected_decision_at/,
    "stale reconciliation writes remain fail-closed",
  );
});

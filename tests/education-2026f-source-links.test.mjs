import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260926120000_education_2026f_verified_source_links.sql",
    import.meta.url,
  ),
  "utf8",
).replace(/^--.*$/gm, "");

test("the Education reconciliation is limited to the one first-term draft", () => {
  assert.match(migration, /7430bad7-2de7-5c90-9368-b214a199d6c3/);
  assert.match(migration, /v_version\.status <> 'draft'/);
  assert.match(migration, /v_term\.academic_year <> '2026-2027'/);
  assert.match(migration, /v_term\.term_type <> 'first'/);
  assert.match(migration, /v_source\.schedule_session_id IS NOT NULL/);
  assert.match(migration, /IF v_matches <> 1 THEN/);
  assert.match(
    migration,
    /NOT EXISTS \(\s*SELECT 1 FROM public\.existing_schedule_source_rows other/,
  );
  assert.deepEqual(
    [...migration.matchAll(/'EDU-2026F-CHEM-R\d\d-L\d'/g)].map((match) => match[0]),
    ["'EDU-2026F-CHEM-R03-L1'", "'EDU-2026F-CHEM-R11-L3'"],
  );
});

test("the reconciliation changes links only, leaving curricula and sessions intact", () => {
  const writes = [
    ...migration.matchAll(/\b(?:INSERT INTO|DELETE FROM|UPDATE)\s+public\.([a-z_]+)/gi),
  ].map((match) => [match[0].split(/\s+/)[0].toUpperCase(), match[1]]);
  assert.deepEqual(writes, [["UPDATE", "existing_schedule_source_rows"]]);
  assert.match(migration, /SET study_plan_id = v_match\.study_plan_id/);
  assert.match(migration, /component_id = v_match\.component_id/);
  assert.match(migration, /schedule_session_id = v_match\.session_id/);
});

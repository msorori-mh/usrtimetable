// H-12: no executable script may target the production Supabase project.
// The production ref lives in supabase/config.toml only; scripts must read it from there
// (to refuse it) and must never push migrations or write migration history remotely.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const productionRef = readFileSync(path.join(root, "supabase/config.toml"), "utf8").match(
  /^project_id\s*=\s*"([^"]+)"/m,
)[1];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const scripts = [...walk(path.join(root, "scripts")), ...walk(path.join(root, ".github"))].filter(
  (file) => /\.(?:m?[jt]sx?|cjs|sh|py|ya?ml|sql)$/.test(file),
);

test("the production ref is configured", () => {
  assert.match(productionRef, /^[a-z]{20}$/);
  assert.ok(scripts.length > 10);
});

test("no script or workflow hard-codes the production project ref", () => {
  // A line marked `deny-guard` names the ref only to refuse it (e.g. the legacy Lovable
  // project after the move); every other occurrence is a hard-coded target.
  const offenders = scripts.filter((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .some((line) => line.includes(productionRef) && !line.includes("deny-guard")),
  );
  assert.deepEqual(
    offenders.map((file) => path.relative(root, file)),
    [],
    "read the ref from supabase/config.toml (see productionProjectRef) and refuse it instead",
  );
});

test("no script pushes migrations or writes migration history on a linked project", () => {
  for (const file of scripts) {
    const src = readFileSync(file, "utf8");
    const rel = path.relative(root, file);
    assert.doesNotMatch(src, /supabase\s+db\s+push/, `${rel}: supabase db push`);
    assert.doesNotMatch(src, /--include-all/, `${rel}: --include-all`);
    assert.doesNotMatch(
      src,
      /insert\s+into\s+supabase_migrations\.schema_migrations/i,
      `${rel}: manual schema_migrations insert`,
    );
    assert.doesNotMatch(src, /gen\s+types[^\n]*--project-id/, `${rel}: gen types from a project`);
  }
});

test("the historical production-targeting staging script is no longer executable", () => {
  const files = walk(path.join(root, "scripts")).map((f) => path.relative(root, f));
  assert.ok(!files.includes("scripts/staging/exception-aware-staging-apply-exec.mjs"));
});

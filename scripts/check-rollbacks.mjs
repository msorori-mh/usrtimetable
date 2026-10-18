#!/usr/bin/env node
// M-24: every migration newer than the cut-off must ship a rollback at
// supabase/rollbacks/<same basename>.down.sql. Older migrations predate the rule
// (a few have legacy rollbacks named <basename>.sql in the same folder).
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROLLBACK_RULE_CUTOFF = "20261020000000";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function missingRollbacks(repoRoot = root, cutoff = ROLLBACK_RULE_CUTOFF) {
  return readdirSync(path.join(repoRoot, "supabase/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => (file.match(/^(\d{14})_/)?.[1] ?? "0") > cutoff)
    .filter(
      (file) =>
        !existsSync(path.join(repoRoot, "supabase/rollbacks", file.replace(/\.sql$/, ".down.sql"))),
    )
    .sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const missing = missingRollbacks();
  if (missing.length) {
    console.error("Migrations without supabase/rollbacks/<basename>.down.sql:");
    for (const file of missing) console.error(`  - ${file}`);
    process.exit(1);
  }
  console.log(`rollback check: OK (every migration after ${ROLLBACK_RULE_CUTOFF} has a .down.sql)`);
}

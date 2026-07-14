#!/usr/bin/env node
/**
 * Run exception-aware verification harnesses via tsx.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsconfig = path.join(__dirname, "tsconfig.json");
const root = path.join(__dirname, "../..");

const harnesses = [
  "exception-aware-impl-01a.harness.ts",
  "f001-session-version-integrity.harness.ts",
  "f002-validate-schedule-version.harness.ts",
  "room-import-normalize.harness.ts",
  "weekly-time-templates.harness.ts",
  "terminology-labels.harness.ts",
  "time-templates-college-context-sync.harness.ts",
  "unauthorized-access-ux.harness.ts",
  "schedule-builder-foundation.harness.ts",
  "schedule-builder-workspace-read-model.harness.ts",
  "schedule-builder-edit-local-state-ui.harness.ts",
  "schedule-builder-conflict-save-integration.harness.ts",
  "schedule-builder-drag-drop.harness.ts",
];

let exitCode = 0;
for (const file of harnesses) {
  console.log(`\n=== Running ${file} ===`);
  const r = spawnSync("npx", ["tsx", "--tsconfig", tsconfig, path.join(__dirname, file)], {
    stdio: "inherit",
    shell: true,
    cwd: root,
  });
  if ((r.status ?? 1) !== 0) exitCode = 1;
}

process.exit(exitCode);

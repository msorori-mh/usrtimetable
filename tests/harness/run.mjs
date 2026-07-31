#!/usr/bin/env node
/** Run the repository verification harnesses with the installed tsx runtime. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "../..");
const tsconfig = path.join(__dirname, "tsconfig.json");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
export const HARNESS_TIMEOUT_MS = 120_000;

export const harnesses = [
  "exception-aware-impl-01a.harness.ts",
  "f001-session-version-integrity.harness.ts",
  "f002-validate-schedule-version.harness.ts",
  "room-import-normalize.harness.ts",
  "import-pipeline-safety.harness.ts",
  "import-pipeline-atomic-commit.harness.ts",
  "import-pipeline-preapply-security.harness.ts",
  "import-templates-final-audit.harness.ts",
  "legacy-write-blocking.harness.ts",
  "availability-all-active-days.harness.ts",
  "weekly-time-templates.harness.ts",
  "terminology-labels.harness.ts",
  "time-templates-college-context-sync.harness.ts",
  "unauthorized-access-ux.harness.ts",
  "schedule-builder-foundation.harness.ts",
  "schedule-builder-workspace-read-model.harness.ts",
  "schedule-builder-edit-local-state-ui.harness.ts",
  "schedule-builder-conflict-save-integration.harness.ts",
  "schedule-builder-drag-drop.harness.ts",
  "section-subgroups-capacity.harness.ts",
  "conflict-rpc-compact-equivalence.harness.ts",
  "conflict-exception-reporting.harness.ts",
  "enrollment-ownership-split-proposal-ui.harness.ts",
  "explicit-split-approval-contract-ui.harness.ts",
  "experimental-schedule-reset-room-integrity.harness.ts",
  "schedule-builder-phase6-uat-fixture.harness.ts",
  "term-reference-remediation.harness.ts",
  "course-offering-dependency-fk.harness.ts",
  "academic-delivery-v2-import-generator.harness.ts",
  "academic-cohort-legacy-section-adapter.harness.ts",
  "delivery-groups-workload-engine.harness.ts",
  "teaching-assignments-v2-runtime.harness.ts",
  "cross-college-reference-integrity.harness.ts",
  "phase-9-5-assignment-integration.harness.ts",
  "schedule-version-lifecycle-atomic.harness.ts",
  "disposable-draft-purge.harness.ts",
  "scheduling-headcount-foundation.harness.ts",
  "draft-lecturer-report.harness.ts",
  "admin-routes-inventory.harness.ts",
  "phase-a1-legacy-navigation-terminology.harness.ts",
  "domain-contract-static.harness.ts",
  "program-department-integrity.harness.ts",
  "reports-read-model-a1-5.harness.ts",
  "timetable-session-course-visibility.harness.ts",
  "timetable-editor-filters-sidebar.harness.ts",
  "plan-component-room-type-permanent-fix.harness.ts",
  "postgrest-relationship-disambiguation.harness.ts",
  "postgrest-relationship-disambiguation-runtime.harness.ts",
  "scheduling-initial-delivery-runtime-closure.harness.ts",
  "teaching-assignments-source-workbook-import.harness.ts",
  "xlsx-remediation-regression.harness.ts",
  "teaching-assignments-v2-duplicate-contract.harness.ts",
  "teaching-assignments-v2-hours-preflight.harness.ts",
  "stage-03i-j-targeted-hours-remediation.harness.ts",
  "teaching-assignments-v2-duplicate-sql-contract.harness.ts",
  "stage-03a-fail-closed-contract.harness.ts",
  "platform-product-closure.harness.ts",
  "print-center.harness.ts",
  "data-onboarding-readiness-wizard.harness.ts",
  "schedule-quality-analytics.harness.ts",
  "advanced-academic-reports.harness.ts",
];

const historicalArtifacts = new Map([
  [
    "experimental-schedule-reset-room-integrity.harness.ts",
    {
      path: "implementation-reports/phase-6-reset-hardening-self-verifying-migrations-01/post-apply-verification.sql",
      failureMarker: "post-apply verification SQL present (local report)",
    },
  ],
  [
    "teaching-assignments-v2-runtime.harness.ts",
    {
      path: "supabase/migrations/20260717043000_teaching_assignments_v2_runtime_foundation.sql",
      failureMarker: "Phase 9.4 migration present",
    },
  ],
]);

export function classifyResult(file, result, fileExists = existsSync) {
  if (result.status === 0) return "pass";

  const artifact = historicalArtifacts.get(file);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (
    artifact &&
    !fileExists(path.join(root, artifact.path)) &&
    output.includes(artifact.failureMarker)
  ) {
    return "missing-historical-artifact";
  }
  return "fail";
}

export function runHarnesses({
  spawn = spawnSync,
  fileExists = existsSync,
  out = process.stdout,
} = {}) {
  if (!fileExists(tsxCli)) {
    out.write(`HARNESS_RUNNER_ERROR: local tsx runtime is missing at ${tsxCli}\n`);
    out.write("Install the locked dependencies before running the harness suite.\n");
    return 2;
  }

  const totals = { pass: 0, fail: 0, "missing-historical-artifact": 0 };
  for (const file of harnesses) {
    out.write(`\n=== Running ${file} ===\n`);
    const result = spawn(
      process.execPath,
      [tsxCli, "--tsconfig", tsconfig, path.join(__dirname, file)],
      {
        cwd: root,
        encoding: "utf8",
        shell: false,
        timeout: HARNESS_TIMEOUT_MS,
        killSignal: "SIGTERM",
      },
    );
    if (result.stdout) out.write(result.stdout);
    if (result.stderr) out.write(result.stderr);
    if (result.error?.code === "ETIMEDOUT") {
      out.write(`HARNESS_TIMEOUT: ${file} exceeded ${HARNESS_TIMEOUT_MS}ms\n`);
    } else if (result.error) {
      out.write(`HARNESS_SPAWN_ERROR: ${file}: ${result.error.message}\n`);
    } else if (result.signal) {
      out.write(`HARNESS_SIGNAL: ${file}: ${result.signal}\n`);
    }

    const classification = classifyResult(file, result, fileExists);
    totals[classification] += 1;
    out.write(`HARNESS_RESULT: ${classification.toUpperCase()} ${file}\n`);
  }

  out.write(
    `\nHARNESS_SUMMARY: ${totals.pass} passed, ${totals.fail} failed, ` +
      `${totals["missing-historical-artifact"]} missing historical artifacts\n`,
  );
  // Missing historical artifacts are tracked but do not fail the suite (SOURCE-only migrations).
  return totals.fail === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runHarnesses();
}

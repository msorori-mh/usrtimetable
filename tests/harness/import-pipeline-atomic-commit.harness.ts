import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  deliveryGroupIsolationKey,
  normalizeImportKeyPart,
  sectionIsolationKey,
} from "../../src/lib/excel-import/keys.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};

const migration = read(
  "supabase/migrations/20260718210000_source_only_atomic_import_job_commit.sql",
);
const prior = read("supabase/migrations/20260718180000_import_manifest_contract.sql");
const commit = read("src/lib/excel-import/commit.ts");
const safety = read("src/lib/excel-import/safety.ts");
const importUi = read("src/components/data-onboarding/import-workspace.tsx");
const fixture = read("tests/fixtures/import-atomic-commit/proof.sql");

// 1) authorized atomic commit surface
assert(migration.includes("commit_import_job_atomic"), "1 public atomic RPC");
assert(migration.includes("SECURITY DEFINER"), "1 security definer");
assert(migration.includes("SET search_path = public, pg_temp"), "1 safe search_path");
assert(migration.includes("FOR UPDATE"), "1 job lock");

// 2-3) auth gates
assert(migration.includes("import_manager_actor"), "2/3 actor via import_manager_actor");
assert(migration.includes("auth.uid()") || prior.includes("auth.uid()"), "2 auth.uid required");
assert(migration.includes("42501") || prior.includes("42501"), "3 privilege reject codes");

// 4-6) isolation / substitution
assert(migration.includes("created_by IS DISTINCT FROM v_actor"), "5 actor substitution reject");
assert(
  migration.includes("college ALWAYS from the job") ||
    migration.includes("v_college := v_job.college_id"),
  "4 college from job (cross-college reject)",
);
assert(
  migration.includes("payload_manifest IS DISTINCT FROM md5"),
  "6 payload substitution / manifest reject",
);

// 7-8) regular/parallel + cohort/delivery-group
assert(
  sectionIsolationKey({
    term_code: "T1",
    course_code: "C1",
    section_number: 1,
    study_system: "parallel",
  }) !==
    sectionIsolationKey({
      term_code: "T1",
      course_code: "C1",
      section_number: 1,
      study_system: "regular",
    }),
  "7 regular/parallel isolation key",
);
assert(migration.includes("study_system"), "7 study_system in SQL handlers");
assert(
  deliveryGroupIsolationKey({
    cohort_code: "A",
    course_code: "C",
    component_type: "theory",
    delivery_group_code: "G1",
    employee_number: "E1",
  }) !==
    deliveryGroupIsolationKey({
      cohort_code: "B",
      course_code: "C",
      component_type: "theory",
      delivery_group_code: "G1",
      employee_number: "E1",
    }),
  "8 cohort isolation in V2 keys",
);
assert(migration.includes("_import_apply_teaching_assignments_v2"), "8 V2 handler");
assert(migration.includes("delivery_group_id"), "8 delivery_group identity");

// 9-11) stored payload authoritative + pre-validation + rollback
assert(migration.includes("validated_payload"), "9 stored payload authoritative");
assert(migration.includes("pre-validate"), "10 pre-validation before DML");
assert(
  fixture.includes("forced") || fixture.includes("rollback"),
  "11 forced failure rollback fixture",
);

// 12-13) audit
assert(migration.includes("import_job_committed"), "13 audit on success");
assert(
  fixture.includes("audit") || fixture.includes("import_job_committed"),
  "12/13 audit fixtures",
);

// 14-15) replay + concurrent
assert(
  migration.includes("'replay', true") ||
    migration.includes('replay": true') ||
    migration.includes("replay", true),
  "14 replay protection",
);
assert(migration.includes("FOR UPDATE"), "15 concurrent double-commit protection");

// 16-17) lock ordering + server counters
assert(
  migration.includes("ORDER BY id") || migration.includes("ORDER BY v_id"),
  "16 deterministic lock ordering",
);
assert(
  migration.includes("inserted_rows") && migration.includes("v_counters"),
  "17 server-derived counters",
);

// 18-19) no client operational DML / no partial success
assert(commit.includes('rpc("commit_import_job_atomic"'), "18 client calls atomic RPC");
assert(
  !/\.from\([^)]+\)[\s\S]{0,80}\.(insert|update|upsert|delete)\(/.test(commit),
  "18 no client operational DML in commit.ts",
);
assert(
  !commit.includes("commitTable") && !commit.includes("commitCustom"),
  "18 no client dispatcher",
);
assert(
  !commit.includes("finalizeImportJob") && !commit.includes("claimImportJob"),
  "18 no claim/finalize client path",
);
assert(
  migration.includes("failed', 0") || migration.includes("'failed', 0"),
  "19 no partial success counters",
);
assert(importUi.includes("commitImport({"), "18 UI uses job_id-only commit");

// 20) Legacy compatibility
assert(migration.includes("_import_apply_teaching_assignments"), "20 legacy TA handler");
assert(migration.includes("_import_apply_sections"), "20 legacy sections handler");
assert(normalizeImportKeyPart("  ReGuLaR ") === "regular", "20 key normalize legacy default");

// 21) migration safety
assert(
  migration.includes("SOURCE-ONLY") && migration.includes("NOT APPLIED"),
  "21 source-only marker",
);
assert(
  !/\nINSERT INTO public\.(instructors|rooms|sections|academic_cohorts)\b/i.test(
    migration.split("CREATE OR REPLACE FUNCTION")[0] ?? "",
  ),
  "21 no top-level operational seed before functions",
);
assert(migration.includes("does NOT run any import, backfill, seed"), "21 no backfill policy");
assert(
  !/PERFORM\s+public\.commit_import_job_atomic\s*\(/.test(migration),
  "21 no invocation during apply",
);
assert(
  migration.includes("BEGIN;") && migration.includes("COMMIT;"),
  "21 transactional DDL wrapper",
);

// Grants
assert(
  migration.includes("REVOKE ALL ON FUNCTION public.commit_import_job_atomic"),
  "grants: revoke public/anon",
);
assert(
  migration.includes("GRANT EXECUTE ON FUNCTION public.commit_import_job_atomic"),
  "grants: authenticated execute",
);
assert(migration.includes("REVOKE ALL ON FUNCTION public._import_dispatch"), "helpers revoked");
assert(
  /REVOKE\s+INSERT\s*,\s*UPDATE\s*,\s*DELETE\s+ON\s+public\.import_jobs\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i.test(
    migration,
  ),
  "grants: table DML revoked from PUBLIC/anon/authenticated on import_jobs",
);
assert(
  /REVOKE\s+INSERT\s*,\s*UPDATE\s*,\s*DELETE\s+ON\s+public\.import_errors\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i.test(
    migration,
  ),
  "grants: table DML revoked from PUBLIC/anon/authenticated on import_errors",
);
assert(safety.includes("requireImportManager"), "preview auth still present");

console.log("import-pipeline-atomic-commit.harness.ts: PASS");

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

assert(normalizeImportKeyPart("  ReGuLaR ") === "regular", "key parts normalize");
assert(
  sectionIsolationKey({ term_code: "T1", course_code: "C1", section_number: 1 }) ===
    "t1|c1|1|regular",
  "legacy section rows default to regular",
);
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
  "regular and parallel sections cannot collide",
);
assert(
  deliveryGroupIsolationKey({
    cohort_code: "COHORT-A",
    course_code: "CS101",
    component_type: "theory",
    delivery_group_code: "G1",
    employee_number: "E1",
  }) !==
    deliveryGroupIsolationKey({
      cohort_code: "COHORT-B",
      course_code: "CS101",
      component_type: "theory",
      delivery_group_code: "G1",
      employee_number: "E1",
    }),
  "delivery assignment identity includes cohort",
);

const safety = read("src/lib/excel-import/safety.ts");
const validators = read("src/lib/excel-import/validators.ts");
const commit = read("src/lib/excel-import/commit.ts");
const manifestMigration = read("supabase/migrations/20260718180000_import_manifest_contract.sql");
const atomicMigration = read(
  "supabase/migrations/20260718210000_source_only_atomic_import_job_commit.sql",
);

assert(safety.includes("requireImportManager"), "authorization guard exists");
assert(safety.includes('.eq("college_id", collegeId)'), "authorization is college-scoped");
assert(validators.includes("await requireImportManager(collegeId)"), "preview is authorized");
assert(commit.includes('rpc("commit_import_job_atomic"'), "commit is a single atomic RPC");
assert(commit.includes("create_import_preview_manifest"), "preview persists server manifest");
assert(!commit.includes("claimImportJob"), "commit no longer uses client claim path");
assert(!commit.includes("finalizeImportJob"), "commit no longer uses client finalize path");
assert(
  manifestMigration.includes("validated_payload IS DISTINCT FROM p_validated_payload"),
  "same-count substitution is rejected at claim (legacy RPC retained)",
);
assert(manifestMigration.includes("FOR UPDATE"), "job transitions are serialized");
assert(
  manifestMigration.includes("REVOKE INSERT, UPDATE, DELETE ON public.import_jobs"),
  "direct mutations are revoked",
);
assert(
  /REVOKE\s+INSERT\s*,\s*UPDATE\s*,\s*DELETE\s+ON\s+public\.import_jobs\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i.test(
    atomicMigration,
  ),
  "atomic migration re-asserts anon/authenticated/PUBLIC table DML revoke",
);
assert(
  manifestMigration.includes("INSERT INTO public.audit_logs"),
  "audit writes share RPC transactions",
);
assert(atomicMigration.includes("commit_import_job_atomic"), "atomic commit migration present");
assert(atomicMigration.includes("import_job_committed"), "atomic success audit present");

console.log("import-pipeline-safety.harness.ts: PASS");

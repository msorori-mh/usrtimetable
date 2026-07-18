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
const migration = read("supabase/migrations/20260718180000_import_manifest_contract.sql");
assert(safety.includes("requireImportManager"), "authorization guard exists");
assert(safety.includes('.eq("college_id", collegeId)'), "authorization is college-scoped");
assert(safety.includes('rpc("claim_import_job_manifest"'), "job claim is server-observable");
assert(validators.includes("await requireImportManager(collegeId)"), "preview is authorized");
assert(commit.includes("await claimImportJob"), "commit binds and claims preview job");
assert(commit.includes("claimedRows"), "commit consumes the server-stored payload");
assert(commit.includes("await finalizeImportJob"), "finalization is observable");
assert(commit.includes("await failImportJob"), "interrupted commits have a recovery transition");
assert(migration.includes("validated_payload IS DISTINCT FROM p_validated_payload"), "same-count substitution is rejected");
assert(migration.includes("FOR UPDATE"), "job transitions are serialized");
assert(migration.includes("REVOKE INSERT, UPDATE, DELETE ON public.import_jobs"), "direct mutations are revoked");
assert(migration.includes("INSERT INTO public.audit_logs"), "audit writes share RPC transactions");

console.log("import-pipeline-safety.harness.ts: PASS");

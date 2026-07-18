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
assert(safety.includes("requireImportManager"), "authorization guard exists");
assert(safety.includes('.eq("college_id", collegeId)'), "authorization is college-scoped");
assert(safety.includes('.eq("status", "preview")'), "job claim is compare-and-set");
assert(validators.includes("await requireImportManager(collegeId)"), "preview is authorized");
assert(commit.includes("await claimImportJob"), "commit binds and claims preview job");
assert(commit.includes('status: result.failed > 0 ? "failed" : "committed"'), "partial failures reported");

console.log("import-pipeline-safety.harness.ts: PASS");

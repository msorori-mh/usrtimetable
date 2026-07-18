import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCohortCurriculumSummary } from "../../src/lib/academic-delivery/cohort-curriculum-summary.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rejects(fn: () => unknown, expected: string) {
  try {
    fn();
  } catch (error) {
    assert(error instanceof Error && error.message === expected, expected);
    return;
  }
  throw new Error(`expected ${expected}`);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const service = readFileSync(join(root, "src/lib/academic-delivery/cohort-curriculum.ts"), "utf8");
const route = readFileSync(join(root, "src/routes/_authenticated/academic-cohorts.tsx"), "utf8");

assert(service.includes('supabase.rpc("generate_cohort_curriculum"'), "runtime calls cohort RPC");
assert(
  !service.includes("course_offering_sections"),
  "runtime has no operational-section dependency",
);
assert(
  !service.includes('.from("registrations")'),
  "runtime has no individual-registration dependency",
);
assert(route.includes("useGenerateCohortCurriculum"), "cohort route exposes curriculum action");
assert(route.includes("skipped_unselected_elective"), "route reports unapproved elective slots");

const summary = parseCohortCurriculumSummary({
  operation: "generate_cohort_curriculum",
  result: "success",
  cohort_id: "11111111-1111-4111-8111-111111111111",
  study_plan_id: "22222222-2222-4222-8222-222222222222",
  semester: 1,
  term_type: "first",
  inserted_offerings: 4,
  skipped_existing: 2,
  skipped_summer_only: 1,
  skipped_unselected_elective: 1,
  required_candidates: 6,
  elective_candidates: 1,
  warnings: [{ code: "ELECTIVE_SLOT_UNSELECTED" }],
  created_sections: 0,
  created_delivery_groups: 0,
  created_sessions: 0,
});
assert(
  summary.cohort_id === "11111111-1111-4111-8111-111111111111",
  "summary remains cohort-scoped",
);
assert(summary.skipped_unselected_elective === 1, "unapproved elective remains skipped");

rejects(
  () => parseCohortCurriculumSummary({ ...summary, created_sections: 1 }),
  "COHORT_CURRICULUM_OPERATIONAL_SIDE_EFFECT_REPORTED",
);
rejects(
  () => parseCohortCurriculumSummary({ ...summary, cohort_id: "not-a-uuid" }),
  "COHORT_CURRICULUM_MISSING_CONTEXT",
);
rejects(
  () => parseCohortCurriculumSummary(summary, "33333333-3333-4333-8333-333333333333"),
  "COHORT_CURRICULUM_COHORT_MISMATCH",
);
rejects(
  () => parseCohortCurriculumSummary({ ...summary, term_type: "summer" }),
  "COHORT_CURRICULUM_INVALID_TERM_TYPE",
);
rejects(
  () => parseCohortCurriculumSummary({ ...summary, result: "partial" }),
  "COHORT_CURRICULUM_UNEXPECTED_RESULT",
);

console.log("cohort-curriculum-runtime.harness.ts: PASS");

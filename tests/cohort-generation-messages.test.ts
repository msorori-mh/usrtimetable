import test from "node:test";
import assert from "node:assert/strict";
import {
  uniqueMatchingStudyPlan,
  generationErrorMessage,
} from "../src/lib/academic-delivery/generation-messages.ts";
import { parseCohortCurriculumSummary } from "../src/lib/academic-delivery/cohort-curriculum-summary.ts";
import { parseDeliveryGroupGeneratorSummary } from "../src/lib/academic-delivery/delivery-group-generator-summary.ts";

test("client preview accepts one matching scope and blocks absence or ambiguity", () => {
  assert.equal(uniqueMatchingStudyPlan(["new", "new"]), "new");
  assert.throws(() => uniqueMatchingStudyPlan([]), /MISSING_FOR_COHORT_LEVEL_TERM/);
  assert.throws(() => uniqueMatchingStudyPlan(["old", "new"]), /AMBIGUOUS_FOR_COHORT_LEVEL_TERM/);
});
test("RPC object errors receive Arabic actionable explanations", () => {
  assert.match(
    generationErrorMessage({ message: "STUDY_PLAN_MISSING_FOR_COHORT_LEVEL_TERM" }),
    /المستوى والفصل/,
  );
  assert.match(generationErrorMessage(new Error("COHORT_CURRICULUM_EMPTY")), /لم تُوجد مقررات/);
  assert.equal(generationErrorMessage(new Error("network disconnected")), "network disconnected");
});
test("empty old server group success cannot masquerade as unchanged", () => {
  assert.throws(
    () => parseDeliveryGroupGeneratorSummary({ status: "NO_CHANGES", components_processed: 0 }),
    /COHORT_TIMETABLED_COMPONENTS_EMPTY/,
  );
  assert.equal(
    parseDeliveryGroupGeneratorSummary({
      status: "NO_CHANGES",
      components_processed: 2,
      groups_unchanged: 5,
    }).status,
    "NO_CHANGES",
  );
});
test("empty old server curriculum cannot masquerade as already current", () => {
  const result = {
    operation: "generate_cohort_curriculum",
    result: "success",
    cohort_id: "11111111-1111-4111-8111-111111111111",
    study_plan_id: "22222222-2222-4222-8222-222222222222",
    term_type: "first",
    semester: 1,
    inserted_offerings: 0,
    skipped_existing: 0,
    skipped_summer_only: 0,
    skipped_unselected_elective: 0,
    required_candidates: 0,
    elective_candidates: 0,
    warnings: [],
    created_sections: 0,
    created_delivery_groups: 0,
    created_sessions: 0,
  };
  assert.throws(() => parseCohortCurriculumSummary(result), /COHORT_CURRICULUM_EMPTY/);
  assert.equal(
    parseCohortCurriculumSummary({ ...result, skipped_existing: 6 }).skipped_existing,
    6,
  );
});

test("approved cohort plan resolves overlap without falling back to another plan", () => {
  assert.equal(uniqueMatchingStudyPlan(["old", "new", "old"], "old"), "old");
  assert.equal(uniqueMatchingStudyPlan(["old", "new"], "new"), "new");
  assert.throws(() => uniqueMatchingStudyPlan(["new"], "old"), /MISSING_FOR_COHORT_LEVEL_TERM/);
  assert.throws(() => uniqueMatchingStudyPlan(["old", "new"], null), /AMBIGUOUS_FOR_COHORT_LEVEL_TERM/);
});

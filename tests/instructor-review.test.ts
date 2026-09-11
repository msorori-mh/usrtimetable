import { test } from "node:test";
import assert from "node:assert/strict";
import {
  instructorNeedsReview,
  parseInstructorReviewSearch,
  isMissingInstructorSpecialization,
} from "../src/lib/data-onboarding/instructor-review";
import { classifyNewFlowReadinessIssues } from "../src/lib/data-onboarding/classify";

test("specialization review includes null, blank and whitespace without inferring a specialty from the department", () => {
  const rows = [
    { specialization: null, department_id: "d1" },
    { specialization: "", department_id: "d1" },
    { specialization: "   ", department_id: null },
    { specialization: "هندسة البرمجيات", department_id: null },
  ];
  assert.deepEqual(rows.filter(isMissingInstructorSpecialization), rows.slice(0, 3));
  assert.deepEqual(
    rows.filter((r) => instructorNeedsReview(r, "missing_specialization")),
    rows.filter(isMissingInstructorSpecialization),
  );
  assert.deepEqual(
    rows.filter((r) => instructorNeedsReview(r, "missing_department")),
    rows.slice(2),
  );
});

test("review search accepts only supported filters and never grants permissions", () => {
  assert.deepEqual(
    parseInstructorReviewSearch({ review: "missing_specialization", role: "super_admin" }),
    { review: "missing_specialization" },
  );
  assert.deepEqual(parseInstructorReviewSearch({ review: "missing_department" }), {
    review: "missing_department",
  });
  for (const review of [undefined, "all", "invalid", ["missing_specialization"], {}])
    assert.deepEqual(parseInstructorReviewSearch({ review }), {});
});

test("each instructor readiness issue carries its specific repair filter", () => {
  const issues = classifyNewFlowReadinessIssues([
    { label: "محاضرون بدون تخصص", missing: 32, total: 32, category: "resources" },
    { label: "محاضرون بدون قسم", missing: 2, total: 32, category: "resources" },
    { label: "محاضرون بدون توفر", missing: 2, total: 32, category: "resources" },
  ]);
  assert.equal(issues[0].fixHref, "/instructors");
  assert.deepEqual(issues[0].fixSearch, { review: "missing_specialization" });
  assert.deepEqual(issues[1].fixSearch, { review: "missing_department" });
  assert.equal(issues[2].fixHref, "/availability");
  assert.equal(issues[2].fixSearch, undefined);
});

test("a completed instructor issue no longer offers a repair link", () => {
  const [issue] = classifyNewFlowReadinessIssues([
    { label: "محاضرون بدون تخصص", missing: 0, total: 32, category: "resources" },
  ]);
  assert.equal(issue.fixHref, null);
  assert.equal(issue.fixSearch, undefined);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  cohortComponentInstructorViolationMessageAr,
  findCohortComponentInstructorViolations,
  parseCohortComponentInstructorReadiness,
  type CohortComponentInstructorFact,
} from "../src/lib/scheduling/cohort-component-instructor.ts";

const fact = (
  overrides: Partial<CohortComponentInstructorFact> = {},
): CohortComponentInstructorFact => ({
  cohortId: "cohort-1",
  planCourseId: "plan-course-1",
  componentType: "theory",
  deliveryGroupId: "group-1",
  assignmentId: "assignment-1",
  instructorIdentityId: "faculty-1",
  instructorName: "المحاضر الأول",
  ...overrides,
});

test("accepts one faculty identity across all split theory groups", () => {
  const violations = findCohortComponentInstructorViolations([
    fact(),
    fact({
      deliveryGroupId: "group-2",
      assignmentId: "assignment-2",
      // A verified college-local alias still represents the same person.
      instructorIdentityId: "faculty-1",
    }),
  ]);

  assert.deepEqual(violations, []);
});

test("rejects distributing one split theory component across two people", () => {
  const [violation] = findCohortComponentInstructorViolations([
    fact(),
    fact({
      deliveryGroupId: "group-2",
      assignmentId: "assignment-2",
      instructorIdentityId: "faculty-2",
      instructorName: "المحاضر الثاني",
    }),
  ]);

  assert.deepEqual(
    {
      component_type: violation.component_type,
      group_count: violation.group_count,
      instructor_count: violation.instructor_count,
      identity_missing_count: violation.identity_missing_count,
    },
    {
      component_type: "theory",
      group_count: 2,
      instructor_count: 2,
      identity_missing_count: 0,
    },
  );
  assert.match(cohortComponentInstructorViolationMessageAr(violation), /موزع على أكثر من محاضر/);
});

test("allows the theory instructor to differ from the practical instructor", () => {
  const violations = findCohortComponentInstructorViolations([
    fact(),
    fact({ deliveryGroupId: "theory-2", assignmentId: "theory-assignment-2" }),
    fact({
      componentType: "practical",
      deliveryGroupId: "lab-1",
      assignmentId: "lab-assignment-1",
      instructorIdentityId: "faculty-2",
    }),
    fact({
      componentType: "practical",
      deliveryGroupId: "lab-2",
      assignmentId: "lab-assignment-2",
      instructorIdentityId: "faculty-2",
    }),
  ]);

  assert.deepEqual(violations, []);
});

test("fails closed when an assigned lecturer has no university identity", () => {
  const [violation] = findCohortComponentInstructorViolations([
    fact(),
    fact({
      deliveryGroupId: "group-2",
      assignmentId: "assignment-2",
      instructorIdentityId: null,
      instructorName: "سجل غير مكتمل",
    }),
  ]);

  assert.equal(violation.identity_missing_count, 1);
  assert.match(cohortComponentInstructorViolationMessageAr(violation), /الهوية/);
});

test("does not treat an unassigned split group as a fake missing instructor", () => {
  const violations = findCohortComponentInstructorViolations([
    fact(),
    fact({
      deliveryGroupId: "group-2",
      assignmentId: null,
      instructorIdentityId: null,
      instructorName: null,
    }),
  ]);

  assert.deepEqual(violations, []);
});

test("does not extend the split-group rule to an unsplit component", () => {
  const violations = findCohortComponentInstructorViolations([
    fact(),
    fact({
      assignmentId: "co-teacher-assignment",
      instructorIdentityId: "faculty-2",
    }),
  ]);

  assert.deepEqual(violations, []);
});

test("ignores tutorial/project rows because the fixed rule is theory/practical", () => {
  const violations = findCohortComponentInstructorViolations([
    fact({ componentType: "tutorial" }),
    fact({
      componentType: "tutorial",
      deliveryGroupId: "tutorial-2",
      instructorIdentityId: "faculty-2",
    }),
  ]);

  assert.deepEqual(violations, []);
});

test("parses the server readiness contract and preserves actionable labels", () => {
  const parsed = parseCohortComponentInstructorReadiness({
    ok: false,
    college_id: "college-1",
    schedule_version_id: "version-1",
    academic_term_id: "term-1",
    violation_count: 1,
    violations: [
      {
        cohort_id: "cohort-1",
        cohort_code: "IT-L2-2025",
        plan_course_id: "plan-course-1",
        course_code: "CS201",
        course_name: "هياكل البيانات",
        component_type: "practical",
        group_count: 2,
        instructor_count: 2,
        identity_missing_count: 0,
        instructor_names: ["أ", "ب"],
        assignment_ids: ["a1", "a2"],
      },
    ],
  });

  assert.equal(parsed.ok, false);
  assert.equal(parsed.violation_count, 1);
  assert.match(
    cohortComponentInstructorViolationMessageAr(parsed.violations[0]),
    /CS201 — هياكل البيانات/,
  );
});

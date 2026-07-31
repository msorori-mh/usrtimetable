import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyNewFlowReadinessIssues,
  classifyReadinessMetricFlow,
  countSeverities,
  isNewFlowReadinessMetric,
  isStudySystemFilterIsolated,
  partitionByStudySystem,
  buildWizardStepResults,
  wizardPercentComplete,
  WIZARD_STEPS,
  type OnboardingCounts,
} from "../src/lib/data-onboarding/index.ts";
import type { ReadinessData, ReadinessMetric } from "../src/lib/reports/readiness.ts";
import {
  filterPrintSessions,
  sanitizePrintFilters,
  type PrintSessionLike,
} from "../src/lib/print-center/index.ts";

function metric(
  partial: Partial<ReadinessMetric> & Pick<ReadinessMetric, "label" | "category">,
): ReadinessMetric {
  return {
    total: partial.total ?? 10,
    missing: partial.missing ?? 0,
    critical: partial.critical,
    label: partial.label,
    category: partial.category,
  };
}

describe("data-onboarding New Flow classification", () => {
  it("excludes Legacy course-offering metrics from New Flow issues", () => {
    const metrics: ReadinessMetric[] = [
      metric({
        label: "عروض مقررات بدون إسناد تدريسي",
        category: "scheduling",
        missing: 5,
        critical: false,
      }),
      metric({
        label: "إسناد بدون محاضر",
        category: "scheduling",
        missing: 2,
        critical: true,
      }),
      metric({
        label: "مجموعات محاضرات/معامل بدون إسناد تدريسي (V2)",
        category: "scheduling",
        missing: 3,
      }),
      metric({
        label: "إسناد تدريسي (V2) بدون محاضر",
        category: "scheduling",
        missing: 1,
        critical: true,
      }),
      metric({
        label: "قاعات بسعة ≤ 0",
        category: "resources",
        missing: 1,
        critical: true,
      }),
    ];

    assert.equal(classifyReadinessMetricFlow(metrics[0]!), "legacy");
    assert.equal(classifyReadinessMetricFlow(metrics[1]!), "legacy");
    assert.equal(classifyReadinessMetricFlow(metrics[2]!), "new_flow");
    assert.equal(classifyReadinessMetricFlow(metrics[3]!), "new_flow");
    assert.equal(classifyReadinessMetricFlow(metrics[4]!), "shared");

    const issues = classifyNewFlowReadinessIssues(metrics);
    assert.equal(
      issues.some((i) => i.label.includes("عروض مقررات")),
      false,
      "Legacy offerings excluded",
    );
    assert.equal(
      issues.some((i) => i.label === "إسناد بدون محاضر"),
      false,
      "Legacy V1 TA excluded",
    );
    assert.equal(issues.length, 3);
    assert.ok(
      issues.every(
        (i) =>
          isNewFlowReadinessMetric(metric({ label: i.label, category: "scheduling" })) ||
          i.flow === "shared" ||
          i.flow === "new_flow",
      ),
    );

    const counts = countSeverities(issues);
    assert.equal(counts.BLOCKER, 2); // V2 without instructor + room capacity
    assert.equal(counts.WARNING, 1); // DG without TA V2 at 30%
  });

  it("keeps regular and parallel study systems isolated", () => {
    assert.equal(isStudySystemFilterIsolated("regular"), true);
    assert.equal(isStudySystemFilterIsolated("parallel"), true);
    assert.equal(isStudySystemFilterIsolated("all"), true);
    assert.equal(isStudySystemFilterIsolated("evening" as "regular"), false);

    const parts = partitionByStudySystem([
      { id: "1", study_system: "regular" },
      { id: "2", study_system: "parallel" },
      { id: "3", study_system: "both" },
      { id: "4", study_system: "regular" },
    ]);
    assert.deepEqual(
      parts.regular.map((r) => r.id),
      ["1", "4"],
    );
    assert.deepEqual(
      parts.parallel.map((r) => r.id),
      ["2"],
    );
    assert.equal(
      parts.regular.some((r) => r.study_system === "parallel"),
      false,
    );
  });

  it("builds 10 wizard steps with statuses from counts", () => {
    assert.equal(WIZARD_STEPS.length, 10);
    const counts: OnboardingCounts = {
      departments: 1,
      programs: 1,
      terms: 1,
      planCourses: 5,
      cohorts: 2,
      deliveryGroups: 4,
      instructors: 3,
      rooms: 2,
      teachingAssignmentsV2: 4,
      instructorsWithAvailability: 2,
      scheduleVersions: 1,
    };
    const readiness: ReadinessData = {
      totals: {
        courses: 5,
        planCourses: 5,
        instructors: 3,
        rooms: 2,
        offerings: 0,
        assignments: 4,
        sessions: 0,
      },
      studyPlan: [metric({ label: "صفوف الخطة بدون مستوى", category: "study_plan", missing: 0 })],
      resources: [
        metric({ label: "قاعات بسعة ≤ 0", category: "resources", missing: 0, critical: true }),
      ],
      scheduling: [
        metric({
          label: "عروض مقررات بدون إسناد تدريسي",
          category: "scheduling",
          missing: 99,
        }),
        metric({
          label: "مجموعات محاضرات/معامل بدون إسناد تدريسي (V2)",
          category: "scheduling",
          missing: 0,
        }),
      ],
      scores: { studyPlanScore: 100, resourcesScore: 100, schedulingScore: 100, overall: 100 },
    };
    const steps = buildWizardStepResults(counts, readiness);
    assert.equal(steps.length, 10);
    assert.ok(steps.every((s) => s.helpEli5Ar.length > 10));
    // Legacy offerings gap must not force readiness_check into blocker when New Flow is clean
    const readinessStep = steps.find((s) => s.id === "readiness_check")!;
    assert.notEqual(readinessStep.status, "blocker");
    assert.ok(wizardPercentComplete(steps) >= 50);
  });
});

describe("print-center leftover filter fix", () => {
  function makeSession(overrides: Partial<PrintSessionLike> & { id: string }): PrintSessionLike {
    return {
      day_of_week: 0,
      start_time: "08:00:00",
      end_time: "10:00:00",
      session_type: "lecture",
      study_system: "regular",
      college_id: "college-a",
      instructor_id: "ins-1",
      room_id: "room-1",
      cohort_id: "cohort-1",
      delivery_group_id: "dg-1",
      course_offerings: {
        program_id: "prog-1",
        level_id: "lvl-1",
        courses: {
          code: "CS101",
          name: "مقدمة",
          department_id: "dept-1",
        },
      },
      ...overrides,
    };
  }

  it("instructor report with leftover programId still returns all college sessions (or instructor-filtered only)", () => {
    const sessions = [
      makeSession({ id: "a", instructor_id: "ins-1" }),
      makeSession({
        id: "b",
        instructor_id: "ins-1",
        course_offerings: {
          program_id: "prog-OTHER",
          level_id: "lvl-9",
          courses: { code: "X", name: "Y", department_id: "dept-9" },
        },
      }),
      makeSession({ id: "c", instructor_id: "ins-2" }),
    ];

    const dirty = {
      reportType: "instructor" as const,
      collegeId: "college-a",
      programId: "prog-1", // leftover from student report
      levelId: "lvl-1",
      departmentId: "dept-1",
      instructorId: null as string | null,
      studySystem: "all" as const,
    };

    const sanitized = sanitizePrintFilters(dirty);
    assert.equal(sanitized.programId, null);
    assert.equal(sanitized.levelId, null);
    assert.equal(sanitized.departmentId, null);

    const allCollege = filterPrintSessions(sessions, dirty);
    assert.deepEqual(
      allCollege.map((s) => s.id).sort(),
      ["a", "b", "c"],
      "leftover programId must not shrink instructor college view",
    );

    const byInstructor = filterPrintSessions(sessions, {
      ...dirty,
      instructorId: "ins-1",
    });
    assert.deepEqual(
      byInstructor.map((s) => s.id).sort(),
      ["a", "b"],
      "instructor filter still applies; program leftover does not",
    );
  });
});

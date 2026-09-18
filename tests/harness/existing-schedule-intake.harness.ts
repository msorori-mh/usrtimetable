import assert from "node:assert/strict";
import {
  expandIntakeTimetable,
  type IntakeMembership,
  PENDING_QUOTA_AR,
} from "../../src/lib/existing-schedules/presentation";
import type { WorkspaceSessionHydratedRow } from "../../src/lib/schedule-builder/session-hydrate";
import {
  computeQuotaBalance,
  QUOTA_STATUS_LABEL_AR,
} from "../../src/lib/reports/instructor-quota";

const membership = (program: string, group: string): IntakeMembership => ({
  source_id: group,
  cohort_id: `cohort-${program}`,
  delivery_group_id: group,
  study_plan_id: `plan-${program}`,
  program_id: program,
  program_name: program,
  level_id: `level-${program}`,
  level_name: "الأول",
  department_id: program,
  department_name: program,
});
const session = {
  id: "physical",
  expected_students: null,
  instructor_id: "teacher",
  intake_memberships: [membership("arts", "a"), membership("english", "e")],
  course_offerings: { program_id: "arts", courses: { name: "English" } },
} as unknown as WorkspaceSessionHydratedRow;
const before = JSON.stringify(session);
const expanded = expandIntakeTimetable([session]);
assert.equal(
  expanded.length,
  2,
  "shared class must appear for both receiving programs",
);
assert.equal(
  new Set(expanded.map((r) => r.id)).size,
  2,
  "presentation IDs must be unique",
);
assert.equal(
  expandIntakeTimetable([session], { programId: "english" })[0].cohort_id,
  "cohort-english",
);
assert.equal(
  expandIntakeTimetable([session], {
    programId: "english",
    cohortId: "cohort-arts",
  }).length,
  0,
  "filters must match the same membership",
);
assert.equal(
  expanded[1].expected_students,
  null,
  "unknown headcount must remain unknown",
);
assert.equal(
  JSON.stringify(session),
  before,
  "presentation cannot mutate physical workload/editor data",
);
const normal = { ...session, id: "normal", intake_memberships: undefined };
assert.equal(
  expandIntakeTimetable([normal])[0],
  normal,
  "ordinary timetable behavior must be preserved",
);
const unknown = computeQuotaBalance({ maxWeeklyHours: null, assignedHours: 9 });
assert.equal(unknown.assignedHours, 9);
assert.equal(unknown.overloadHours, null);
assert.equal(QUOTA_STATUS_LABEL_AR[unknown.status], PENDING_QUOTA_AR);
assert.equal(
  computeQuotaBalance({ maxWeeklyHours: 8, assignedHours: 9 }).overloadHours,
  1,
);
assert.equal(
  computeQuotaBalance({ maxWeeklyHours: 0, assignedHours: 9 }).overloadHours,
  9,
  "approved zero is not missing",
);
console.log("EXISTING_SCHEDULE_INTAKE_PASS");

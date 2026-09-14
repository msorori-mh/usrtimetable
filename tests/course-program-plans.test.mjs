import test from "node:test";
import assert from "node:assert/strict";
import { coursePrograms, programCount, hoursConflict } from "../src/lib/course-program-plans.ts";
const row = (program, hours = 2) => ({
  id: program,
  course_id: "c",
  semester: 1,
  study_plans: {
    name: "plan",
    program_id: program,
    is_active: true,
    academic_programs: { name: program },
  },
  academic_levels: { level_number: 1 },
  plan_course_components: [{ component_type: "theory", weekly_contact_hours: hours }],
});
test("programs remain distinct even when they share a department, including Jawf", () => {
  const rows = [row("CIS"), row("CIS-Jawf"), row("CIS")];
  assert.equal(programCount(coursePrograms(rows, "c")), 2);
});
test("inactive plans and other courses are not memberships", () => {
  const inactive = row("AI");
  inactive.study_plans.is_active = false;
  assert.deepEqual(coursePrograms([inactive, { ...row("CS"), course_id: "other" }], "c"), []);
});
test("equal totals with different components still require review", () => {
  const practical = row("AI");
  practical.plan_course_components[0].component_type = "practical";
  assert.equal(hoursConflict([row("CS"), practical]), true);
  assert.equal(hoursConflict([row("CS"), row("IT")]), false);
});
test("component order and split entries do not create false hour conflicts", () => {
  const split = row("AI");
  split.plan_course_components = [
    { component_type: "theory", weekly_contact_hours: 1 },
    { component_type: "theory", weekly_contact_hours: 1 },
  ];
  assert.equal(hoursConflict([row("CS"), split]), false);
});

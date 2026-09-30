import test from "node:test";
import assert from "node:assert/strict";
import { assembleWorkspaceSessionRows } from "../src/lib/schedule-builder/session-hydrate.ts";

const lookups = {
  offerings: new Map([["offering", {
    id: "offering", program_id: "program", level_id: "level", course_id: "course",
    expected_students: 25,
  }]]),
  courses: new Map(), departments: new Map(), programs: new Map(), levels: new Map(),
  sections: new Map(), subgroups: new Map(), instructors: new Map(), rooms: new Map(),
};

for (const studySystem of ["regular", "both"]) {
  test(`shared ${studySystem} lecture keeps the combined session headcount`, () => {
    const [row] = assembleWorkspaceSessionRows([{
      id: "session", day_of_week: 1, start_time: "08:00", end_time: "10:00",
      session_type: "lecture", study_system: studySystem, section_id: null,
      instructor_id: null, room_id: null, updated_at: null, is_locked: false,
      course_offering_id: "offering", expected_students: 67,
      cohort_id: "anchor", shared_cohort_ids: ["anchor", "member"],
    }], lookups);
    assert.equal(row.expected_students, 67);
    assert.equal(row.study_system, studySystem);
  });
}

test("ordinary session keeps its original offering headcount", () => {
  const [row] = assembleWorkspaceSessionRows([{
    id: "session", day_of_week: 1, start_time: "08:00", end_time: "10:00",
    session_type: "lecture", study_system: "regular", section_id: null,
    instructor_id: null, room_id: null, updated_at: null, is_locked: false,
    course_offering_id: "offering", expected_students: 67,
    cohort_id: "anchor", shared_cohort_ids: ["anchor"],
  }], lookups);
  assert.equal(row.expected_students, 25);
});

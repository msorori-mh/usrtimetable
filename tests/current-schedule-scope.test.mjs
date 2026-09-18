import test from "node:test";
import assert from "node:assert/strict";
import { filterCurrentScheduleScope } from "../src/lib/print-center/current-schedule-scope.ts";

const programs = [
  { id: "cs", department_id: "computing" },
  { id: "it", department_id: "computing" },
  { id: "ar", department_id: "arts" },
];
const session = (id, program, courseDepartment = "general") => ({
  id,
  day_of_week: 0,
  start_time: "08:00",
  end_time: "10:00",
  course_offerings: {
    program_id: program,
    courses: { department_id: courseDepartment },
  },
});
const sessions = [
  session("a", "cs"),
  session("b", "it"),
  session("c", "ar"),
  session("unknown", null),
];
const ids = (rows) => rows.map((r) => r.id);
test("all preserves every session, including missing program metadata", () => {
  assert.deepEqual(
    filterCurrentScheduleScope(sessions, [], "all", "all"),
    sessions,
  );
});
test("department includes every member program and its general-requirement courses", () => {
  assert.deepEqual(
    ids(filterCurrentScheduleScope(sessions, programs, "computing", "all")),
    ["a", "b"],
  );
});
test("program works independently of department selection", () => {
  assert.deepEqual(
    ids(filterCurrentScheduleScope(sessions, programs, "all", "it")),
    ["b"],
  );
});
test("department and program intersect; contradictory selections fail closed", () => {
  assert.deepEqual(
    ids(filterCurrentScheduleScope(sessions, programs, "computing", "cs")),
    ["a"],
  );
  assert.deepEqual(
    filterCurrentScheduleScope(sessions, programs, "arts", "cs"),
    [],
  );
});
test("unknown or empty department does not broaden to the entire college", () => {
  assert.deepEqual(
    filterCurrentScheduleScope(sessions, programs, "missing", "all"),
    [],
  );
  assert.deepEqual(
    filterCurrentScheduleScope(sessions, [], "computing", "all"),
    [],
  );
});
test("shared lecture presentation copies remain available to each selected program", () => {
  const shared = [
    { ...session("shared:cs", "cs"), study_system: "both" },
    { ...session("shared:it", "it"), study_system: "both" },
  ];
  assert.deepEqual(
    ids(filterCurrentScheduleScope(shared, programs, "computing", "all")),
    ["shared:cs", "shared:it"],
  );
  assert.deepEqual(
    ids(filterCurrentScheduleScope(shared, programs, "all", "it")),
    ["shared:it"],
  );
});
test("different study-plan pathways under one program are retained without mutations", () => {
  const rows = [
    { ...session("path-a", "cs"), intake_study_plan_id: "plan-a" },
    { ...session("path-b", "cs"), intake_study_plan_id: "plan-b" },
  ];
  const before = structuredClone(rows);
  assert.deepEqual(
    ids(filterCurrentScheduleScope(rows, programs, "all", "cs")),
    ["path-a", "path-b"],
  );
  assert.deepEqual(rows, before);
});

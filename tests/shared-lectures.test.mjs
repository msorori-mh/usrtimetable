import test from "node:test";
import assert from "node:assert/strict";
import { context, feasible, measure } from "../src/lib/auto-scheduler/compact.ts";
import {
  buildPartitionIndex,
  groupsShareStudents,
} from "../src/lib/auto-scheduler/student-partitions.ts";
import { session, snapshot, addCohort } from "./helpers/attendance-fixtures.mjs";

function sharedSnapshot(sessions) {
  const s = snapshot(sessions);
  s.partitions[0].headcount = 50;
  s.groups[0].expected_students = 75;
  s.rooms[0].capacity = 75;
  addCohort(s, "parallel", "lab-p", "p2", 25);
  s.cohorts[1].program_id = "p";
  s.cohorts[1].study_system = "parallel";
  s.members.push({ delivery_group_id: "g", partition_id: "p2", cohort_id: "parallel" });
  s.rooms.push({ ...s.rooms[0], id: "r2" });
  return s;
}
test("shared lecture counts 75 students, two attendance scopes and one teacher session", () => {
  const s = sharedSnapshot([
    session("shared", 0, "08:00", "10:00", { study_system: "both", expected_students: 75 }),
  ]);
  const m = measure(s);
  assert.equal(m.studentCount, 75);
  assert.equal(m.teachingMinutes, 120);
  assert.equal(m.instructorCount, 1);
  assert.equal(Object.keys(m.levelDays).length, 2);
});
test("parallel lab conflicts despite different cohort ids and rooms", () => {
  const a = session("shared", 0, "08:00", "10:00", { study_system: "both", expected_students: 75 });
  const b = session("lab", 0, "08:00", "10:00", {
    cohort_id: "parallel",
    delivery_group_id: "lab-p",
    room_id: "r2",
    expected_students: 25,
  });
  const s = sharedSnapshot([a, b]);
  assert.equal(context(s).share(a, b), true);
  assert.equal(feasible(s, [a, b], b, b), false);
});
test("adding a shared lecture cannot create a sixth attendance day for parallel students", () => {
  const labs = [0, 1, 2, 3, 4].map((day) =>
    session(`lab${day}`, day, "08:00", "09:00", {
      cohort_id: "parallel",
      delivery_group_id: "lab-p",
      room_id: "r2",
      expected_students: 25,
    }),
  );
  const a = session("shared", 6, "08:00", "10:00", { study_system: "both", expected_students: 75 });
  const s = sharedSnapshot([...labs, a]);
  assert.equal(feasible(s, labs, a, a), false);
});
test("only explicitly shared memberships permit multiple cohort ids", () => {
  const rows = [
    {
      delivery_group_id: "g",
      cohort_id: "a",
      partition_id: "a1",
      partition_headcount: 50,
      shared_lecture: true,
    },
    {
      delivery_group_id: "g",
      cohort_id: "b",
      partition_id: "b1",
      partition_headcount: 25,
      shared_lecture: true,
    },
    { delivery_group_id: "lab", cohort_id: "b", partition_id: "b1", partition_headcount: 25 },
  ];
  const index = buildPartitionIndex({ rows, expectedStudents: { g: 75, lab: 25 } });
  assert.equal(index.get("g").complete, true);
  assert.equal(groupsShareStudents("g", "lab", index).share, true);
  assert.equal(
    buildPartitionIndex({
      rows: rows.map((r) => ({ ...r, shared_lecture: false })),
      expectedStudents: { g: 75 },
    }).get("g").complete,
    false,
  );
});

test("missing parallel partition membership still blocks a shared lecture conflict", () => {
  const a = session("shared", 0, "08:00", "10:00", { study_system: "both", expected_students: 75 });
  const b = session("lab", 0, "08:00", "10:00", {
    cohort_id: "parallel",
    delivery_group_id: "lab-p",
    room_id: "r2",
    expected_students: 25,
  });
  const s = sharedSnapshot([a, b]);
  s.groups.push({
    id: "satellite",
    cohort_id: "parallel",
    expected_students: 25,
    active: false,
    is_obsolete: true,
  });
  s.sharedLectures = [{ anchor_group_id: "g", member_group_id: "satellite" }];
  s.members = s.members.filter((m) => !(m.delivery_group_id === "g" && m.cohort_id === "parallel"));
  assert.equal(context(s).share(a, b), true);
  assert.equal(feasible(s, [a, b], b, b), false);
});

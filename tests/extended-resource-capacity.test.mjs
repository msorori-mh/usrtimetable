import test from "node:test";
import assert from "node:assert/strict";
import { snapshot, session } from "./helpers/attendance-fixtures.mjs";
import { extendedResourceConflict } from "../src/lib/auto-scheduler/extended-resource-capacity.ts";
import {
  searchAttendance,
  attendanceSearchMessage,
} from "../src/lib/auto-scheduler/attendance-search.ts";
function example() {
  const sessions = Array.from({ length: 8 }, (_, i) =>
    session("s" + i, 0, "08:00:00", "10:00:00", {
      delivery_group_id: i < 4 ? "both" : i < 6 ? "g1" : "g2",
      teaching_assignment_id: i < 4 ? "a" : "b",
      expected_students: i < 4 ? 40 : 20,
    }),
  );
  const s = snapshot(sessions);
  s.groups = [
    { id: "both", cohort_id: "c", expected_students: 40 },
    { id: "g1", cohort_id: "c", expected_students: 20 },
    { id: "g2", cohort_id: "c", expected_students: 20 },
  ];
  s.partitions = ["p1", "p2"].map((id) => ({ id, cohort_id: "c", headcount: 20, active: true }));
  s.members = [
    { delivery_group_id: "both", partition_id: "p1", cohort_id: "c" },
    { delivery_group_id: "both", partition_id: "p2", cohort_id: "c" },
    { delivery_group_id: "g1", partition_id: "p1", cohort_id: "c" },
    { delivery_group_id: "g2", partition_id: "p2", cohort_id: "c" },
  ];
  s.rooms = [
    { id: "r", room_type: "lecture_hall", capacity: 60, is_active: true },
    { id: "lab", room_type: "computer_lab", capacity: 30, is_active: true },
  ];
  s.assignments.push({
    id: "b",
    required_room_type: "computer_lab",
    plan_course_component_id: "practical",
    is_active: true,
  });
  s.components = [{ id: "practical", component_type: "practical" }];
  Object.assign(s.settings, {
    working_days: [0],
    day_end_time: "16:00:00",
    standard_day_end_time: "14:00:00",
    extended_day_policy_enabled: true,
    max_extended_days_per_partition: 1,
    max_daily_hours_per_section: 8,
  });
  return s;
}
test("shared theory consumes two partitions and prevents borrowing both late slots", () => {
  const c = extendedResourceConflict(example());
  assert.ok(c);
  assert.equal(c.requiredHallLateSessions, 1);
  assert.equal(c.requiredTotalLateSessions, 2);
  assert.equal(c.maximumTotalLateSessions, 1);
  assert.equal(c.capacityGapMinutes, 120);
});
test("resource proof is independent of candidate-grid search budget", async () => {
  const r = await searchAttendance(example(), { maxDurationMs: 0 });
  assert.equal(r.status, "infeasible");
  assert.equal(r.scope, "resource_capacity_bound");
  assert.deepEqual(
    r.attempts.map((a) => a.days),
    [3, 4, 5],
  );
  assert.match(attendanceSearchMessage(r), /زيادة أيام الحضور/);
});
test("shorter sessions, incomplete memberships and disabled policy cannot produce this proof", () => {
  for (const change of [
    (s) => (s.sessions[0].end_time = "09:00:00"),
    (s) => (s.members = []),
    (s) => (s.settings.extended_day_policy_enabled = false),
    (s) => (s.settings.max_extended_days_per_partition = 2),
  ]) {
    const s = example();
    change(s);
    assert.equal(extendedResourceConflict(s), null);
  }
});
test("additional normal room capacity removes this particular obstruction", () => {
  const s = example();
  s.rooms.push({ ...s.rooms[0], id: "extra" });
  assert.equal(extendedResourceConflict(s), null);
});
test("minute offsets do not invalidate the resource bound", () => {
  const s = example();
  for (const x of s.sessions) {
    x.start_time = "08:30:00";
    x.end_time = "10:30:00";
  }
  assert.equal(extendedResourceConflict(s).capacityGapMinutes, 120);
});

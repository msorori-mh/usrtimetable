import test from "node:test";
import assert from "node:assert/strict";
import {
  context,
  feasible,
  extendedDays,
  studentWeeklyCapacity,
} from "../src/lib/auto-scheduler/compact.ts";
import { searchAttendance } from "../src/lib/auto-scheduler/attendance-search.ts";

function fixture() {
  const make = (id, group, day, start = "14:00:00", end = "16:00:00") => ({
    id,
    updated_at: "",
    cohort_id: "c",
    delivery_group_id: group,
    instructor_id: id,
    room_id: "r",
    teaching_assignment_id: "a",
    day_of_week: day,
    start_time: start,
    end_time: end,
    study_system: "regular",
    expected_students: group === "shared" ? 40 : 20,
    is_locked: false,
  });
  const sessions = [
    make("one", "g1", 0),
    make("two", "g2", 1),
    make("three", "g1", 2, "08:00:00", "10:00:00"),
  ];
  const s = {
    sessions,
    cohorts: [{ id: "c", program_id: "p", level_id: "l", study_system: "regular", term_id: "t" }],
    groups: ["g1", "g2", "shared"].map((id) => ({
      id,
      cohort_id: "c",
      expected_students: id === "shared" ? 40 : 20,
    })),
    partitions: ["p1", "p2"].map((id) => ({ id, cohort_id: "c", headcount: 20, active: true })),
    members: [
      { delivery_group_id: "g1", partition_id: "p1", cohort_id: "c" },
      { delivery_group_id: "g2", partition_id: "p2", cohort_id: "c" },
      ...["p1", "p2"].map((partition_id) => ({
        delivery_group_id: "shared",
        partition_id,
        cohort_id: "c",
      })),
    ],
    assignments: [{ id: "a", is_active: true, required_room_type: "lecture_hall" }],
    rooms: [{ id: "r", room_type: "lecture_hall", capacity: 60, is_active: true }],
    instructors: sessions.map((x) => ({
      id: x.id,
      instructor_type_id: null,
      max_hours_per_day: 8,
    })),
    types: [],
    availability: [],
    templates: [0, 1, 2, 3, 4, 6].map((day_of_week) => ({
      day_of_week,
      study_system: "regular",
      start_time: "08:00:00",
      end_time: "16:00:00",
      is_active: true,
    })),
    settings: {
      working_days: [0, 1, 2, 3, 4, 6],
      day_start_time: "08:00:00",
      day_end_time: "16:00:00",
      slot_minutes: 60,
      max_daily_hours_per_instructor: 8,
      max_daily_hours_per_section: 8,
      break_between_sessions_min: 0,
      extended_day_policy_enabled: true,
      standard_day_end_time: "14:00:00",
      max_extended_days_per_partition: 1,
    },
  };
  return { s, make };
}

test("parallel groups can use different extended days", () => {
  const { s } = fixture();
  assert.equal(context(s).share(s.sessions[0], s.sessions[1]), false);
  assert.equal(feasible(s, s.sessions, s.sessions[1], s.sessions[1]), true);
  assert.deepEqual([...extendedDays(s).get("p1")], [0]);
  assert.deepEqual([...extendedDays(s).get("p2")], [1]);
});
test("second extended day is rejected regardless of theory or practical label", () => {
  const { s } = fixture();
  const old = s.sessions[2];
  assert.equal(
    feasible(s, s.sessions, { ...old, start_time: "14:00:00", end_time: "16:00:00" }, old),
    false,
  );
  s.assignments[0].required_room_type = "computer_lab";
  s.rooms[0].room_type = "computer_lab";
  assert.equal(
    feasible(s, s.sessions, { ...old, start_time: "14:00:00", end_time: "16:00:00" }, old),
    false,
  );
});
test("shared lecture consumes both partitions and cannot borrow either group's second day", () => {
  const { s } = fixture();
  const old = s.sessions[2];
  assert.equal(
    feasible(
      s,
      s.sessions,
      {
        ...old,
        delivery_group_id: "shared",
        expected_students: 40,
        start_time: "14:00:00",
        end_time: "16:00:00",
      },
      old,
    ),
    false,
  );
});
test("ending exactly at 14:00 is normal; crossing it by a minute consumes an extended day", () => {
  const { s } = fixture();
  const x = s.sessions[2];
  assert.equal(extendedDays(s, [{ ...x, end_time: "14:00:00" }]).size, 0);
  assert.equal(extendedDays(s, [{ ...x, end_time: "14:01:00" }]).get("p1").size, 1);
});
test("moving the only extended lecture replaces its old day", () => {
  const { s } = fixture();
  const old = s.sessions[0];
  assert.equal(feasible(s, s.sessions, { ...old, day_of_week: 3 }, old), true);
});
test("disabled policy preserves other colleges' settings", () => {
  const { s } = fixture();
  s.settings.extended_day_policy_enabled = false;
  const old = s.sessions[2];
  assert.equal(
    feasible(s, s.sessions, { ...old, start_time: "14:00:00", end_time: "16:00:00" }, old),
    true,
  );
  assert.equal(studentWeeklyCapacity(s, 3), 24 * 60);
});
test("22 hours cannot fit three days with only one extension; four days have capacity 26 hours", () => {
  const { s } = fixture();
  assert.equal(studentWeeklyCapacity(s, 3), 20 * 60);
  assert.equal(studentWeeklyCapacity(s, 4), 26 * 60);
});
test("search certifies three-day capacity failure before returning a four-day witness", async () => {
  const { s, make } = fixture();
  s.sessions = Array.from({ length: 11 }, (_, i) =>
    make(String(i), "g1", i % 4, "08:00:00", "10:00:00"),
  );
  s.instructors = s.sessions.map((x) => ({
    id: x.id,
    instructor_type_id: null,
    max_hours_per_day: 8,
  }));
  const result = await searchAttendance(s, { maxDurationMs: 15000 });
  assert.equal(result.status, "feasible");
  assert.equal(result.days, 4);
  assert.equal(result.attempts[0].reason, "capacity");
  assert.equal(extendedDays(s, result.sessions).get("p1").size, 1);
  assert.equal(result.sessions.length, 11);
});

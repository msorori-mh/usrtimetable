import test from "node:test";
import assert from "node:assert/strict";
import {
  context,
  feasible,
  measure,
  studentWeeklyCapacity,
} from "../src/lib/auto-scheduler/compact.ts";
import { searchAttendance } from "../src/lib/auto-scheduler/attendance-search.ts";
import {
  extendedDayLimit,
  studentDailyPolicy,
  studentLoadKind,
} from "../src/lib/scheduling/student-daily-policy.ts";

const session = (id, extra) => ({
  id,
  updated_at: "",
  cohort_id: "c",
  delivery_group_id: "g",
  instructor_id: "i1",
  room_id: "hall",
  teaching_assignment_id: "th",
  day_of_week: 6,
  start_time: "08:00:00",
  end_time: "10:00:00",
  study_system: "regular",
  expected_students: 30,
  is_locked: false,
  ...extra,
});

function fixture(sessions, settings = {}) {
  return {
    sessions,
    cohorts: [{ id: "c", program_id: "p", level_id: "l", study_system: "regular", term_id: "t" }],
    groups: [{ id: "g", cohort_id: "c", expected_students: 30 }],
    partitions: [{ id: "p1", cohort_id: "c", headcount: 30, active: true }],
    members: [{ delivery_group_id: "g", partition_id: "p1", cohort_id: "c" }],
    assignments: [
      {
        id: "th",
        is_active: true,
        required_room_type: "lecture_hall",
        plan_course_component_id: "cth",
      },
      {
        id: "pr",
        is_active: true,
        required_room_type: "computer_lab",
        plan_course_component_id: "cpr",
      },
    ],
    components: [
      { id: "cth", component_type: "theory" },
      { id: "cpr", component_type: "practical" },
    ],
    rooms: [
      { id: "hall", room_type: "lecture_hall", capacity: 60, is_active: true },
      { id: "lab", room_type: "computer_lab", capacity: 60, is_active: true },
      { id: "hall2", room_type: "lecture_hall", capacity: 60, is_active: true },
    ],
    instructors: ["i1", "i2"].map((id) => ({
      id,
      instructor_type_id: null,
      // Production state for عصماء/ليلى/خالد/أسامه: no individual daily cap.
      max_hours_per_day: null,
    })),
    types: [],
    availability: [],
    roomAvailability: [],
    roomUnavailability: [],
    templates: [0, 1, 2, 3, 4, 6].map((day_of_week) => ({
      day_of_week,
      start_time: "08:00:00",
      end_time: "18:00:00",
      study_system: "regular",
      is_active: true,
    })),
    settings: {
      working_days: [0, 1, 2, 3, 4, 6],
      day_start_time: "08:00:00",
      day_end_time: "18:00:00",
      slot_minutes: 60,
      max_daily_hours_per_instructor: 8,
      max_daily_hours_per_section: 8,
      max_daily_theory_hours_per_section: 6,
      max_daily_practical_hours_per_section: 8,
      break_between_sessions_min: 0,
      ...settings,
    },
  };
}

/** Existing six hours on Saturday for partition p1 plus one 2h session parked on Sunday. */
function dayWith(kind) {
  const assignment = kind === "practical" ? "pr" : "th";
  const room = kind === "practical" ? "lab" : "hall";
  const existing = [
    session("a", {
      start_time: "08:00:00",
      end_time: "10:00:00",
      teaching_assignment_id: assignment,
      room_id: room,
    }),
    session("b", {
      start_time: "10:00:00",
      end_time: "12:00:00",
      teaching_assignment_id: assignment,
      room_id: room,
    }),
    session("c", {
      start_time: "12:00:00",
      end_time: "14:00:00",
      teaching_assignment_id: assignment,
      room_id: room,
    }),
  ];
  return existing;
}

const moving = (kind) =>
  session("m", {
    day_of_week: 0,
    start_time: "08:00:00",
    end_time: "10:00:00",
    instructor_id: "i2",
    teaching_assignment_id: kind === "practical" ? "pr" : "th",
    room_id: kind === "practical" ? "lab" : "hall2",
  });

const onSaturdayAt14 = (original) => ({
  ...original,
  day_of_week: 6,
  start_time: "14:00:00",
  end_time: "16:00:00",
});

test("policy resolves total/theory/practical from settings", () => {
  const p = studentDailyPolicy({
    max_daily_hours_per_section: 8,
    max_daily_theory_hours_per_section: 6,
    max_daily_practical_hours_per_section: 8,
  });
  assert.deepEqual(p, { totalMinutes: 480, theoryMinutes: 360, practicalMinutes: 480 });
  assert.equal(studentLoadKind("practical"), "practical");
  assert.equal(studentLoadKind("lab"), "practical");
  // Fail-closed: unknown/ambiguous counts against the theory cap.
  assert.equal(studentLoadKind(null), "theory");
  assert.equal(studentLoadKind("workshop"), "theory");
  assert.equal(extendedDayLimit({}), 2);
  assert.equal(extendedDayLimit({ max_extended_days_per_partition: 2 }), 2);
});

test("6h theory + 2h practical is feasible", () => {
  const original = moving("practical");
  const s = fixture([...dayWith("theory"), original]);
  assert.equal(feasible(s, s.sessions, onSaturdayAt14(original), original), true);
});

test("8h theory is rejected", () => {
  const original = moving("theory");
  const s = fixture([...dayWith("theory"), original]);
  assert.equal(feasible(s, s.sessions, onSaturdayAt14(original), original), false);
});

test("8h practical is feasible", () => {
  const original = moving("practical");
  const s = fixture([...dayWith("practical"), original]);
  assert.equal(feasible(s, s.sessions, onSaturdayAt14(original), original), true);
});

test("total student cap still blocks a ninth hour", () => {
  const original = moving("practical");
  const s = fixture([
    ...dayWith("practical"),
    session("d", {
      start_time: "14:00:00",
      end_time: "16:00:00",
      teaching_assignment_id: "pr",
      room_id: "lab",
    }),
    original,
  ]);
  const candidate = { ...original, day_of_week: 6, start_time: "16:00:00", end_time: "18:00:00" };
  assert.equal(feasible(s, s.sessions, candidate, original), false);
});

test("NULL max_hours_per_day falls back to the general 8h instructor cap", () => {
  // Same instructor already teaches 8h that day -> a ninth hour is refused.
  const original = moving("practical");
  const eight = dayWith("practical")
    .map((x) => ({ ...x, instructor_id: "i2" }))
    .concat(
      session("d", {
        instructor_id: "i2",
        start_time: "14:00:00",
        end_time: "16:00:00",
        teaching_assignment_id: "pr",
        room_id: "lab",
      }),
    );
  const s = fixture([...eight, original]);
  assert.equal(
    s.instructors.every((i) => i.max_hours_per_day === null),
    true,
  );
  const candidate = { ...original, day_of_week: 6, start_time: "16:00:00", end_time: "18:00:00" };
  assert.equal(feasible(s, s.sessions, candidate, original), false);
  // Eight hours themselves stay allowed under the general cap.
  const s8 = fixture([
    ...dayWith("practical").map((x) => ({ ...x, instructor_id: "i2" })),
    original,
  ]);
  assert.equal(feasible(s8, s8.sessions, onSaturdayAt14(original), original), true);
});

test("weekly student capacity uses the total daily cap, not a hidden 6", () => {
  const s = fixture(dayWith("practical"));
  assert.equal(studentWeeklyCapacity(s, 3), 24 * 60);
});

test("certified attendance search does not reject an 8h practical day", async () => {
  const s = fixture([
    ...dayWith("practical"),
    session("d", {
      start_time: "14:00:00",
      end_time: "16:00:00",
      teaching_assignment_id: "pr",
      room_id: "lab",
    }),
  ]);
  const result = await searchAttendance(s, { maxDurationMs: 3000, maxEvaluations: 20000 });
  assert.notEqual(result.status, "infeasible");
});

test("extended day allows two late days per partition and flags the third", () => {
  const late = (id, day) =>
    session(id, {
      day_of_week: day,
      start_time: "14:00:00",
      end_time: "16:00:00",
      teaching_assignment_id: "pr",
      room_id: "lab",
    });
  const settings = {
    extended_day_policy_enabled: true,
    standard_day_end_time: "14:00:00",
    max_extended_days_per_partition: 2,
  };
  const two = fixture([late("x", 6), late("y", 0)], settings);
  assert.equal(measure(two).extendedDayViolations, 0);
  const three = fixture([late("x", 6), late("y", 0), late("z", 1)], settings);
  assert.equal(measure(three).extendedDayViolations, 1);
});

test("a third extended day is refused by feasible while the second is allowed", () => {
  const original = session("m", {
    day_of_week: 6,
    start_time: "08:00:00",
    end_time: "10:00:00",
    instructor_id: "i2",
    teaching_assignment_id: "pr",
    room_id: "lab",
  });
  const late = (id, day) =>
    session(id, {
      day_of_week: day,
      start_time: "14:00:00",
      end_time: "16:00:00",
      teaching_assignment_id: "pr",
      room_id: "lab",
    });
  const settings = {
    extended_day_policy_enabled: true,
    standard_day_end_time: "14:00:00",
    max_extended_days_per_partition: 2,
  };
  const one = fixture([late("x", 0), original], settings);
  const second = { ...original, day_of_week: 1, start_time: "14:00:00", end_time: "16:00:00" };
  assert.equal(feasible(one, one.sessions, second, original), true);
  const two = fixture([late("x", 0), late("y", 1), original], settings);
  const third = { ...original, day_of_week: 2, start_time: "14:00:00", end_time: "16:00:00" };
  assert.equal(feasible(two, two.sessions, third, original), false);
});

test("shared lecture membership does not create a false incomplete partition mapping", () => {
  const s = fixture([]);
  // Two cohorts, one shared lecture group; operational expected_students is the
  // merged headcount (65 + 68), matching the merged direct membership.
  s.cohorts.push({
    id: "c2",
    program_id: "p2",
    level_id: "l",
    study_system: "regular",
    term_id: "t",
  });
  s.groups = [
    { id: "g", cohort_id: "c", expected_students: 65 },
    { id: "g2", cohort_id: "c2", expected_students: 68 },
    { id: "shared", cohort_id: "c", expected_students: 133 },
  ];
  s.partitions = [
    { id: "p1", cohort_id: "c", headcount: 65, active: true },
    { id: "p2", cohort_id: "c2", headcount: 68, active: true },
  ];
  s.members = [
    { delivery_group_id: "g", partition_id: "p1", cohort_id: "c" },
    { delivery_group_id: "g2", partition_id: "p2", cohort_id: "c2" },
    { delivery_group_id: "shared", partition_id: "p1", cohort_id: "c" },
    { delivery_group_id: "shared", partition_id: "p2", cohort_id: "c2" },
  ];
  s.sharedLectures = [{ anchor_group_id: "shared", member_group_id: "g2" }];
  const shared = session("s1", { delivery_group_id: "shared", expected_students: 133 });
  const students = context(s).students(shared);
  assert.deepEqual([...students].sort(), ["p1", "p2"]);
  assert.equal(
    students.some((key) => key.startsWith("cohort:")),
    false,
  );
});

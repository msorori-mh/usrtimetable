import test from "node:test";
import assert from "node:assert/strict";
import { planRepair } from "../src/lib/auto-scheduler/repair.ts";
import { feasible } from "../src/lib/auto-scheduler/compact.ts";

const lecture = (id, overrides = {}) => ({
  id,
  updated_at: "t0",
  cohort_id: "c",
  delivery_group_id: "g",
  instructor_id: "teacher",
  room_id: "lab",
  teaching_assignment_id: "lab-assignment",
  day_of_week: 1,
  start_time: "09:00:00",
  end_time: "11:00:00",
  study_system: "regular",
  expected_students: 20,
  is_locked: false,
  ...overrides,
});
const fixture = () => {
  const blocker = lecture("blocker", {
    room_id: "hall",
    teaching_assignment_id: "hall-assignment",
  });
  const missing = lecture("missing", {
    start_time: "00:00:00",
    end_time: "03:00:00",
  });
  const snapshot = {
    sessions: [blocker],
    cohorts: [
      {
        id: "c",
        program_id: "p",
        level_id: "l",
        study_system: "regular",
        term_id: "term",
      },
    ],
    groups: [{ id: "g", cohort_id: "c", expected_students: 20 }],
    members: [{ delivery_group_id: "g", cohort_id: "c", partition_id: "partition" }],
    partitions: [{ id: "partition", cohort_id: "c", headcount: 20, active: true }],
    assignments: [
      {
        id: "lab-assignment",
        required_room_type: "computer_lab",
        is_active: true,
      },
      {
        id: "hall-assignment",
        required_room_type: "lecture_hall",
        is_active: true,
      },
    ],
    rooms: [
      { id: "lab", capacity: 30, room_type: "computer_lab", is_active: true },
      { id: "hall", capacity: 60, room_type: "lecture_hall", is_active: true },
    ],
    instructors: [{ id: "teacher", max_hours_per_day: 6 }],
    types: [],
    availability: [],
    templates: [1, 2].map((day_of_week) => ({
      day_of_week,
      study_system: "regular",
      start_time: "09:00:00",
      end_time: "12:00:00",
      is_active: true,
    })),
    settings: {
      working_days: [1, 2],
      day_start_time: "09:00:00",
      day_end_time: "12:00:00",
      slot_minutes: 60,
      max_daily_hours_per_instructor: 6,
      max_daily_hours_per_section: 6,
      break_between_sessions_min: 0,
    },
  };
  return {
    snapshot,
    sessions: snapshot.sessions,
    missing,
    targetSlots: [{ day: 1, start: "09:00:00", end: "12:00:00" }],
    roomIds: ["lab"],
  };
};

test("moves a teacher hall lecture even when the missing lecture only permits a lab", () => {
  const input = fixture();
  const plan = planRepair(input);
  assert.ok(plan);
  assert.equal(plan.placement.room_id, "lab");
  assert.equal(plan.moves[0].to.room_id, "hall");
  assert.equal(plan.moves[0].to.day_of_week, 2);
  const blocker = input.sessions[0];
  const moved = { ...blocker, ...plan.moves[0].to };
  const missing = { ...input.missing, ...plan.placement };
  assert.ok(feasible(input.snapshot, input.sessions, moved, blocker));
  assert.ok(feasible(input.snapshot, [moved], missing, input.missing));
  assert.deepEqual(input.sessions, [blocker]);
});

test("does not move locked lectures or use an inactive compatible hall", () => {
  const locked = fixture();
  locked.sessions[0].is_locked = true;
  assert.equal(planRepair(locked), null);
  const inactive = fixture();
  inactive.snapshot.rooms[1].is_active = false;
  assert.equal(planRepair(inactive), null);
});

test("does not mistake the new candidate for pre-existing daily load", () => {
  const input = fixture();
  input.snapshot.settings.max_daily_hours_per_section = 2;
  assert.equal(planRepair(input), null);
});

test("never places the missing lecture outside its requested room pool", () => {
  const input = fixture();
  input.roomIds = [];
  assert.equal(planRepair(input), null);
});

test("never exceeds even the smallest search budgets", () => {
  for (const maxAttempts of [1, 2, 3, 4, 5, 10]) {
    const stats = { attempts: 0 };
    planRepair({ ...fixture(), budget: { maxAttempts, maxDepth: 2 }, stats });
    assert.ok(stats.attempts <= maxAttempts, `${stats.attempts} > ${maxAttempts}`);
  }
});

test("retains legal two-hop repairs after the shallow pass", () => {
  const input = fixture();
  const second = lecture("second", {
    day_of_week: 2,
    room_id: "hall",
    teaching_assignment_id: "hall-assignment",
  });
  input.sessions.push(second);
  input.snapshot.templates.push({
    ...input.snapshot.templates[1],
    day_of_week: 3,
  });
  input.snapshot.settings.working_days.push(3);
  const check = (s, xs, c, o) =>
    (c.id !== "blocker" || c.day_of_week === 2) && feasible(s, xs, c, o);
  const plan = planRepair({ ...input, feasible: check });
  assert.ok(plan);
  assert.equal(plan.depth, 2);
  assert.deepEqual(
    plan.moves.map((m) => m.sessionId),
    ["second", "blocker"],
  );
  let sessions = [...input.sessions];
  for (const move of plan.moves) {
    const old = sessions.find((s) => s.id === move.sessionId);
    const next = { ...old, ...move.to };
    assert.ok(check(input.snapshot, sessions, next, old));
    sessions = sessions.map((s) => (s.id === old.id ? next : s));
  }
  assert.ok(
    feasible(input.snapshot, sessions, { ...input.missing, ...plan.placement }, input.missing),
  );
});

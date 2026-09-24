import test from "node:test";
import assert from "node:assert/strict";
import { compact, measure, feasible, context, better } from "../src/lib/auto-scheduler/compact.ts";
const session = (id, day, start, end, extra = {}) => ({
  id,
  updated_at: "t0",
  cohort_id: "c",
  delivery_group_id: "g",
  instructor_id: id,
  room_id: "r",
  teaching_assignment_id: "a",
  day_of_week: day,
  start_time: start,
  end_time: end,
  study_system: "regular",
  expected_students: 30,
  is_locked: false,
  ...extra,
});
const snapshot = (sessions) => ({
  sessions,
  cohorts: [{ id: "c", program_id: "p", level_id: "l", study_system: "regular", term_id: "t" }],
  groups: [{ id: "g", cohort_id: "c", expected_students: 30 }],
  members: [{ delivery_group_id: "g", partition_id: "p1", cohort_id: "c" }],
  partitions: [{ id: "p1", cohort_id: "c", headcount: 30, active: true }],
  assignments: [{ id: "a", required_room_type: "lecture_hall", is_active: true }],
  rooms: [{ id: "r", capacity: 60, room_type: "lecture_hall", is_active: true }],
  instructors: sessions.map((s) => ({
    id: s.instructor_id,
    instructor_type_id: "permanent",
    max_hours_per_day: 6,
  })),
  types: [{ id: "permanent", code: "permanent", is_external: false }],
  availability: [],
  templates: [0, 1, 2, 3, 4, 6].map((day) => ({
    day_of_week: day,
    start_time: "08:00:00",
    end_time: "14:00:00",
    study_system: "regular",
    is_active: true,
  })),
  settings: {
    working_days: [0, 1, 2, 3, 4, 6],
    day_start_time: "08:00:00",
    day_end_time: "14:00:00",
    slot_minutes: 60,
    max_daily_hours_per_instructor: 6,
    max_daily_hours_per_section: 6,
    break_between_sessions_min: 0,
  },
});
test("packs a gap, preserves identities and hours, and every ordered move is feasible and improves", async () => {
  const s = snapshot([
    session("1", 0, "08:00:00", "10:00:00"),
    session("2", 0, "12:00:00", "14:00:00"),
  ]);
  const p = await compact(s);
  assert.ok(p.after.studentGapMinutes < p.before.studentGapMinutes);
  assert.equal(p.before.teachingMinutes, p.after.teachingMinutes);
  assert.equal(p.before.sessions, p.after.sessions);
  let xs = s.sessions;
  for (const move of p.moves) {
    const old = xs.find((x) => x.id === move.id),
      next = { ...old, ...move };
    assert.ok(feasible(s, xs, next, old));
    const trial = xs.map((x) => (x.id === old.id ? next : x));
    assert.ok(better(measure(s, trial), measure(s, xs)));
    xs = trial;
  }
});
test("rejects introducing a sixth day for the union of a level", () => {
  const xs = [0, 1, 2, 3, 4].flatMap((d) => [
    session(`${d}a`, d, "08:00:00", "10:00:00"),
    session(`${d}b`, d, "10:00:00", "12:00:00"),
  ]);
  const s = snapshot(xs);
  assert.equal(feasible(s, xs, { ...xs[0], day_of_week: 6 }, xs[0]), false);
});
test("repairs six days toward four without deleting sessions", async () => {
  const s = snapshot([0, 1, 2, 3, 4, 6].map((d) => session(`${d}`, d, "08:00:00", "10:00:00")));
  const p = await compact(s);
  assert.equal(p.after.levelsOverFive, 0);
  assert.equal(p.after.sessions, 6);
  assert.ok(p.after.excessDaysOverFour < p.before.excessDaysOverFour);
});
test("locked sessions stay untouched; missing availability no longer blocks placement", async () => {
  const s = snapshot([
    session("1", 0, "08:00:00", "10:00:00", { is_locked: true }),
    session("2", 0, "12:00:00", "14:00:00"),
  ]);
  s.instructors[1].instructor_type_id = "external";
  s.types.push({ id: "external", code: "from_other_college", is_external: true });
  // Availability enforcement is off: an external lecturer with no rows is available by default.
  const withoutRows = await compact(s);
  assert.ok(withoutRows.moves.every((m) => m.id !== "1"));
  assert.ok(withoutRows.moves.length > 0);
  s.availability = [
    {
      instructor_id: "2",
      day_of_week: 0,
      start_time: "08:00:00",
      end_time: "14:00:00",
      availability_type: "available",
      is_preference: false,
    },
  ];
  assert.ok((await compact(s)).moves.length > 0);
  s.availability.push({
    instructor_id: "2",
    day_of_week: 0,
    start_time: "10:00:00",
    end_time: "12:00:00",
    availability_type: "unavailable",
    is_preference: false,
  });
  assert.equal(
    feasible(
      s,
      s.sessions,
      { ...s.sessions[1], start_time: "10:00:00", end_time: "12:00:00" },
      s.sessions[1],
    ),
    true,
  );
  // Explicit instructor double-booking is still a hard conflict.
  const clash = [
    ...s.sessions,
    session("3", 0, "12:00:00", "14:00:00", { id: "3", instructor_id: "2", room_id: "r2" }),
  ];
  assert.equal(
    feasible(
      s,
      clash,
      { ...s.sessions[1], day_of_week: 0, start_time: "12:00:00", end_time: "14:00:00" },
      s.sessions[1],
    ),
    false,
  );
});
test("same students across theory/practical collide; independent partitions may run together", () => {
  const s = snapshot([
    session("1", 0, "08:00:00", "10:00:00"),
    session("2", 0, "10:00:00", "12:00:00", { delivery_group_id: "g2" }),
  ]);
  s.groups.push({ id: "g2", cohort_id: "c", expected_students: 30 });
  s.partitions.push({ id: "p2", cohort_id: "c", headcount: 30, active: true });
  s.members.push({ delivery_group_id: "g2", partition_id: "p2", cohort_id: "c" });
  assert.equal(context(s).share(s.sessions[0], s.sessions[1]), false);
  const shared = structuredClone(s);
  shared.members[1].partition_id = "p1";
  assert.equal(context(shared).share(shared.sessions[0], shared.sessions[1]), true);
  const incomplete = structuredClone(s);
  incomplete.members.pop();
  assert.equal(context(incomplete).share(incomplete.sessions[0], incomplete.sessions[1]), true);
});
test("room type/capacity and daily student load remain constraints", () => {
  const xs = [
      session("1", 0, "08:00:00", "10:00:00"),
      session("2", 0, "10:00:00", "12:00:00"),
      session("3", 0, "12:00:00", "14:00:00"),
      session("4", 1, "08:00:00", "10:00:00"),
    ],
    s = snapshot(xs);
  s.templates[0].end_time = "18:00:00";
  s.settings.day_end_time = "18:00:00";
  assert.equal(
    feasible(
      s,
      xs,
      { ...xs[3], day_of_week: 0, start_time: "14:00:00", end_time: "16:00:00" },
      xs[3],
    ),
    false,
  );
  s.rooms[0].capacity = 20;
  assert.equal(feasible(s, xs, { ...xs[3], day_of_week: 2 }, xs[3]), false);
});
test("cancelled preview does not mutate input", async () => {
  const s = snapshot([session("1", 0, "08:00:00", "10:00:00")]);
  const saved = JSON.stringify(s),
    controller = new AbortController();
  controller.abort();
  const p = await compact(s, { signal: controller.signal });
  assert.equal(p.stopped, true);
  assert.equal(JSON.stringify(s), saved);
});
test("two-step relocation closes a sixth day when a safe preparatory move is needed", async () => {
  const xs = [0, 1, 3, 4, 6].map((d) =>
    session(`c${d}`, d, "08:00:00", "10:00:00", { is_locked: true }),
  );
  xs.push(
    session("target", 2, "08:00:00", "10:00:00", { instructor_id: "X" }),
    session("blocker", 3, "10:00:00", "12:00:00", {
      instructor_id: "X",
      cohort_id: "q",
      delivery_group_id: "gq",
    }),
    session("q-fixed", 3, "08:00:00", "10:00:00", {
      cohort_id: "q",
      delivery_group_id: "gq",
      room_id: "r2",
      is_locked: true,
    }),
  );
  const s = snapshot(xs);
  s.cohorts.push({
    id: "q",
    program_id: "pq",
    level_id: "l",
    study_system: "regular",
    term_id: "t",
  });
  s.groups.push({ id: "gq", cohort_id: "q", expected_students: 30 });
  s.partitions.push({ id: "q1", cohort_id: "q", headcount: 30, active: true });
  s.members.push({ delivery_group_id: "gq", cohort_id: "q", partition_id: "q1" });
  s.rooms.push({ ...s.rooms[0], id: "r2" });
  for (const t of s.instructors) if (t.id === "X") t.instructor_type_id = "external";
  s.types.push({ id: "external", code: "from_other_college", is_external: true });
  s.availability = [
    {
      instructor_id: "X",
      day_of_week: 2,
      start_time: "08:00:00",
      end_time: "12:00:00",
      availability_type: "available",
      is_preference: false,
    },
    {
      instructor_id: "X",
      day_of_week: 3,
      start_time: "10:00:00",
      end_time: "12:00:00",
      availability_type: "available",
      is_preference: false,
    },
  ];
  const p = await compact(s);
  assert.equal(p.before.levelsOverFive, 1);
  assert.equal(p.after.levelsOverFive, 0);
  assert.ok(p.moves.length >= 1);
  let current = s.sessions;
  for (const v of p.moves) {
    let old = current.find((x) => x.id === v.id);
    assert.ok(feasible(s, current, { ...old, ...v }, old));
    current = current.map((x) => (x.id === v.id ? { ...x, ...v } : x));
  }
  assert.equal(measure(s, current).teachingMinutes, p.before.teachingMinutes);
});

test("college availability flag overrides legacy default and respects hard windows", () => {
  const old = session("fathi", 4, "08:00:00", "11:00:00");
  const s = snapshot([old]);
  s.settings.enforce_instructor_availability = true;
  s.availability = [1, 3].map((day) => ({
    instructor_id: "fathi",
    day_of_week: day,
    start_time: "08:00:00",
    end_time: "14:00:00",
    availability_type: "available",
    is_preference: false,
  }));
  s.availability.push({
    instructor_id: "fathi",
    day_of_week: 4,
    start_time: "08:00:00",
    end_time: "14:00:00",
    availability_type: "unavailable",
    is_preference: false,
  });
  assert.equal(feasible(s, [], old, old), false);
  for (const day of [1, 3]) assert.equal(feasible(s, [], { ...old, day_of_week: day }, old), true);
  s.settings.enforce_instructor_availability = false;
  assert.equal(feasible(s, [], old, old), true);
  s.settings.enforce_instructor_availability = true;
  s.instructors[0].instructor_type_id = "external";
  s.types.push({ id: "external", is_external: true });
  assert.equal(feasible(s, [], { ...old, day_of_week: 0 }, old), false);
  s.availability = [
    {
      instructor_id: "fathi",
      day_of_week: 4,
      start_time: "12:00:00",
      end_time: "14:00:00",
      availability_type: "unavailable",
      is_preference: false,
    },
  ];
  assert.equal(feasible(s, [], old, old), false);
});

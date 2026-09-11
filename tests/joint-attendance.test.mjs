import test from "node:test";
import assert from "node:assert/strict";
import {
  measureAttendance,
  compareAttendance,
} from "../src/lib/auto-scheduler/attendance-objective.ts";
import {
  compact,
  compactSlots,
  measure,
  feasible,
  better,
} from "../src/lib/auto-scheduler/compact.ts";
import {
  rankGenerationCandidates,
  compareDifficulty,
} from "../src/lib/auto-scheduler/generation-ranking.ts";
import { assessScheduleReadiness } from "../src/lib/auto-scheduler/schedule-readiness.ts";
import { session, snapshot, addCohort } from "./helpers/attendance-fixtures.mjs";

test("counts every idle minute with no invented rest and counts overlapping memberships once", () => {
  const events = [
    { day: 0, start: 480, end: 600, students: ["p", "p"], instructor: "T", level: "L" },
    { day: 0, start: 630, end: 750, students: ["p"], instructor: "T", level: "L" },
  ];
  const metrics = measureAttendance(events, () => 40);
  assert.equal(metrics.studentCount, 40);
  assert.equal(metrics.studentGapMinutes, 1200);
  assert.equal(metrics.studentAverageGapMinutes, 30);
  assert.equal(metrics.instructorAverageGapMinutes, 30);
  assert.equal(metrics.balancedGapMinutes, 30);
  events[1].start = 600;
  assert.equal(measureAttendance(events, () => 40).balancedGapMinutes, 0);
});

test("normalization prevents a large cohort from erasing the instructor objective", () => {
  const score = (studentGap, teacherGap) =>
    measureAttendance(
      [
        { day: 0, start: 480, end: 540, students: ["S"], instructor: "A", level: "L" },
        {
          day: 0,
          start: 540 + studentGap,
          end: 600 + studentGap,
          students: ["S"],
          instructor: "B",
          level: "L",
        },
        { day: 1, start: 480, end: 540, students: ["Q1"], instructor: "T", level: "Q" },
        {
          day: 1,
          start: 540 + teacherGap,
          end: 600 + teacherGap,
          students: ["Q2"],
          instructor: "T",
          level: "Q",
        },
      ],
      (id) => (id === "S" ? 1000 : 1),
    );
  assert.ok(compareAttendance(score(20, 0), score(0, 180)) < 0);
});

test("sixth-day violation dominates any apparent gap reduction", () => {
  const events = [0, 1, 2, 3, 4, 6].map((day) => ({
    day,
    start: 480,
    end: 540,
    students: ["S"],
    instructor: "T",
    level: "L",
  }));
  const six = measureAttendance(events, () => 30),
    five = measureAttendance(events.slice(0, 5), () => 30);
  assert.ok(compareAttendance(five, six) < 0);
});

test("compaction rejects improving instructor gaps at the expense of student attendance", () => {
  const baseline = measureAttendance(
    [
      { day: 0, start: 480, end: 540, students: ["S"], instructor: "T", level: "L" },
      { day: 0, start: 660, end: 720, students: ["S"], instructor: "T", level: "L" },
    ],
    () => 30,
  );
  const harm = {
    ...baseline,
    instructorGapMinutes: 0,
    instructorAverageGapMinutes: 0,
    balancedGapMinutes: 60,
    studentAttendanceDays: baseline.studentAttendanceDays + 30,
  };
  assert.equal(better(harm, baseline), false);
  assert.equal(
    better({ ...harm, studentAttendanceDays: baseline.studentAttendanceDays }, baseline),
    true,
  );
});

test("bounded two-step search also closes a fifth day", async () => {
  const xs = [0, 1, 3, 4].map((d) =>
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
  addCohort(s, "q", "gq", "q1");
  s.rooms.push({ ...s.rooms[0], id: "r2" });
  s.instructors.find((t) => t.id === "X").instructor_type_id = "external";
  s.types.push({ id: "external", code: "from_other_college", is_external: true });
  s.availability = [
    {
      instructor_id: "X",
      day_of_week: 2,
      start_time: "08:00:00",
      end_time: "12:00:00",
      availability_type: "available",
    },
    {
      instructor_id: "X",
      day_of_week: 3,
      start_time: "10:00:00",
      end_time: "12:00:00",
      availability_type: "available",
    },
  ];
  const p = await compact(s);
  assert.equal(p.before.levelsOverFive, 0);
  assert.equal(p.before.excessDaysOverFour, 1);
  assert.equal(p.after.excessDaysOverFour, 0);
  assert.ok(p.moves.length >= 1);
  let current = s.sessions;
  for (const move of p.moves) {
    const old = current.find((x) => x.id === move.id);
    assert.ok(feasible(s, current, { ...old, ...move }, old));
    current = current.map((x) => (x.id === move.id ? { ...x, ...move } : x));
  }
  assert.equal(measure(s, current).teachingMinutes, p.before.teachingMinutes);
});

test("time limit and empty input have honest, distinct outcomes without mutation", async () => {
  const s = snapshot([session("1", 0, "08:00:00", "10:00:00")]),
    copy = structuredClone(s);
  const limited = await compact(s, { maxDurationMs: 0 });
  assert.equal(limited.outcome, "time_limit");
  assert.equal(limited.moves.length, 0);
  assert.deepEqual(s, copy);
  assert.equal((await compact(snapshot([]))).outcome, "empty");
});

test("availability rows do not block while enforcement is off; preferences never block", () => {
  const s = snapshot([session("1", 0, "08:00:00", "10:00:00")]);
  s.availability = [
    {
      instructor_id: "1",
      day_of_week: 0,
      start_time: "12:00:00",
      end_time: "14:00:00",
      availability_type: "unavailable",
    },
    {
      instructor_id: "1",
      day_of_week: 0,
      start_time: "10:00:00",
      end_time: "12:00:00",
      availability_type: "unavailable",
      is_preference: true,
    },
  ];
  assert.equal(
    feasible(
      s,
      s.sessions,
      { ...s.sessions[0], start_time: "10:00:00", end_time: "12:00:00" },
      s.sessions[0],
    ),
    true,
  );
  // Availability enforcement is off: hard "unavailable" rows are ignored too.
  assert.equal(
    feasible(
      s,
      s.sessions,
      { ...s.sessions[0], start_time: "12:00:00", end_time: "14:00:00" },
      s.sessions[0],
    ),
    true,
  );
});

test("room whitelist and recurring closure filter out unusable candidates", () => {
  const s = snapshot([session("1", 0, "08:00:00", "10:00:00")]),
    old = s.sessions[0];
  s.roomAvailability = [
    { room_id: "r", day_of_week: 0, start_time: "10:00:00", end_time: "14:00:00" },
  ];
  assert.equal(feasible(s, s.sessions, old, old), false);
  s.roomUnavailability = [
    {
      room_id: "r",
      day_of_week: 0,
      start_time: "12:00:00",
      end_time: "14:00:00",
      start_date: null,
      end_date: null,
    },
  ];
  assert.equal(
    feasible(s, s.sessions, { ...old, start_time: "10:00:00", end_time: "12:00:00" }, old),
    true,
  );
  assert.equal(
    feasible(s, s.sessions, { ...old, start_time: "12:00:00", end_time: "14:00:00" }, old),
    false,
  );
});

test("adjacency anchors include a half-hour boundary on an hourly search grid", () => {
  const s = snapshot([session("1", 0, "08:00:00", "09:30:00")]);
  const slots = compactSlots(s, session("new", 0, "10:00:00", "12:00:00"));
  assert.ok(
    slots.some((slot) => slot.day === 0 && slot.start === "09:30:00" && slot.end === "11:30:00"),
  );
});

test("generation chooses a contiguous instructor slot across programs and excludes collisions", () => {
  const s = snapshot([session("1", 0, "08:00:00", "10:00:00", { instructor_id: "T" })]);
  addCohort(s, "q", "gq", "q1");
  const next = session("new", 0, "00:00:00", "02:00:00", {
    cohort_id: "q",
    delivery_group_id: "gq",
    instructor_id: "T",
  });
  const ranked = rankGenerationCandidates({
    snapshot: s,
    sessions: s.sessions,
    session: next,
    roomIds: ["r"],
    slots: [
      { day: 0, start: "08:00:00", end: "10:00:00" },
      { day: 0, start: "12:00:00", end: "14:00:00" },
      { day: 0, start: "10:00:00", end: "12:00:00" },
    ],
  });
  assert.equal(ranked[0].session.start_time, "10:00:00");
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].metrics.instructorGapMinutes, 0);
  assert.ok(
    compareDifficulty(
      { candidateCount: 1, durationMinutes: 120, expectedStudents: 30, id: "a" },
      { candidateCount: 10, durationMinutes: 180, expectedStudents: 100, id: "b" },
    ) < 0,
  );
});

test("readiness checks cadence of already-scheduled work and never accepts an empty schedule", () => {
  const base = {
    assignments: [{ id: "a", groupId: "g", requiredDurations: [2, 2], blocked: false }],
    sessions: [
      {
        id: "s",
        teaching_assignment_id: "a",
        delivery_group_id: "g",
        day_of_week: 0,
        start_time: "08:00:00",
        end_time: "12:00:00",
      },
    ],
    levelsOverFive: 0,
    hardConflicts: 0,
    softConflicts: 0,
    cancelled: false,
  };
  const mismatched = assessScheduleReadiness(base);
  assert.equal(mismatched.complete, false);
  assert.equal(mismatched.nonconformingSessions, 1);
  assert.equal(mismatched.requiredMinutes, 240);
  assert.equal(assessScheduleReadiness({ ...base, assignments: [], sessions: [] }).complete, false);
  const full = {
    ...base,
    sessions: [
      { ...base.sessions[0], end_time: "10:00:00" },
      { ...base.sessions[0], id: "s2", day_of_week: 2, end_time: "10:00:00" },
    ],
  };
  assert.equal(assessScheduleReadiness(full).complete, true);
  for (const change of [
    { cancelled: true },
    { hardConflicts: 1 },
    { softConflicts: 1 },
    { levelsOverFive: 1 },
  ])
    assert.equal(assessScheduleReadiness({ ...full, ...change }).complete, false);
});

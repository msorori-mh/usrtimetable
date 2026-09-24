import test from "node:test";
import assert from "node:assert/strict";
import loadHighs from "highs";
import { buildJointModel, validateJointPlan } from "../src/lib/auto-scheduler/joint-model.ts";
import { searchJointAttendance } from "../src/lib/auto-scheduler/joint-search.ts";
import { snapshot, session } from "./helpers/attendance-fixtures.mjs";
import { cohortCourseDayMismatch } from "../src/lib/auto-scheduler/cohort-course-days.ts";
import { measure, better } from "../src/lib/auto-scheduler/compact.ts";
import {
  qualityBetter,
  qualityRepairNonWorsening,
} from "../src/lib/auto-scheduler/quality-search.ts";

const highs = await loadHighs();

function parallelGroups() {
  const s = snapshot([
    session("one", 0, "08:00:00", "10:00:00"),
    session("two", 1, "08:00:00", "10:00:00", { delivery_group_id: "g2" }),
  ]);
  s.assignments[0].plan_course_component_id = "component";
  s.groups.push({ id: "g2", cohort_id: "c", expected_students: 30 });
  s.partitions.push({ id: "p2", cohort_id: "c", headcount: 30, active: true });
  s.members.push({ delivery_group_id: "g2", partition_id: "p2", cohort_id: "c" });
  return s;
}

test("peer-day measurement uses distinct groups of the same cohort and component", () => {
  const s = parallelGroups();
  assert.equal(cohortCourseDayMismatch(s), 2);
  s.sessions[1].day_of_week = 0;
  assert.equal(cohortCourseDayMismatch(s), 0);
  // Multi-meeting courses may align across several days.
  s.sessions.push({ ...s.sessions[0], id: "third", day_of_week: 1 });
  assert.equal(cohortCourseDayMismatch(s), 1);
  s.sessions.push({ ...s.sessions[1], id: "fourth", day_of_week: 1 });
  assert.equal(cohortCourseDayMismatch(s), 0);
  const split = parallelGroups();
  split.groups[1].cohort_id = split.sessions[1].cohort_id = "other-cohort";
  assert.equal(cohortCourseDayMismatch(split), 0);
  const other = parallelGroups();
  other.assignments.push({ ...other.assignments[0], id: "other", plan_course_component_id: "lab" });
  other.sessions[1].teaching_assignment_id = "other";
  assert.equal(cohortCourseDayMismatch(other), 0);
  delete s.assignments[0].plan_course_component_id;
  assert.equal(cohortCourseDayMismatch(s), 0, "unknown identities are never guessed");
});

test("peer preference works in generation and compaction and respects incompatible locked days", () => {
  for (const locked of [false, true]) {
    for (const generation of [false, true]) {
      const s = parallelGroups();
      s.sessions.forEach((row) => {
        row.is_locked = locked;
      });
      const built = buildJointModel(s, 3);
      const model = highs.createModel(
        generation ? { ...built.model, colCost: built.generationCost } : built.model,
      );
      try {
        model.options.set({ output_flag: false, time_limit: 10, mip_rel_gap: 0, mip_abs_gap: 0 });
        model.run();
        assert.equal(model.info.get("primal_solution_status"), 2);
        const final = built.decode(model.getSolution().colValue);
        assert.equal(validateJointPlan(s, final, 3), true);
        assert.equal(cohortCourseDayMismatch(s, final), locked ? 2 : 0);
        assert.equal(final.length, 2, "group sessions are never merged");
      } finally {
        model.dispose();
      }
    }
  }
});

test("day alignment ranks last and cannot block repair of a hard conflict", () => {
  const base = { ...measure(parallelGroups()), cohortCourseDayMismatch: 2 };
  const aligned = { ...base, cohortCourseDayMismatch: 0 };
  for (const compare of [better, qualityBetter]) {
    assert.equal(compare(aligned, base), true);
    for (const key of [
      "studentGapMinutes",
      "shortStudentDays",
      "instructorAttendanceDays",
      "instructorSingleLectureDays",
      "instructorTargetDayDeviation",
      "instructorGapMinutes",
    ]) {
      assert.equal(compare({ ...aligned, [key]: base[key] + 1 }, base), false, key);
    }
  }
  assert.equal(qualityRepairNonWorsening(base, aligned), true);
});

test("a common instructor keeps separate non-overlapping group sessions", () => {
  const s = parallelGroups();
  s.sessions[1].instructor_id = s.sessions[0].instructor_id;
  const built = buildJointModel(s, 3);
  const model = highs.createModel(built.model);
  try {
    model.options.set({ output_flag: false, time_limit: 10, mip_rel_gap: 0 });
    model.run();
    const final = built.decode(model.getSolution().colValue);
    assert.equal(cohortCourseDayMismatch(s, final), 0);
    assert.equal(validateJointPlan(s, final, 3), true);
    assert.notEqual(final[0].start_time, final[1].start_time);
  } finally {
    model.dispose();
  }
});

test("incompatible instructor availability remains feasible with a soft day mismatch", () => {
  const s = parallelGroups();
  s.settings.enforce_instructor_availability = true;
  s.availability = s.sessions.flatMap((session) =>
    s.settings.working_days.map((day) => ({
      instructor_id: session.instructor_id,
      day_of_week: day,
      start_time: "08:00:00",
      end_time: "14:00:00",
      availability_type: day === session.day_of_week ? "available" : "unavailable",
      is_preference: false,
    })),
  );
  const built = buildJointModel(s, 3);
  const model = highs.createModel(built.model);
  try {
    model.options.set({ output_flag: false, time_limit: 10 });
    model.run();
    assert.equal(model.info.get("primal_solution_status"), 2);
    const final = built.decode(model.getSolution().colValue);
    assert.equal(validateJointPlan(s, final, 3), true);
    assert.equal(cohortCourseDayMismatch(s, final), 2);
  } finally {
    model.dispose();
  }
});
test("generation retains attendance costs while compaction also prices idle time", async () => {
  const s = snapshot([session("one", 0, "08:00:00", "10:00:00")]);
  const costs = [];
  const observed = {
    constants: highs.constants,
    createModel(model) {
      costs.push([...model.colCost]);
      return highs.createModel(model);
    },
  };
  for (const purpose of ["generation", "compaction"]) {
    const result = await searchJointAttendance(s, observed, 10000, purpose);
    assert.equal(result.attendanceSearch.status, "feasible");
    assert.equal(validateJointPlan(s, result.attendanceSearch.sessions, 3), true);
  }
  assert.ok(costs[0].some((cost) => cost > 0));
  assert.ok(costs[0].every((cost) => cost >= 0));
  assert.ok(costs[1].some((cost) => cost !== 0));
});
test("joint model admits a simultaneous swap with no temporary room", () => {
  const s = snapshot([
    session("one", 0, "08:00:00", "10:00:00"),
    session("two", 0, "10:00:00", "12:00:00"),
  ]);
  const final = [
    { ...s.sessions[0], start_time: "10:00:00", end_time: "12:00:00" },
    { ...s.sessions[1], start_time: "08:00:00", end_time: "10:00:00" },
  ];
  assert.equal(validateJointPlan(s, final, 3), true);
  const b = buildJointModel(s, 3),
    m = highs.createModel(b.model);
  try {
    m.options.set({ output_flag: false, time_limit: 5 });
    m.run();
    assert.equal(m.info.get("primal_solution_status"), 2);
    assert.equal(validateJointPlan(s, b.decode(m.getSolution().colValue), 3), true);
  } finally {
    m.dispose();
  }
});
test("final validation rejects overlaps, changed hours, duplicates and daily overload", () => {
  const s = snapshot([
    session("one", 0, "08:00:00", "10:00:00"),
    session("two", 0, "10:00:00", "12:00:00"),
  ]);
  assert.equal(
    validateJointPlan(
      s,
      [s.sessions[0], { ...s.sessions[1], start_time: "09:00:00", end_time: "11:00:00" }],
      3,
    ),
    false,
  );
  assert.equal(
    validateJointPlan(s, [s.sessions[0], { ...s.sessions[1], end_time: "13:00:00" }], 3),
    false,
  );
  assert.equal(validateJointPlan(s, [s.sessions[0], s.sessions[0]], 3), false);
  s.settings.max_daily_hours_per_section = 3;
  assert.equal(validateJointPlan(s, s.sessions, 3), false);
});
test("timeout never becomes permission for a fourth or fifth day", async () => {
  const s = snapshot([session("one", 0, "08:00:00", "10:00:00")]);
  const p = await searchJointAttendance(s, highs, 0);
  assert.equal(p.attendanceSearch.status, "unknown");
  assert.deepEqual(
    p.attendanceSearch.attempts.map((a) => a.days),
    [3],
  );
  assert.equal(p.moves.length, 0);
});
test("incomplete membership cannot certify impossibility", async () => {
  const s = snapshot([session("one", 0, "08:00:00", "10:00:00")]);
  s.members = [];
  const p = await searchJointAttendance(s, highs, 1000);
  assert.equal(p.attendanceSearch.attempts[0].reason, "invalid_input");
  assert.equal(p.attendanceSearch.status, "unknown");
});

test("import independently checks staleness, final constraints and lower-day proof", async () => {
  const { importJointPlan } = await import("../src/lib/auto-scheduler/joint-import.ts");
  const s = snapshot([session("one", 0, "08:00:00", "10:00:00")]);
  s.revision = "1";
  s.versionUpdatedAt = "v1";
  const raw = {
    versionId: "v",
    revision: "1",
    versionUpdatedAt: "v1",
    days: 3,
    moves: s.sessions.map((x) => ({ ...x, expected_updated_at: x.updated_at })),
  };
  assert.equal(importJointPlan(s, "v", JSON.stringify(raw)).attendanceSearch.status, "feasible");
  assert.throws(() => importJointPlan(s, "v", JSON.stringify({ ...raw, revision: "2" })), /تغير/);
  assert.throws(() => importJointPlan(s, "v", JSON.stringify({ ...raw, days: 4 })), /إثبات/);
  assert.throws(
    () =>
      importJointPlan(
        s,
        "v",
        JSON.stringify({
          ...raw,
          moves: [{ ...raw.moves[0], end_time: "11:00:00" }],
        }),
      ),
    /قيود/,
  );
});

test("generation solves a four-day plan with hard caps and retains fixed sessions", async () => {
  const s = snapshot(
    Array.from({ length: 8 }, (_, i) =>
      session("pending-" + i, 0, "08:00:00", "10:00:00", {
        updated_at: "",
        is_locked: i === 0,
      }),
    ),
  );
  s.settings.max_daily_hours_per_section = 4;
  const p = await searchJointAttendance(s, highs, 10000, "generation");
  assert.equal(p.attendanceSearch.status, "feasible");
  assert.equal(p.attendanceSearch.days, 4);
  assert.deepEqual(
    p.attendanceSearch.attempts.map((a) => [a.days, a.status]),
    [
      [3, "infeasible"],
      [4, "feasible"],
    ],
  );
  assert.equal(validateJointPlan(s, p.attendanceSearch.sessions, 4), true);
  assert.deepEqual(
    p.attendanceSearch.sessions.find((x) => x.id === "pending-0"),
    s.sessions[0],
  );
});

test("generation uses saved availability rather than the legacy disabled default", async () => {
  const s = snapshot([session("fathi", 4, "08:00:00", "11:00:00")]);
  s.settings.enforce_instructor_availability = true;
  s.availability = s.settings.working_days.map((day) => ({
    instructor_id: s.sessions[0].instructor_id,
    day_of_week: day,
    start_time: "08:00:00",
    end_time: "14:00:00",
    availability_type: [1, 3].includes(day) ? "available" : "unavailable",
    is_preference: false,
  }));
  const result = await searchJointAttendance(s, highs, 10000, "generation");
  assert.equal(result.attendanceSearch.status, "feasible");
  assert.ok([1, 3].includes(result.attendanceSearch.sessions[0].day_of_week));
  assert.equal(validateJointPlan(s, [{ ...s.sessions[0], day_of_week: 4 }], 3), false);
});

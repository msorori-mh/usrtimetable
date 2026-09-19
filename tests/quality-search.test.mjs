import test from "node:test";
import assert from "node:assert/strict";
import loadHighs from "highs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { buildJointModel } from "../src/lib/auto-scheduler/joint-model.ts";
import { context } from "../src/lib/auto-scheduler/compact.ts";
import { snapshot, session, addCohort } from "./helpers/attendance-fixtures.mjs";
import {
  improveDistribution,
  qualityBetter,
  qualityPlanValid,
  qualitySearchMessage,
} from "../src/lib/auto-scheduler/quality-search.ts";
const highs = await loadHighs();

test("neighborhood model itself enforces each person's existing attendance-day ceiling", () => {
  for (const kind of ["instructorDays", "studentDays", "levelDays"]) {
    const s = snapshot(
      [0, 1].map((day, i) =>
        session(`fixed${i}`, day, "08:00:00", "10:00:00", { is_locked: true, instructor_id: "t" }),
      ),
    );
    const level = context(s).level(s.sessions[0]);
    s.qualityScope = {
      instructorDays: { t: 2 },
      studentDays: { p1: 2 },
      levelDays: { [level]: 2 },
    };
    s.qualityScope[kind][kind === "instructorDays" ? "t" : kind === "studentDays" ? "p1" : level] =
      1;
    const built = buildJointModel(s, 4);
    const model = highs.createModel(built.model);
    try {
      model.options.set({ output_flag: false, time_limit: 1 });
      model.run();
      assert.equal(model.getModelStatus(), highs.constants.modelStatus.infeasible, kind);
    } finally {
      model.dispose();
    }
  }
});
const run = (s) => improveDistribution(s, highs, { maxDurationMs: 1500 });
const final = (s, p) => s.sessions.map((x) => ({ ...x, ...p.moves.find((m) => m.id === x.id) }));

test("quality ranking prefers removing a one-lecture instructor day before instructor-gap polish", () => {
  const base = {
    studentGapMinutes: 0,
    worstStudentGapMinutes: 0,
    studentAttendanceDays: 3,
    shortStudentDays: 0,
    instructorGapMinutes: 0,
    worstInstructorGapMinutes: 0,
    instructorAttendanceDays: 3,
    instructorTargetDayDeviation: 0,
    instructorExcessTargetDays: 1,
    instructorSingleLectureDays: 2,
    practicalHallSessions: 0,
    excessDaysOverThree: 0,
    extendedDayViolations: 0,
  };
  const consolidated = {
    ...base,
    instructorGapMinutes: 60,
    worstInstructorGapMinutes: 60,
    instructorAttendanceDays: 2,
    instructorExcessTargetDays: 0,
    instructorSingleLectureDays: 0,
  };
  assert.equal(qualityBetter(consolidated, base), true);
  assert.equal(
    qualityBetter({ ...consolidated, studentGapMinutes: 1 }, base),
    false,
    "student-side quality remains protected",
  );
});

test("three two-hour lectures on separate days consolidate to one day", async () => {
  const s = snapshot(
    [0, 1, 2].map((d, i) =>
      session("s" + i, d, "08:00:00", "10:00:00", { instructor_id: "teacher" }),
    ),
  );
  const p = await run(s);
  assert.ok(p.moves.length);
  assert.equal(p.after.instructorAttendanceDays, 1);
  assert.equal(p.after.instructorExcessTargetDays, 0);
  assert.equal(p.after.instructorSingleLectureDays, 0);
  assert.ok(qualityPlanValid(s, final(s, p), 3));
  assert.equal(p.before.teachingMinutes, p.after.teachingMinutes);
});

test("improves a gap within four fixed student days without proving three days feasible", async () => {
  const s = snapshot(
    [0, 1, 2, 3].map((d) => session("fixed" + d, d, "08:00:00", "10:00:00", { is_locked: true })),
  );
  s.sessions.push(session("move", 0, "12:00:00", "14:00:00"));
  s.instructors.push({ id: "move", instructor_type_id: "permanent", max_hours_per_day: 6 });
  const p = await run(s);
  assert.equal(p.qualitySearch.dayCap, 4);
  assert.ok(p.after.studentGapMinutes < p.before.studentGapMinutes);
  assert.equal(p.after.excessDaysOverThree, p.before.excessDaysOverThree);
  assert.ok(p.moves.every((m) => m.id === "move"));
  assert.ok(qualityPlanValid(s, final(s, p), 4));
});

test("same-time practical hall placement returns to an available lab", async () => {
  const s = snapshot([session("lab", 0, "08:00:00", "10:00:00")]);
  s.assignments[0].required_room_type = "computer_lab";
  s.assignments[0].plan_course_component_id = "pc";
  s.components = [{ id: "pc", component_type: "practical" }];
  s.rooms.push({ ...s.rooms[0], id: "lab-room", room_type: "computer_lab" });
  const p = await run(s);
  assert.equal(p.before.practicalHallSessions, 1);
  assert.equal(p.after.practicalHallSessions, 0);
  assert.equal(p.moves[0].room_id, "lab-room");
  assert.equal(p.moves[0].start_time, "08:00:00");
  assert.ok(qualityPlanValid(s, final(s, p), 3));
});

test("available lab must also meet capacity and locks", async () => {
  const s = snapshot([session("lab", 0, "08:00:00", "10:00:00")]);
  s.assignments[0].required_room_type = "computer_lab";
  s.assignments[0].plan_course_component_id = "pc";
  s.components = [{ id: "pc", component_type: "practical" }];
  s.rooms.push({ ...s.rooms[0], id: "small", room_type: "computer_lab", capacity: 10 });
  const p = await run(s);
  assert.equal(p.after.practicalHallSessions, 1);
  s.sessions[0].is_locked = true;
  const locked = await run(s);
  assert.equal(locked.qualitySearch.reason, "all_locked");
  assert.equal(locked.moves.length, 0);
});

test("simultaneous swaps can remove instructor gaps in a fully occupied room", async () => {
  const s = snapshot([
    session("a", 0, "08:00:00", "10:00:00", { instructor_id: "t" }),
    session("b", 0, "10:00:00", "12:00:00", { instructor_id: "u" }),
    session("c", 0, "12:00:00", "14:00:00", { instructor_id: "t" }),
  ]);
  s.templates = s.templates.filter((t) => t.day_of_week === 0);
  const p = await run(s);
  assert.equal(p.after.instructorGapMinutes, 0);
  assert.ok(p.moves.length >= 2);
  assert.equal(p.applicationMode, "simultaneous");
  assert.ok(qualityPlanValid(s, final(s, p), 3));
});

test("validation rejects increasing one person's days even if another improves", () => {
  const s = snapshot([
    session("a", 0, "08:00:00", "10:00:00", { instructor_id: "t" }),
    session("b", 0, "10:00:00", "12:00:00", { instructor_id: "t" }),
  ]);
  assert.equal(
    qualityPlanValid(s, [s.sessions[0], { ...s.sessions[1], day_of_week: 1 }], 3),
    false,
  );
});

test("readiness and cancellation return explicit reasons, without claiming optimality", async () => {
  const s = snapshot([session("a", 0, "08:00:00", "10:00:00")]);
  const timeout = await improveDistribution(s, highs, { maxDurationMs: 0 });
  assert.equal(timeout.qualitySearch.reason, "time_limit");
  assert.match(qualitySearchMessage(timeout), /لا يثبت/);
  const c = new AbortController();
  c.abort();
  const cancelled = await improveDistribution(s, highs, { signal: c.signal });
  assert.equal(cancelled.stopped, true);
  const p = await run(s);
  assert.equal(p.moves.length, 0);
  assert.match(qualitySearchMessage(p), /ليست شهادة/);
});

test("student identity and cross-college busy times remain hard constraints", async () => {
  const s = snapshot([
    session("a", 0, "08:00:00", "10:00:00"),
    session("b", 0, "12:00:00", "14:00:00"),
  ]);
  s.externalBusy = [
    { instructor_id: "b", day_of_week: 0, start_time: "10:00:00", end_time: "12:00:00" },
  ];
  const p = await run(s);
  assert.ok(qualityPlanValid(s, final(s, p), 3));
  assert.equal(
    final(s, p).some(
      (x) => x.instructor_id === "b" && x.day_of_week === 0 && x.start_time === "10:00:00",
    ),
    false,
  );
  addCohort(s, "c2", "g2", "p2");
  assert.equal(
    qualityPlanValid(
      s,
      s.sessions.map((x) => ({ ...x, delivery_group_id: "g2" })),
      3,
    ),
    false,
  );
});

test("actual preview worker invokes continuous quality search and emits progress", async () => {
  const replies = [];
  globalThis.self = { postMessage: (reply) => replies.push(reply) };
  globalThis.__qualityHighs = highs;
  const bundled = await build({
    entryPoints: [
      fileURLToPath(new URL("../src/lib/auto-scheduler/compact.worker.ts", import.meta.url)),
    ],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "solver-runtime",
        setup(b) {
          b.onResolve({ filter: /^highs(?:\/runtime\?url)?$/ }, (args) => ({
            path: args.path,
            namespace: "solver-test",
          }));
          b.onLoad({ filter: /.*/, namespace: "solver-test" }, (args) => ({
            contents:
              args.path === "highs"
                ? "export default async () => globalThis.__qualityHighs;"
                : 'export default "test.wasm";',
          }));
        },
      },
    ],
  });
  try {
    await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
    );
    const s = snapshot(
      [0, 1, 2].map((d, i) =>
        session("worker" + i, d, "08:00:00", "10:00:00", { instructor_id: "teacher" }),
      ),
    );
    await globalThis.self.onmessage({
      data: { snapshot: s, maxDurationMs: 1500, purpose: "compaction" },
    });
    assert.ok(replies.some((r) => r.type === "progress" && r.moves > 0));
    const result = replies.find((r) => r.type === "result");
    assert.ok(result.proposal.qualitySearch);
    assert.equal(result.proposal.after.instructorAttendanceDays, 1);
  } finally {
    delete globalThis.self;
    delete globalThis.__qualityHighs;
  }
});

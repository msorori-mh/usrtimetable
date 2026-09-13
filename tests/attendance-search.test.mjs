import test from "node:test";
import assert from "node:assert/strict";
import { searchAttendance } from "../src/lib/auto-scheduler/attendance-search.ts";
import {
  compactAttendance,
  orderAttendanceMoves,
} from "../src/lib/auto-scheduler/attendance-compaction.ts";
import { measure, feasible } from "../src/lib/auto-scheduler/compact.ts";
import { snapshot, session, addCohort } from "./helpers/attendance-fixtures.mjs";

const workload = (n) =>
  snapshot(
    Array.from({ length: n }, (_, i) =>
      session(String(i), i % 5, "08:00:00", "10:00:00", { updated_at: "" }),
    ),
  );
test("eight two-hour lectures use 3–3–2 contiguous days, preserving every identity and hour", async () => {
  const s = workload(8),
    original = structuredClone(s);
  const r = await searchAttendance(s);
  assert.equal(r.status, "feasible");
  assert.equal(r.days, 3);
  assert.deepEqual(
    Object.values(
      r.sessions.reduce((m, x) => ({ ...m, [x.day_of_week]: (m[x.day_of_week] ?? 0) + 1 }), {}),
    ).sort(),
    [2, 3, 3],
  );
  assert.equal(measure(s, r.sessions).studentGapMinutes, 0);
  assert.equal(measure(s, r.sessions).teachingMinutes, 960);
  assert.deepEqual(s, original);
  for (const x of r.sessions)
    assert.equal(
      feasible(
        s,
        r.sessions,
        x,
        s.sessions.find((old) => old.id === x.id),
      ),
      true,
    );
});
test("four days require a proof that three cannot carry the full workload", async () => {
  const s = workload(8);
  s.settings.max_daily_hours_per_section = 4;
  const r = await searchAttendance(s);
  assert.equal(r.days, 4);
  assert.deepEqual(
    r.attempts.map((a) => [a.days, a.status]),
    [
      [3, "infeasible"],
      [4, "feasible"],
    ],
  );
});
test("five days require both earlier proofs", async () => {
  const s = workload(9);
  s.settings.max_daily_hours_per_section = 4;
  const r = await searchAttendance(s);
  assert.equal(r.days, 5);
  assert.deepEqual(
    r.attempts.map((a) => [a.days, a.status]),
    [
      [3, "infeasible"],
      [4, "infeasible"],
      [5, "feasible"],
    ],
  );
});
test("infeasible five days returns no schedule and never attempts six", async () => {
  const s = workload(11);
  s.settings.max_daily_hours_per_section = 4;
  const r = await searchAttendance(s);
  assert.equal(r.status, "infeasible");
  assert.equal(r.days, null);
  assert.equal(r.sessions.length, 0);
  assert.deepEqual(
    r.attempts.map((a) => a.days),
    [3, 4, 5],
  );
});
test("timeout is UNKNOWN, never permission for four or five", async () => {
  const r = await searchAttendance(workload(8), { maxDurationMs: 0 });
  assert.equal(r.status, "unknown");
  assert.equal(r.days, null);
  assert.deepEqual(
    r.attempts.map((a) => a.days),
    [3],
  );
  assert.equal(r.sessions.length, 0);
});
test("candidate budget and cancellation cannot produce UNSAT", async () => {
  for (const options of [{ maxEvaluations: 1 }, { signal: AbortSignal.abort() }]) {
    const r = await searchAttendance(workload(8), options);
    assert.equal(r.status, "unknown");
    assert.equal(
      r.attempts.some((a) => a.status === "infeasible"),
      false,
    );
  }
});
test("locked four-day attendance is exhausted before allowing four", async () => {
  const s = workload(4);
  s.sessions.forEach((x) => (x.is_locked = true));
  const r = await searchAttendance(s);
  assert.equal(r.days, 4);
  assert.equal(r.attempts[0].reason, "exhausted");
  assert.deepEqual(r.sessions, s.sessions);
});
test("incomplete student maps cannot certify absolute infeasibility", async () => {
  const s = workload(8);
  s.members = [];
  const r = await searchAttendance(s);
  assert.equal(r.status, "unknown");
  assert.equal(r.attempts[0].reason, "invalid_input");
});
test("minute-domain includes a valid placement outside the hourly grid", async () => {
  const s = workload(1);
  s.roomAvailability = [
    { room_id: "r", day_of_week: 0, start_time: "08:17:00", end_time: "10:17:00" },
  ];
  const r = await searchAttendance(s);
  assert.equal(r.days, 3);
  assert.equal(r.sessions[0].start_time, "08:17:00");
});
test("all programs share teacher and room constraints", async () => {
  const s = workload(2);
  addCohort(s, "c2", "g2", "p2");
  Object.assign(s.sessions[1], {
    cohort_id: "c2",
    delivery_group_id: "g2",
    instructor_id: s.sessions[0].instructor_id,
  });
  const r = await searchAttendance(s);
  assert.equal(r.status, "feasible");
  for (const x of r.sessions)
    assert.equal(
      feasible(
        s,
        r.sessions,
        x,
        s.sessions.find((old) => old.id === x.id),
      ),
      true,
    );
});
test("a swap uses a legal buffer inside the ordered atomic plan", () => {
  const s = workload(2);
  s.sessions[1].start_time = "10:00:00";
  s.sessions[1].end_time = "12:00:00";
  s.sessions[1].day_of_week = 0;
  const targets = s.sessions.map((x, i) => ({
    ...x,
    start_time: s.sessions[1 - i].start_time,
    end_time: s.sessions[1 - i].end_time,
  }));
  const moves = orderAttendanceMoves(s, targets);
  assert.equal(moves.length, 3);
  let current = s.sessions;
  for (const move of moves) {
    const old = current.find((x) => x.id === move.id),
      next = { ...old, ...move };
    assert.equal(feasible(s, current, next, old), true);
    current = current.map((x) => (x.id === move.id ? next : x));
  }
  assert.deepEqual(current, targets);
});
test("unresolved compaction offers no writable proposal", async () => {
  const p = await compactAttendance(workload(8), { maxDurationMs: 0 });
  assert.equal(p.attendanceSearch.status, "unknown");
  assert.deepEqual(p.moves, []);
});

import { test, expect } from "bun:test";
import {
  buildJointModel,
  JointModelTimeoutError,
  JOINT_MODEL_TIMEOUT_AR,
  validateJointPlan,
} from "../src/lib/auto-scheduler/joint-model.ts";
import { compactSlots, extendedDays, feasible, measure, placementIssue } from "../src/lib/auto-scheduler/compact.ts";
import * as legacyModel from "./fixtures/m14-legacy/joint-model.ts";
import * as legacyCompact from "./fixtures/m14-legacy/compact.ts";
import { modelDigest, syntheticSnapshot } from "./helpers/m14-synthetic-snapshot.ts";

const clone = <T>(x: T): T => structuredClone(x);

const cases = [
  { sessions: 24, seed: 1, extended: true, scope: false },
  { sessions: 60, seed: 2, extended: true, scope: true },
  { sessions: 40, seed: 3, extended: false, scope: false },
  { sessions: 40, seed: 11, extended: true, scope: true, stress: true },
];

for (const c of cases) {
  test(`M-14: buildJointModel output identical to the legacy implementation (${JSON.stringify(c)})`, () => {
    for (const dayCap of [3, 4, 5] as const)
      for (const repair of [false, true]) {
        let legacyError: unknown = null;
        let currentError: unknown = null;
        let legacy: ReturnType<typeof modelDigest> | null = null;
        let current: ReturnType<typeof modelDigest> | null = null;
        try {
          legacy = modelDigest(legacyModel.buildJointModel(clone(syntheticSnapshot(c)) as never, dayCap, repair) as never);
        } catch (e) {
          legacyError = (e as Error).message;
        }
        try {
          current = modelDigest(buildJointModel(clone(syntheticSnapshot(c)), dayCap, repair) as never);
        } catch (e) {
          currentError = (e as Error).message;
        }
        expect(currentError).toEqual(legacyError);
        expect(current).toEqual(legacy);
        if (current) expect(current.numCols).toBeGreaterThan(0);
      }
  });
}

for (const variant of [
  { sessions: 48, seed: 5, extended: true, scope: false },
  { sessions: 48, seed: 12, extended: true, scope: false, stress: true },
])
test(`M-14: placementIssue / measure / extendedDays / compactSlots unchanged on every candidate (${JSON.stringify(variant)})`, () => {
  const s = syntheticSnapshot(variant);
  const legacyS = clone(s);
  let checked = 0;
  const reasons = new Map<string, number>();
  for (const original of s.sessions) {
    const slots = compactSlots(s, original);
    expect(slots).toEqual(legacyCompact.compactSlots(legacyS as never, original as never));
    for (const slot of slots)
      for (const room of s.rooms) {
        const candidate = { ...original, is_locked: false, day_of_week: slot.day, start_time: slot.start, end_time: slot.end, room_id: room.id };
        const now = placementIssue(s, s.sessions, candidate, { ...original, is_locked: false });
        const was = legacyCompact.placementIssue(legacyS as never, legacyS.sessions as never, candidate as never, { ...original, is_locked: false } as never);
        expect(now).toBe(was);
        reasons.set(String(now), (reasons.get(String(now)) ?? 0) + 1);
        checked++;
      }
  }
  expect(checked).toBeGreaterThan(1000);
  // The fixture must exercise several distinct rejection paths, including extended days.
  expect(reasons.size).toBeGreaterThan(5);
  if (variant.stress)
    for (const reason of ["extended_day_cap", "student_daily_hours", "inactive_assignment", "inactive_room", "required_break"])
      expect(reasons.get(reason) ?? 0).toBeGreaterThan(0);
  expect(measure(s)).toEqual(legacyCompact.measure(legacyS as never));
  expect([...extendedDays(s)].map(([k, v]) => [k, [...v]])).toEqual(
    [...legacyCompact.extendedDays(legacyS as never)].map(([k, v]) => [k, [...v]]),
  );
});

test("M-14: memoized context does not leak caller mutations", () => {
  const s = syntheticSnapshot({ sessions: 12, seed: 9 });
  const ctxStudents = (legacyCompact.context(clone(s) as never) as { students: (x: unknown) => string[] }).students;
  const before = ctxStudents(s.sessions[0]);
  const { context } = require("../src/lib/auto-scheduler/compact.ts");
  const ctx = context(s);
  const first = ctx.students(s.sessions[0]);
  first.push("tampered");
  expect(ctx.students(s.sessions[0])).toEqual(before);
});

test("M-14: indexes stay correct when snapshot arrays grow between calls", () => {
  const s = syntheticSnapshot({ sessions: 12, seed: 4 });
  const x = { ...s.sessions[1], is_locked: false, room_id: "new-room" };
  expect(placementIssue(s, s.sessions, x, { ...s.sessions[1], is_locked: false })).toBe("inactive_room");
  s.rooms.push({ ...s.rooms[0], id: "new-room" });
  expect(placementIssue(s, s.sessions, x, { ...s.sessions[1], is_locked: false })).not.toBe("inactive_room");
});

test("M-14: model building stops with a typed Arabic timeout at the deadline or on abort", () => {
  const s = syntheticSnapshot({ sessions: 30, seed: 6 });
  let t = 0;
  expect(() => buildJointModel(s, 5, false, { deadline: 10, now: () => (t += 1) })).toThrow(JointModelTimeoutError);
  const controller = new AbortController();
  controller.abort();
  try {
    buildJointModel(s, 5, false, { signal: controller.signal });
    throw new Error("expected timeout");
  } catch (e) {
    expect(e).toBeInstanceOf(JointModelTimeoutError);
    expect((e as Error).message).toBe(JOINT_MODEL_TIMEOUT_AR);
    expect((e as JointModelTimeoutError).code).toBe("JOINT_MODEL_TIMEOUT");
  }
  // Generous deadline: same model as without options.
  const a = modelDigest(buildJointModel(clone(s), 5, false, { deadline: Date.now() + 60000 }) as never);
  const b = modelDigest(buildJointModel(clone(s), 5) as never);
  expect(a).toEqual(b);
});

test("M-14: validateJointPlan agrees with the legacy implementation", () => {
  const s = syntheticSnapshot({ sessions: 30, seed: 8 });
  for (const cap of [3, 4, 5])
    expect(validateJointPlan(s, s.sessions, cap)).toBe(
      legacyModel.validateJointPlan(clone(s) as never, clone(s.sessions) as never, cap),
    );
});

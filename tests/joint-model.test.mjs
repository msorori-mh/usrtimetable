import test from "node:test";
import assert from "node:assert/strict";
import loadHighs from "highs";
import { buildJointModel, validateJointPlan } from "../src/lib/auto-scheduler/joint-model.ts";
import { searchJointAttendance } from "../src/lib/auto-scheduler/joint-search.ts";
import { snapshot, session } from "./helpers/attendance-fixtures.mjs";
const highs = await loadHighs();
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

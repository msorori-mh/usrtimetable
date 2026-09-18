import test from "node:test";
import assert from "node:assert/strict";
import loadHighs from "highs";
import { snapshot, session } from "./helpers/attendance-fixtures.mjs";
import { feasible } from "../src/lib/auto-scheduler/compact.ts";
import { buildJointModel, validateJointPlan } from "../src/lib/auto-scheduler/joint-model.ts";
import { instructorDailySessionViolations } from "../src/lib/auto-scheduler/instructor-daily-sessions.ts";
const fixture = () =>
  snapshot(
    [8, 9, 10, 11].map((h, i) =>
      session(
        String(i),
        0,
        `${h.toString().padStart(2, "0")}:00:00`,
        `${(h + 1).toString().padStart(2, "0")}:00:00`,
        { instructor_id: "teacher" },
      ),
    ),
  );
test("four short meetings fail independently of six-hour limit", () => {
  const s = fixture();
  assert.equal(validateJointPlan(s, s.sessions, 4), false);
  assert.equal(feasible(s, s.sessions, s.sessions[3], s.sessions[3]), false);
  const next = s.sessions.map((x, i) => (i === 3 ? { ...x, day_of_week: 1 } : x));
  assert.equal(validateJointPlan(s, next, 4), true);
});
test("regular and parallel meetings share one cap; replaced split sources do not count", () => {
  const s = fixture();
  s.sessions[3].study_system = "parallel";
  assert.equal(instructorDailySessionViolations(s.sessions)[0].count, 4);
  s.sessions[3].replaced_by_split = true;
  assert.deepEqual(instructorDailySessionViolations(s.sessions), []);
});
test("mathematical model relocates a fourth meeting and independent validator accepts", async () => {
  const s = fixture(),
    highs = await loadHighs(),
    built = buildJointModel(s, 4);
  const model = highs.createModel(built.model);
  try {
    model.options.set({ output_flag: false, time_limit: 5 });
    model.run();
    assert.equal(model.info.get("primal_solution_status"), highs.constants.solutionStatus.feasible);
    const final = built.decode(model.getSolution().colValue);
    assert.equal(validateJointPlan(s, final, 4), true);
    assert.deepEqual(instructorDailySessionViolations(final), []);
  } finally {
    model.dispose();
  }
});
test("four locked meetings cannot be accepted even in repair mode", async () => {
  const s = fixture();
  s.sessions.forEach((x) => (x.is_locked = true));
  const highs = await loadHighs(),
    built = buildJointModel(s, 4, true),
    model = highs.createModel(built.model);
  try {
    model.options.set({ output_flag: false, time_limit: 5 });
    model.run();
    assert.notEqual(
      model.info.get("primal_solution_status"),
      highs.constants.solutionStatus.feasible,
    );
  } finally {
    model.dispose();
  }
});

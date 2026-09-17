import test from "node:test";
import assert from "node:assert/strict";
import loadHighs from "highs";
import { buildJointModel, validateJointPlan } from "../src/lib/auto-scheduler/joint-model.ts";
import { searchJointAttendance } from "../src/lib/auto-scheduler/joint-search.ts";
import { planRepair } from "../src/lib/auto-scheduler/repair.ts";
import {
  applyGenerationPlan,
  applyRepairPlan,
} from "../src/lib/auto-scheduler/generation-transaction.ts";
import { feasible } from "../src/lib/auto-scheduler/compact.ts";
import { snapshot, session } from "./helpers/attendance-fixtures.mjs";
const highs = await loadHighs();
function blocked() {
  const old = session("old", 0, "08:00:00", "10:00:00");
  const missing = session("missing", 0, "08:00:00", "10:00:00", {
    updated_at: "",
  });
  const s = snapshot([old, missing]);
  s.revision = "1";
  s.versionUpdatedAt = "t1";
  s.settings.working_days = [0];
  s.settings.day_end_time = "12:00:00";
  s.settings.enforce_instructor_availability = true;
  s.availability = [
    {
      instructor_id: "missing",
      day_of_week: 0,
      start_time: "08:00:00",
      end_time: "10:00:00",
      availability_type: "available",
      is_preference: false,
    },
  ];
  s.generationScope = { existingIds: [old.id], maxRelocations: 1 };
  return { s, old, missing };
}
test("first generation relocates an earlier session to make the only legal opening", async () => {
  const { s, old, missing } = blocked();
  assert.equal(feasible(s, [old], missing, missing), false);
  const result = await searchJointAttendance(s, highs, 5000, "generation");
  assert.equal(result.attendanceSearch.status, "feasible");
  const final = result.attendanceSearch.sessions;
  assert.equal(final.find((s) => s.id === "old").start_time, "10:00:00");
  assert.equal(final.find((s) => s.id === "missing").start_time, "08:00:00");
  assert.equal(validateJointPlan(s, final, 3), true);
});
test("locked blockers and zero relocation budget cannot be silently moved", () => {
  for (const locked of [true, false]) {
    const { s } = blocked();
    s.sessions[0].is_locked = locked;
    s.generationScope.maxRelocations = locked ? 1 : 0;
    const built = buildJointModel(s, 3),
      model = highs.createModel(built.model);
    try {
      model.options.set({ output_flag: false });
      model.run();
      assert.equal(model.getModelStatus(), highs.constants.modelStatus.infeasible);
    } finally {
      model.dispose();
    }
  }
});
test("five instructor days are infeasible in the model and rejected independently", () => {
  const s = snapshot(
    Array.from({ length: 5 }, (_, i) =>
      session(`s${i}`, i, "08:00:00", "09:00:00", {
        instructor_id: "t",
        is_locked: true,
      }),
    ),
  );
  assert.equal(validateJointPlan(s, s.sessions, 5), false);
  let built = buildJointModel(s, 5),
    model = highs.createModel(built.model);
  try {
    model.options.set({ output_flag: false });
    model.run();
    assert.equal(model.getModelStatus(), highs.constants.modelStatus.infeasible);
  } finally {
    model.dispose();
  }
  s.instructors[0].max_attendance_days_per_week = 5;
  assert.equal(validateJointPlan(s, s.sessions, 5), true);
  built = buildJointModel(s, 5);
  model = highs.createModel(built.model);
  try {
    model.options.set({ output_flag: false });
    model.run();
    assert.equal(model.info.get("primal_solution_status"), highs.constants.solutionStatus.feasible);
  } finally {
    model.dispose();
  }
});
test("six weekly hours prefer one instructor day during generation", async () => {
  const s = snapshot(
    [0, 1, 2].map((day) => session(`s${day}`, day, "08:00:00", "10:00:00", { instructor_id: "t" })),
  );
  const p = await searchJointAttendance(s, highs, 5000, "generation");
  assert.equal(p.attendanceSearch.status, "feasible");
  assert.equal(new Set(p.attendanceSearch.sessions.map((s) => s.day_of_week)).size, 1);
});
test("bounded repair is wired to a single atomic save; transport uncertainty never compensates", async () => {
  const { s, old, missing } = blocked();
  s.sessions = [old];
  const stats = { attempts: 0 };
  const plan = planRepair({
    snapshot: s,
    sessions: [old],
    missing,
    targetSlots: [{ day: 0, start: "08:00:00", end: "10:00:00" }],
    roomIds: ["r"],
    dayCap: 3,
    stats,
  });
  assert.ok(plan);
  assert.equal(plan.moves.length, 1);
  assert.ok(stats.attempts <= 4000);
  for (const outcome of ["saved", "rejected", "unknown"]) {
    const calls = [];
    const result = await applyRepairPlan({
      collegeId: "c",
      versionId: "v",
      snapshot: s,
      missing,
      plan,
      dayCap: 3,
      rpc: async (name, request) => {
        calls.push({ name, request });
        if (outcome === "unknown") throw new Error("lost response");
        return {
          error: null,
          data:
            outcome === "saved"
              ? {
                  ok: true,
                  operation_id: request.p_operation_id,
                  sessions: [{ id: "created" }],
                  relocated: 1,
                  revision: "2",
                  schedule_version_updated_at: "t2",
                }
              : { ok: false, code: "FINAL_STATE_CONFLICT" },
        };
      },
    });
    assert.equal(result.status, outcome);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "apply_schedule_generation");
    assert.equal(calls[0].request.p_moves.length, 1);
    assert.equal(calls[0].request.p_additions.length, 1);
  }
});
test("invalid final state never reaches persistence", async () => {
  const { s } = blocked();
  await assert.rejects(
    applyGenerationPlan({
      collegeId: "c",
      versionId: "v",
      snapshot: s,
      sessions: s.sessions,
      existingIds: ["old"],
      dayCap: 3,
      rpc: async () => {
        throw new Error("must not call");
      },
    }),
    /GENERATION_FINAL_STATE_INVALID/,
  );
});

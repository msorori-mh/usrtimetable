#!/usr/bin/env bun
/**
 * M-14 micro-benchmark: joint-model building and per-candidate feasibility,
 * current implementation vs the pre-optimisation copy kept in
 * tests/fixtures/m14-legacy. Model building only (no HiGHS solve).
 *
 *   bun scripts/bench-generator-model.ts [sessions=120,240] [repeats=3]
 */
import { buildJointModel } from "../src/lib/auto-scheduler/joint-model.ts";
import { compactSlots, placementIssue } from "../src/lib/auto-scheduler/compact.ts";
import * as legacyModel from "../tests/fixtures/m14-legacy/joint-model.ts";
import * as legacyCompact from "../tests/fixtures/m14-legacy/compact.ts";
import { syntheticSnapshot } from "../tests/helpers/m14-synthetic-snapshot.ts";

const sizes = (process.argv[2] ?? "120,240").split(",").map(Number);
const repeats = Number(process.argv[3] ?? 3);

function time<T>(fn: () => T): { ms: number; value: T } {
  const t = performance.now();
  const value = fn();
  return { ms: performance.now() - t, value };
}
function best(fn: () => unknown): number {
  let min = Infinity;
  for (let i = 0; i < repeats; i++) min = Math.min(min, time(fn).ms);
  return min;
}
function sweep(
  impl: { compactSlots: typeof compactSlots; placementIssue: typeof placementIssue },
  s: ReturnType<typeof syntheticSnapshot>,
) {
  let n = 0;
  for (const o of s.sessions)
    for (const slot of impl.compactSlots(s, o))
      for (const room of s.rooms) {
        impl.placementIssue(
          s,
          s.sessions,
          {
            ...o,
            is_locked: false,
            day_of_week: slot.day,
            start_time: slot.start,
            end_time: slot.end,
            room_id: room.id,
          },
          { ...o, is_locked: false },
        );
        n++;
      }
  return n;
}

console.log(
  "sessions | candidates | build legacy ms | build new ms | speedup | feasibility checks | sweep legacy ms | sweep new ms | speedup",
);
for (const n of sizes) {
  const fresh = () => syntheticSnapshot({ sessions: n, seed: 42, extended: true });
  const stressed = () => syntheticSnapshot({ sessions: n, seed: 42, extended: true, stress: true });
  let candidates: number | string = 0;
  const legacyBuild = best(() => {
    try {
      candidates = legacyModel.buildJointModel(fresh() as never, 5).candidateCount;
    } catch (error) {
      // Grid/size rejections are timed too (they still walk every candidate first).
      candidates = (error as Error).message;
    }
  });
  const newBuild = best(() => {
    try {
      buildJointModel(fresh(), 5);
    } catch {
      /* same */
    }
  });
  let checks = 0;
  const legacySweep = best(() => (checks = sweep(legacyCompact as never, stressed())));
  const newSweep = best(() => sweep({ compactSlots, placementIssue }, stressed()));
  console.log(
    [
      n,
      candidates,
      legacyBuild.toFixed(0),
      newBuild.toFixed(0),
      `${(legacyBuild / newBuild).toFixed(1)}x`,
      checks,
      legacySweep.toFixed(0),
      newSweep.toFixed(0),
      `${(legacySweep / newSweep).toFixed(1)}x`,
    ].join(" | "),
  );
}

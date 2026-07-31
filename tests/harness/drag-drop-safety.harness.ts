import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildEvaluateDropTargetInput,
  evaluateDropTarget,
  isProtectedDemoVersion,
  toOccupancySession,
} from "../../src/lib/schedule-builder/drag-drop-safety.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(`FAIL: ${m}`);
};

const safety = read("src/lib/schedule-builder/drag-drop-safety.ts");
assert(safety.includes("evaluateDropTarget"), "evaluateDropTarget present");
assert(safety.includes("buildEvaluateDropTargetInput"), "cohort/room wiring helper present");
assert(safety.includes("pushUndo"), "undo helpers present");

const builder = read("src/routes/_authenticated/schedule-builder.tsx");
assert(builder.includes("evaluateDropTarget"), "builder uses safety");
assert(builder.includes("buildEvaluateDropTargetInput"), "builder wires drop preview input");
assert(!builder.includes("cohort_id: null"), "builder does not force cohort_id null");
assert(builder.includes("isProtectedDemoVersion"), "protects demo version");
assert(builder.includes("onUndoLocal") || builder.includes("تراجع محلي"), "undo UI");
assert(builder.includes("getDropTone"), "grid tone wired");

const workspace = read("src/lib/schedule-builder/workspace.ts");
assert(workspace.includes("cohort_id: s.cohort_id ?? null"), "mapWorkspaceSessions preserves cohort_id");

const grid = read("src/components/timetable/timetable-grid.tsx");
assert(grid.includes("getDropTone"), "grid accepts tone");
assert(grid.includes("bg-emerald-500/25"), "green slot style");
assert(grid.includes("bg-red-500/25"), "red slot style");

assert(isProtectedDemoVersion("835e50fe-3ad2-4232-8c15-0f403c668a7f"), "demo id");
const ok = evaluateDropTarget({
  sourceSlot: { day_of_week: 0, start_time: "08:00", end_time: "10:00", room_id: "r" },
  movingSession: {
    id: "1",
    instructor_id: "i",
    room_id: "r",
    study_system: "regular",
    day_of_week: 0,
    start_time: "08:00",
    end_time: "10:00",
  },
  day_of_week: 1,
  start_time: "08:00",
  others: [],
});
assert(ok.kind === "valid", "free slot valid");

const wired = buildEvaluateDropTargetInput({
  sourceSlot: { day_of_week: 0, start_time: "08:00", end_time: "10:00", room_id: "r-hall" },
  movingSession: {
    id: "1",
    instructor_id: "i",
    room_id: "r-hall",
    cohort_id: "coh-1",
    study_system: "regular",
    day_of_week: 0,
    start_time: "08:00",
    end_time: "10:00",
    session_type: "lecture",
    enrollment_count: 40,
  },
  day_of_week: 1,
  start_time: "08:00",
  others: [],
  rooms: [{ id: "r-hall", room_type: "lecture_hall", capacity: 60 }],
});
assert(wired.movingSession.cohort_id === "coh-1", "wired cohort preserved");
assert(wired.roomTypeOk === true, "compatible room type");
assert(wired.roomCapacity === 60, "room capacity wired");
assert(toOccupancySession({ ...wired.movingSession, cohort_id: "coh-1" }).cohort_id === "coh-1", "occupancy cohort");

const cohortBlock = evaluateDropTarget(
  buildEvaluateDropTargetInput({
    sourceSlot: { day_of_week: 0, start_time: "08:00", end_time: "10:00", room_id: "r-hall" },
    movingSession: {
      id: "1",
      instructor_id: "i1",
      room_id: "r-hall",
      cohort_id: "coh-1",
      study_system: "regular",
      day_of_week: 0,
      start_time: "08:00",
      end_time: "10:00",
      session_type: "lecture",
      enrollment_count: 40,
    },
    day_of_week: 1,
    start_time: "08:00",
    others: [
      {
        id: "2",
        instructor_id: "i2",
        room_id: "r2",
        cohort_id: "coh-1",
        study_system: "regular",
        day_of_week: 1,
        start_time: "08:00",
        end_time: "10:00",
      },
    ],
    rooms: [{ id: "r-hall", room_type: "lecture_hall", capacity: 60 }],
  }),
);
assert(cohortBlock.kind === "forbidden", "cohort conflict forbidden");
assert(cohortBlock.proposed == null, "invalid preview has no proposed slot (no DB write)");

console.log("drag-drop-safety.harness.ts: PASS");

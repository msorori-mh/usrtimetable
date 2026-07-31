import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  evaluateDropTarget,
  isProtectedDemoVersion,
} from "../../src/lib/schedule-builder/drag-drop-safety.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(`FAIL: ${m}`);
};

const safety = read("src/lib/schedule-builder/drag-drop-safety.ts");
assert(safety.includes("evaluateDropTarget"), "evaluateDropTarget present");
assert(safety.includes("pushUndo"), "undo helpers present");

const builder = read("src/routes/_authenticated/schedule-builder.tsx");
assert(builder.includes("evaluateDropTarget"), "builder uses safety");
assert(builder.includes("isProtectedDemoVersion"), "protects demo version");
assert(builder.includes("onUndoLocal") || builder.includes("تراجع محلي"), "undo UI");
assert(builder.includes("getDropTone"), "grid tone wired");

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

console.log("drag-drop-safety.harness.ts: PASS");

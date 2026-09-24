import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routeSource = await readFile(
  new URL("../src/routes/_authenticated/auto-schedule.tsx", import.meta.url),
  "utf8",
);
const engineSource = await readFile(
  new URL("../src/lib/auto-scheduler/v2.ts", import.meta.url),
  "utf8",
);

test("unsupported destructive scheduling modes are visibly disabled", () => {
  assert.match(routeSource, /<SelectItem value="regenerate_auto" disabled>/);
  assert.match(routeSource, /<SelectItem value="full_rebuild" disabled>/);
  assert.match(routeSource, /قيد التطوير وغير متاحة حاليًا/);
});

test("the UI guard remains aligned with the engine fail-closed guard", () => {
  assert.match(engineSource, /if \(mode !== "fill_missing"\)/);
  assert.match(engineSource, /V2_DESTRUCTIVE_MODE_BLOCKED/);
});

test("the incremental save and resume policy is explicit before execution", () => {
  assert.match(routeSource, /التشغيل تراكمي وآمن للاستئناف/);
  assert.match(routeSource, /زر الإيقاف يمنع الخطوات\s+التالية ولا يتراجع/);
});

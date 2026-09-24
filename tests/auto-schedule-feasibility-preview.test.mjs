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

test("preview returns before every generation or audit write", () => {
  const boundary = engineSource.indexOf("if (params.previewOnly)");
  const firstGenerationWrite = engineSource.indexOf("applyGenerationPlan({", boundary);
  const auditInsert = engineSource.indexOf('.from("auto_schedule_runs")', boundary);

  assert.ok(boundary > 0, "missing preview-only boundary");
  assert.ok(firstGenerationWrite > boundary, "generation write must follow preview return");
  assert.ok(auditInsert > boundary, "run audit insert must follow preview return");
  assert.match(engineSource.slice(boundary, firstGenerationWrite), /return\s*\{/);
});

test("preview exposes concrete feasibility evidence", () => {
  assert.match(engineSource, /eligibleAssignments: workItems\.length/);
  assert.match(engineSource, /pendingSessions: plannedPending\.length/);
  assert.match(engineSource, /attendanceEvidence/);
  assert.match(engineSource, /attendanceDays: attendancePlan\.days/);
});

test("UI requires a fresh read-only preview and invalidates it when inputs change", () => {
  assert.match(routeSource, /previewOnly: true/);
  assert.match(routeSource, /!previewResult/);
  assert.match(routeSource, /فحص الجدوى دون حفظ/);
  assert.match(routeSource, /setPreviewResult\(null\)/);
  assert.match(routeSource, /التشغيل سيعيد الفحص كاملًا قبل الحفظ/);
});

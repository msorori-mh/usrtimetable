import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCoreWorkflow } from "../../src/lib/core-workflow.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const empty = resolveCoreWorkflow({
  hasActiveCollege: true,
  readinessPercent: 40,
  blockerCount: 3,
  scheduleVersionCount: 0,
  publishedVersionCount: 0,
});
assert.equal(empty.nextStage.id, "prepare");
assert.equal(empty.stages.find((stage) => stage.id === "build")?.status, "blocked");

const ready = resolveCoreWorkflow({
  hasActiveCollege: true,
  readinessPercent: 100,
  blockerCount: 0,
  scheduleVersionCount: 0,
  publishedVersionCount: 0,
});
assert.equal(ready.nextStage.id, "build");

const draft = resolveCoreWorkflow({
  hasActiveCollege: true,
  readinessPercent: 100,
  blockerCount: 0,
  scheduleVersionCount: 2,
  publishedVersionCount: 0,
});
assert.equal(draft.nextStage.id, "review");

const published = resolveCoreWorkflow({
  hasActiveCollege: true,
  readinessPercent: 100,
  blockerCount: 0,
  scheduleVersionCount: 2,
  publishedVersionCount: 1,
});
assert.equal(published.nextStage.id, "publish");
assert.ok(published.stages.every((stage) => stage.status === "complete"));

const layout = read("src/components/app-layout.tsx");
assert.ok(layout.includes("المسار الأساسي"), "simple navigation is the default surface");
assert.ok(layout.includes("الأدوات المتقدمة"), "advanced tools remain discoverable");
assert.ok(layout.includes('to: "/data-onboarding"'), "prepare route remains available");
assert.ok(layout.includes('to: "/schedule-builder"'), "builder route remains available");
assert.ok(layout.includes('to: "/schedule-versions"'), "review route remains available");
assert.ok(layout.includes('to: "/published-schedules"'), "publish route remains available");
assert.ok(
  layout.includes('roles: ["super_admin", "college_admin"]') ||
    layout.includes('roles: ["super_admin", "college_admin", "institutional_viewer"]'),
  "admin-only gates remain",
);

const dashboard = read("src/routes/_authenticated/dashboard.tsx");
assert.ok(dashboard.includes("resolveCoreWorkflow"), "dashboard uses the pure workflow summary");
assert.ok(dashboard.includes("الخطوة التالية"), "dashboard surfaces one next action");

const versions = read("src/routes/_authenticated/schedule-versions.tsx");
assert.ok(
  versions.includes('navigate({ to: "/schedule-builder"'),
  "new schedule versions open in the primary V2 builder",
);

for (const source of [layout, dashboard, versions]) {
  assert.equal(source.includes('.from("schedule_sessions").update('), false);
  assert.equal(source.includes('.from("schedule_versions").delete('), false);
}

console.log("PASS core-workflow-simplification.harness.ts");

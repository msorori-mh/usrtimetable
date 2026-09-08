/**
 * Product-closure static contract. It prevents New Flow terminology/Legacy,
 * unsafe PostgREST embeds, RBAC, and auto-schedule readiness regressions.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPrimaryNavigationSource } from "./nav-source";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const newFlowFiles = [
  "src/routes/_authenticated/academic-cohorts.tsx",
  "src/routes/_authenticated/delivery-groups.tsx",
  "src/routes/_authenticated/teaching-assignments.tsx",
  "src/routes/_authenticated/data-readiness.tsx",
  "src/routes/_authenticated/schedule-builder.tsx",
  "src/routes/_authenticated/auto-schedule.tsx",
  "src/lib/reports/readiness.ts",
  "src/lib/schedule-builder/v2-assignment-service.ts",
];
const newFlowSource = newFlowFiles.map(read).join("\n");

for (const phrase of ["توليد منهج الدفعة", "course offering", "section group"]) {
  assert.equal(newFlowSource.toLowerCase().includes(phrase.toLowerCase()), false, phrase);
}
assert.equal(/["'>]\s*الشعبة\s*[<"]/.test(newFlowSource), false, "visible شعبة in New Flow");

for (const legacyTable of [
  '.from("sections")',
  '.from("course_offering_sections")',
  '.from("section_groups")',
]) {
  assert.equal(newFlowSource.includes(legacyTable), false, `New Flow Legacy read: ${legacyTable}`);
}

const autoSchedule = read("src/routes/_authenticated/auto-schedule.tsx");
assert.ok(autoSchedule.includes("fetchCollegeReadiness"), "auto-schedule loads readiness");
assert.ok(autoSchedule.includes("runV2AutoSchedule"), "auto-schedule invokes V2 identity path");
assert.equal(
  autoSchedule.includes("runGreedyAutoSchedule"),
  false,
  "Legacy greedy path is not operational",
);
assert.ok(autoSchedule.includes("readinessIncomplete"), "auto-schedule computes fail-closed gate");
assert.ok(
  autoSchedule.includes('data-testid="auto-schedule-readiness-blocker"'),
  "readiness blocker is visible",
);

const layout = readPrimaryNavigationSource(root);
assert.match(layout, /to:\s*"\/users"[\s\S]*roles:\s*\["super_admin"(,\s*"institutional_viewer")?\]/);
assert.match(layout, /to:\s*"\/auto-schedule"[\s\S]*roles:\s*\["super_admin",\s*"college_admin"(,\s*"institutional_viewer")?\]/);
assert.equal(/to:\s*"\/sections"/.test(layout), false, "Legacy route hidden from navigation");

const postgrestFiles = [
  "src/routes/_authenticated/academic-cohorts.tsx",
  "src/routes/_authenticated/delivery-groups.tsx",
  "src/routes/_authenticated/teaching-assignments.tsx",
];
for (const relative of postgrestFiles) {
  const source = read(relative);
  assert.equal(
    /academic_programs\s*\(/.test(source),
    false,
    `${relative}: academic cohorts/program embed must use an explicit FK or separate query`,
  );
  assert.equal(
    /course_offerings\s*\([^)]*courses\s*\(/s.test(source),
    false,
    `${relative}: New Flow course_offerings → courses embed`,
  );
}

console.log("PASS platform-product-closure.harness.ts");

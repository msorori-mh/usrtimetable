/**
 * Static inventory harness — admin routes & NAV labels.
 * Read-only; does not mutate product behavior.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const layout = read("src/components/app-layout.tsx");
const navToMatches = [...layout.matchAll(/to:\s*"([^"]+)"/g)].map((m) => m[1]);
const navLabelMatches = [...layout.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);

assert.ok(navToMatches.length >= 35, `expected >=35 nav routes, got ${navToMatches.length}`);
assert.ok(navLabelMatches.includes("الدفعات الأكاديمية"), "cohorts must appear in NAV");
assert.ok(navLabelMatches.includes("مجموعات التدريس"), "delivery groups must appear in NAV");
assert.ok(
  navLabelMatches.includes("المجموعات الدراسية"),
  "Legacy sections label currently present — inventory must detect it for remediation tracking",
);

const authDir = path.join(root, "src/routes/_authenticated");
const routeFiles = readdirSync(authDir).filter((f) => f.endsWith(".tsx"));
assert.ok(routeFiles.length >= 50, `expected >=50 authenticated route modules, got ${routeFiles.length}`);

const requiredRoutes = [
  "academic-cohorts.tsx",
  "delivery-groups.tsx",
  "teaching-assignments.tsx",
  "schedule-builder.tsx",
  "sections.tsx",
  "time-slots.tsx",
  "time-slot-templates.tsx",
  "data-templates.tsx",
  "import.tsx",
  "import-templates.tsx",
];
for (const f of requiredRoutes) {
  assert.ok(routeFiles.includes(f), `missing route module ${f}`);
}

// faculty_workload_policies admin page is a documented gap (report routes may contain "workload").
const hasWorkloadPoliciesRoute = routeFiles.some(
  (f) =>
    f === "workload-policies.tsx" ||
    f === "faculty-workload-policies.tsx" ||
    f.includes("workload-polic"),
);
assert.equal(
  hasWorkloadPoliciesRoute,
  false,
  "expected no faculty_workload_policies admin route (documented gap)",
);

const registry = read("src/lib/excel-import/registry.ts");
assert.ok(registry.includes("ACTIVE_NEW_FLOW_ENTITIES"), "import registry present");
assert.ok(registry.includes("LEGACY_ONLY_ENTITIES"), "legacy import classification present");
assert.ok(registry.includes("GENERATED_NOT_IMPORTED"), "generated classification present");

console.log(
  JSON.stringify(
    {
      harness: "admin-routes-inventory",
      navRoutes: navToMatches.length,
      navLabels: navLabelMatches.length,
      authenticatedRouteModules: routeFiles.length,
      legacySectionsInNav: navLabelMatches.includes("المجموعات الدراسية"),
      workloadPoliciesRoutePresent: hasWorkloadPoliciesRoute,
      status: "pass",
    },
    null,
    2,
  ),
);

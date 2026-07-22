/**
 * A3.5: Faculty workload policies UI + import gap G1 fix — static harness.
 *
 * Static inspection only (no runtime gates, no DB, no Supabase client):
 *  - route/lib files exist and are wired (nav, route tree, harness registry)
 *  - writes go through the A3 RPCs only (no direct DML on faculty_workload_policies)
 *  - every RPC used by the UI is defined in the source-only A3 migration
 *  - no Legacy references (sections/section_id/section_number/…) in the new files
 *  - official terminology + readiness-blocker documentation
 *  - G1: inbound formula-injection sanitation wired into the import parse path
 */
import { readFileSync, existsSync } from "node:fs";

const ROUTE = "src/routes/_authenticated/workload-policies.tsx";
const API = "src/lib/faculty-workload/api.ts";
const TYPES = "src/lib/faculty-workload/types.ts";
const RULES = "src/lib/faculty-workload/rules.ts";
const NAV = "src/components/app-layout.tsx";
const TREE = "src/routeTree.gen.ts";
const RUN = "tests/harness/run.mjs";
const MIG = "supabase/migrations/20260722110000_source_only_faculty_workload_policies.sql";
const FORMULA = "src/lib/excel-import/formula-escape.ts";
const TEMPLATES = "src/lib/excel-import/templates.ts";
const REPORT = "implementation-reports/USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01/A3-WORKLOAD-UI-01.md";

const A3_RPCS = [
  "upsert_faculty_workload_policy",
  "deactivate_faculty_workload_policy",
  "resolve_faculty_workload_policy",
  "list_faculty_workload_assigned_hours",
  "list_faculty_workload_overload_warnings",
];

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

for (const file of [ROUTE, API, TYPES, RULES, REPORT]) {
  check(`file exists: ${file}`, existsSync(file), file);
}

const allPresent = [ROUTE, API, TYPES, RULES, NAV, TREE, RUN, MIG, FORMULA, TEMPLATES].every(
  (file) => existsSync(file),
);

if (allPresent) {
  const route = readFileSync(ROUTE, "utf8");
  const api = readFileSync(API, "utf8");
  const types = readFileSync(TYPES, "utf8");
  const rules = readFileSync(RULES, "utf8");
  const nav = readFileSync(NAV, "utf8");
  const tree = readFileSync(TREE, "utf8");
  const run = readFileSync(RUN, "utf8");
  const mig = readFileSync(MIG, "utf8");
  const formula = readFileSync(FORMULA, "utf8");
  const templates = readFileSync(TEMPLATES, "utf8");

  // RPC-only writes: every A3 RPC used by the UI exists in the migration
  for (const fn of A3_RPCS) {
    check(`UI uses RPC ${fn}`, api.includes(`"${fn}"`), `${fn} referenced in api.ts`);
    check(
      `RPC ${fn} defined in A3 migration`,
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`, "i").test(mig),
      "contract cross-check",
    );
  }

  // No direct DML on faculty_workload_policies anywhere in the new UI layer
  const dmlRe =
    /\.from\(\s*["'`]faculty_workload_policies["'`]\s*\)\s*\.\s*(insert|update|delete|upsert)/;
  check("route: no direct DML on faculty_workload_policies", !dmlRe.test(route), "RPC-only writes");
  check("api: RPC-only (no table access at all)", !api.includes(".from("), "api.ts has no .from(");
  check(
    "route: policy list via read-only SELECT",
    /\.from\("faculty_workload_policies"\)\s*\n?\s*\.select\(/.test(route),
    "RLS SELECT stays granted; reads allowed",
  );

  // Role reflection (enforcement stays in RPC/RLS)
  check(
    "role reflection via useCanManageActiveCollege",
    route.includes("useCanManageActiveCollege"),
    "college_admin manage, read_only view-only; super_admin via college switcher",
  );
  check("college switcher present", route.includes("CollegeSwitcher"), "college scoping");

  // Readiness blocker documented in the UI
  check(
    "readiness blocker banner (NOT APPLIED)",
    route.includes("NOT APPLIED") && route.includes("APPROVE_DB_MIGRATION_APPLY"),
    "source-only RPC layer documented in the page",
  );
  check(
    "overload is advisory (warning, not block)",
    route.includes("تحذير") && route.includes("ليس حظرًا"),
    "overload warning doctrine",
  );

  // No Legacy references in the new files
  const legacyRe = /section_id|section_number|course_offering_sections|section_groups|\bsections\b/i;
  for (const [label, text] of [
    ["route", route],
    ["api", api],
    ["types", types],
    ["rules", rules],
  ] as const) {
    check(`no Legacy references in ${label}`, !legacyRe.test(text), "no sections/section_id in New Flow");
  }

  // Official terminology
  check(
    "title terminology (النصاب حسب الدرجة الأكاديمية)",
    route.includes("النصاب التدريسي حسب الدرجة الأكاديمية"),
    "official workload terminology",
  );
  check(
    "assigned-hours source terminology (الإسناد التدريسي)",
    route.includes("الإسناد التدريسي"),
    "official assignment terminology",
  );
  check(
    "study-system values regular/parallel kept distinct",
    rules.includes('"regular"') && rules.includes('"parallel"'),
    "no regular/parallel mixing",
  );

  // Wiring
  check("nav entry", nav.includes('to: "/workload-policies"') && nav.includes("النصاب التدريسي"), "app-layout NAV");
  check("route tree registration", tree.includes("workload-policies"), "routeTree.gen.ts");
  check(
    "harness registered in run.mjs",
    run.includes("faculty-workload-ui.harness.ts"),
    "tests/harness/run.mjs",
  );

  // G1: inbound formula-injection sanitation
  check(
    "G1: inbound sanitizer exported",
    formula.includes("export function sanitizeImportCellValue"),
    "formula-escape.ts",
  );
  check(
    "G1: export-side escape preserved",
    formula.includes("export function escapeSpreadsheetCell"),
    "no regression on export side",
  );
  check(
    "G1: parse path sanitizes inbound cells",
    templates.includes("sanitizeImportCellValue") && /sanitizedCells/.test(templates),
    "templates.ts parseExcel",
  );
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  — ${c.detail}`);
}
console.log(
  JSON.stringify({
    harness: "faculty-workload-ui",
    checksRun: checks.length,
    failed: failed.length,
    mode: "static-only",
  }),
);
if (failed.length > 0) process.exit(1);

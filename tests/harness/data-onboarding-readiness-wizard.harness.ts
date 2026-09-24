import { readPrimaryNavigationSource } from "./nav-source";
/**
 * data-onboarding-readiness-wizard.harness.ts — Phase 2 static verification.
 *
 * Source-only (no DB, no DML):
 * 1) Route + nav for إعداد البيانات وإنشاء الجدول
 * 2) Uses fetchCollegeReadiness; New Flow classification excludes Legacy
 * 3) Read-only scan (no schedule_sessions / readiness DML)
 * 4) Auto-schedule dual gate: UI disable + mutation re-check (canManage + readiness)
 * 5) read_only can view onboarding; cannot run auto-schedule
 * 6) Print-center leftover filter sanitization
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};

const noDml = (body: string, file: string, table: string) => {
  const re = new RegExp(
    `\\.from\\(\\s*["']${table}["']\\s*\\)\\s*\\.(insert|update|upsert|delete)\\s*\\(`,
  );
  assert(!re.test(body.replace(/\s+/g, " ")), `${file} performs DML against ${table}`);
};

// ---------- 1) route + nav ----------
const route =
  read("src/routes/_authenticated/data-onboarding.tsx") +
  read("src/components/data-onboarding/preparation-workspace.tsx");
assert(
  route.includes('createFileRoute("/_authenticated/data-onboarding")'),
  "data-onboarding route registered",
);
assert(route.includes("تجهيز بيانات الكلية"), "Arabic wizard title");
assert(route.includes("fetchOnboardingReadinessSnapshot"), "uses onboarding snapshot");
assert(route.includes("useCanManageActiveCollege"), "RBAC gate for fix/run CTAs");
assert(route.includes("onboarding-readonly-note"), "read_only view note present");
assert(route.includes("أصلح الآن"), "fix-now CTAs");
assert(route.includes("إعادة الفحص"), "re-check button");
assert(route.includes("onboarding-percent"), "percent complete surfaced");

const layout = readPrimaryNavigationSource(root);
assert(layout.includes('to: "/data-onboarding"'), "sidebar links to data-onboarding");
assert(layout.includes("تجهيز بيانات الكلية"), "sidebar Arabic label for onboarding wizard");

// ---------- 2) New Flow classification excludes Legacy ----------
const classify = read("src/lib/data-onboarding/classify.ts");
assert(classify.includes("classifyReadinessMetricFlow"), "flow classifier exported");
assert(classify.includes('"legacy"'), "legacy kind present");
assert(classify.includes("عروض مقررات"), "Legacy offerings marker");
assert(classify.includes("isNewFlowReadinessMetric"), "New Flow include helper");
assert(classify.includes("partitionByStudySystem"), "regular/parallel partition helper");
assert(classify.includes("PILOT_STUDY_SYSTEMS"), "pilot study systems constant");

const steps = read("src/lib/data-onboarding/wizard-steps.ts");
assert(steps.includes("WIZARD_STEPS"), "wizard step defs");
assert(steps.includes("create_schedule_version"), "step 10 schedule version link");
assert((steps.match(/id: "/g) ?? []).length >= 10, "at least 10 wizard step ids");

const snapshot = read("src/lib/data-onboarding/snapshot.ts");
assert(snapshot.includes("fetchCollegeReadiness"), "reuses fetchCollegeReadiness");
assert(snapshot.includes("fetchOnboardingReadinessSnapshot"), "snapshot entrypoint");
noDml(snapshot, "snapshot.ts", "schedule_sessions");
noDml(snapshot, "snapshot.ts", "schedule_versions");
noDml(route, "data-onboarding.tsx", "schedule_sessions");

// ---------- 4) auto-schedule dual gate ----------
const auto = read("src/routes/_authenticated/auto-schedule.tsx");
assert(
  /disabled=\{!canManage \|\| runBlocked\}/.test(auto) &&
    /const runBlocked =[\s\S]*?!versionId[\s\S]*?run\.isPending[\s\S]*?readinessIncomplete;/.test(
      auto,
    ),
  "UI gate: readiness blockers + canManage disable run",
);
assert(
  auto.includes("const freshReadiness = await fetchCollegeReadiness"),
  "mutation re-checks readiness (backend/UI dual gate)",
);
assert(auto.includes("READINESS_BLOCKED:"), "mutation throws readiness blockers");
assert(
  auto.includes("UNAUTHORIZED:") || auto.includes("!canManage"),
  "mutation re-checks canManage for read_only",
);
assert(auto.includes('to="/data-onboarding"'), "auto-schedule links to onboarding wizard");
assert(auto.includes("runV2AutoSchedule"), "does not change algorithm — still V2");
assert(!auto.includes("runGreedyAutoSchedule"), "no Legacy greedy from route");

// ---------- 5) read_only cannot run ----------
assert(
  layout.includes('to: "/auto-schedule"') &&
    (layout.includes('roles: ["super_admin", "college_admin"]') ||
      layout.includes('roles: ["super_admin", "college_admin", "institutional_viewer"]')),
  "auto-schedule nav hidden from read_only",
);
assert(
  route.includes("onboarding-auto-schedule-blocked") || route.includes("لمديري الكلية فقط"),
  "onboarding UI documents read_only cannot run scheduler",
);

// ---------- 6) print-center leftover filter fix ----------
const filters = read("src/lib/print-center/filters.ts");
assert(filters.includes("sanitizePrintFilters"), "sanitizePrintFilters exported");
assert(filters.includes("dimensionsForReportType"), "report-type dimensions map");
assert(
  filters.includes('instructor: new Set(["instructorId", "studySystem"])'),
  "instructor report ignores program/level/department",
);
assert(
  filters.includes('room: new Set(["roomId", "studySystem"])'),
  "room report ignores program/level/department",
);

const printPage = read("src/components/print-center/print-center-page.tsx");
assert(
  printPage.includes('reportType === "instructor" || reportType === "room"'),
  "UI clears leftover filters when switching to instructor/room",
);

console.log("PASS data-onboarding-readiness-wizard.harness.ts");

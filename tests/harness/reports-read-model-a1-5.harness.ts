/**
 * reports-read-model-a1-5.harness.ts — A1.5 static verification (source-only).
 *
 * Verifies, from source only (no DB access, no migration apply):
 *  1) Reports hub reclassification: Legacy section-based reports live under
 *     LEGACY_REPORTS with the legacy badge; New Flow hub entries reference
 *     cohort/DG filtering instead of Legacy sections.
 *  2) Legacy historical reports (section timetable, department schedule) are
 *     explicitly marked Legacy/read-only and retain their historical SELECT
 *     behavior unchanged (no DML, no removal).
 *  3) New Flow timetable read model never joins Legacy `sections`: shared
 *     selects project cohort_id/delivery_group_id, program-level and published
 *     queries filter by cohort/DG, and the Legacy projection survives only in
 *     LEGACY_TIMETABLE_SESSION_SELECT for the historical report.
 *  4) Cohort/DG labels resolve via batched tenant-scoped lookups (no fragile
 *     embeds) and flow into mappers, table headers, grid and exports.
 *  5) Readiness surfaces (reports + dashboard) include New Flow cohort/DG/TA V2
 *     metrics with a fail-closed fallback.
 *  6) The conflicts report keeps its intentionally-retained diagnostic Legacy
 *     section evidence (read-only), and no other report surface references
 *     Legacy sections.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};
/** Extract the text between two markers (throws when a marker is missing). */
const between = (body: string, start: string, end: string) => {
  const i = body.indexOf(start);
  assert(i >= 0, `marker not found: ${start.slice(0, 60)}`);
  const j = body.indexOf(end, i + start.length);
  assert(j >= 0, `end marker not found after: ${start.slice(0, 60)}`);
  return body.slice(i, j);
};
const noDml = (body: string, file: string, table: string) => {
  const re = new RegExp(
    `\\.from\\(\\s*["']${table}["']\\s*\\)\\s*\\.(insert|update|upsert|delete)\\s*\\(`,
  );
  assert(!re.test(body.replace(/\s+/g, " ")), `${file} performs DML against ${table}`);
};

// ---------- 1) hub reclassification ----------
const hub = read("src/routes/_authenticated/reports.index.tsx");
const hubTimetable = between(hub, "const TIMETABLE_REPORTS", "const ANALYTICS_REPORTS");
assert(
  !hubTimetable.includes("/reports/section-timetable"),
  "section timetable removed from New Flow TIMETABLE_REPORTS",
);
const hubLegacy = between(hub, "const LEGACY_REPORTS", "const SECTIONS");
assert(
  hubLegacy.includes('to: "/reports/section-timetable"') && hubLegacy.includes('badge: "legacy"'),
  "section timetable listed under LEGACY_REPORTS with legacy badge",
);
assert(
  hubLegacy.includes('to: "/reports/department-schedule"'),
  "department schedule remains under LEGACY_REPORTS",
);
assert(
  hubLegacy.split('badge: "legacy"').length - 1 === 2,
  "exactly two legacy-badged report cards (section timetable + department schedule)",
);
assert(
  hubTimetable.includes("دفعة دراسية/مجموعة محاضرات ومعامل"),
  "program-level hub card advertises cohort/DG filtering",
);

// ---------- 2) Legacy historical reports marked + retained read-only ----------
const sectionReport = read("src/routes/_authenticated/reports.section-timetable.tsx");
assert(
  sectionReport.includes("تقرير Legacy — للعرض التاريخي فقط (A1.5)"),
  "section timetable carries an explicit Legacy banner",
);
assert(
  sectionReport.includes('meta: [{ title: "Legacy — تقرير جدول المجموعة (تاريخي)" }]'),
  "section timetable head title marked Legacy",
);
assert(
  sectionReport.includes('.from("sections")') &&
    sectionReport.includes("fetchSectionTimetableSessions"),
  "historical sections SELECT retained for the Legacy report (read-only)",
);
noDml(sectionReport, "reports.section-timetable.tsx", "sections");

const deptReport = read("src/routes/_authenticated/reports.department-schedule.tsx");
assert(
  deptReport.includes("تقرير Legacy — لم يُرحّل ويُزال بعد الإطلاق (A1.5)"),
  "department schedule carries an explicit Legacy banner",
);
assert(
  deptReport.includes('meta: [{ title: "Legacy — تقرير جدول الأقسام (تاريخي)" }]'),
  "department schedule head title marked Legacy",
);
assert(
  deptReport.includes("sections(section_number)"),
  "historical sections projection retained for the Legacy department report (read-only)",
);
noDml(deptReport, "reports.department-schedule.tsx", "sections");

// ---------- 3) New Flow read model never joins Legacy sections ----------
const queries = read("src/lib/reports/queries/session-queries.ts");
const newFlowSelect = between(queries, "export const TIMETABLE_SESSION_SELECT", "as const");
assert(
  newFlowSelect.includes("cohort_id") && newFlowSelect.includes("delivery_group_id"),
  "TIMETABLE_SESSION_SELECT projects cohort_id + delivery_group_id",
);
assert(
  !newFlowSelect.includes("sections("),
  "TIMETABLE_SESSION_SELECT never joins Legacy sections",
);
assert(
  !/course_offerings\s*\([^)]*courses\s*\(/i.test(newFlowSelect.replace(/\s+/g, " ")),
  "TIMETABLE_SESSION_SELECT never nests courses() under course_offerings (PGRST200)",
);
assert(
  queries.includes("hydrateWorkspaceSessions"),
  "session queries hydrate course labels via separate lookups",
);
const legacySelect = between(queries, "export const LEGACY_TIMETABLE_SESSION_SELECT", "as const");
assert(
  legacySelect.includes("section_id") &&
    !/course_offerings\s*\([^)]*courses\s*\(/i.test(legacySelect.replace(/\s+/g, " ")),
  "LEGACY_TIMETABLE_SESSION_SELECT retains section_id without nested courses() embed",
);
const legacyFetch = between(
  queries,
  "export async function fetchSectionTimetableSessions",
  "export async function",
);
assert(
  legacyFetch.includes("select: LEGACY_TIMETABLE_SESSION_SELECT"),
  "Legacy section report fetches via the Legacy projection only",
);
const programFetch = between(
  queries,
  "export async function fetchProgramLevelTimetableSessions",
  "/** Analytics:",
);
assert(
  programFetch.includes("cohortId:") && programFetch.includes("deliveryGroupId:"),
  "program-level query filters by cohort_id / delivery_group_id",
);
assert(
  !programFetch.includes("sectionId:"),
  "program-level query has no Legacy section filter left",
);
const publishedSelect = between(queries, "export const PUBLISHED_TIMETABLE_SELECT", "as const");
assert(
  publishedSelect.includes("cohort_id") &&
    publishedSelect.includes("delivery_group_id") &&
    !publishedSelect.includes("sections("),
  "PUBLISHED_TIMETABLE_SELECT is cohort/DG based (no sections join)",
);
const publishedFetch = between(
  queries,
  "export async function fetchPublishedTimetableSessions",
  "/** Resolved New Flow identity labels",
);
assert(
  publishedFetch.includes("cohortId:") &&
    publishedFetch.includes("deliveryGroupId:") &&
    !publishedFetch.includes("sectionId:"),
  "published timetable query filters by cohort/DG, never section_id",
);
assert(
  queries.includes("export async function fetchCohortDeliveryGroupLabels"),
  "cohort/DG label resolver exists",
);
const labelFetch = between(queries, "export async function fetchCohortDeliveryGroupLabels", "\n}");
assert(
  labelFetch.includes('.from("academic_cohorts")') &&
    labelFetch.includes('.from("delivery_groups")'),
  "labels resolve from academic_cohorts + delivery_groups",
);
assert(
  labelFetch.split('.eq("college_id"').length - 1 >= 2,
  "label lookups are tenant-scoped (college_id on both lookups)",
);

// ---------- 4) mappers / headers / grid carry the New Flow identity ----------
const mappers = read("src/lib/reports/session-mappers.ts");
assert(
  mappers.includes("cohort_label") && mappers.includes("delivery_group_label"),
  "TimetableReportSession carries cohort/DG labels",
);
assert(
  mappers.includes("export const NEW_FLOW_TIMETABLE_TABLE_HEADERS"),
  "New Flow headers exported",
);
const newFlowHeaders = between(mappers, "export const NEW_FLOW_TIMETABLE_TABLE_HEADERS", "];");
assert(
  newFlowHeaders.includes("الدفعة الدراسية") && newFlowHeaders.includes("مجموعة المحاضرات/المعامل"),
  "New Flow headers show cohort + delivery-group columns",
);
assert(
  !newFlowHeaders.includes('{ key: "section"'),
  "New Flow headers drop the Legacy sections column",
);
const legacyHeaders = between(mappers, "export const TIMETABLE_TABLE_HEADERS", "];");
assert(
  legacyHeaders.includes('{ key: "section", label: "المجموعة" }'),
  "Legacy headers retained unchanged for the historical report",
);
assert(
  mappers.includes("cohort: s.cohort_label") &&
    mappers.includes("delivery_group: s.delivery_group_label"),
  "export rows carry cohort/DG values",
);

const grid = read("src/components/reports/timetable-grid-report.tsx");
assert(
  grid.includes("sess.cohort_label") && grid.includes("sess.delivery_group_label"),
  "weekly grid displays cohort/DG identity",
);

// ---------- 5) New Flow routes: no Legacy sections, cohort/DG wired ----------
const newFlowRoutes = [
  "src/routes/_authenticated/reports.instructor-schedule.tsx",
  "src/routes/_authenticated/reports.room-timetable.tsx",
  "src/routes/_authenticated/reports.program-level-timetable.tsx",
  "src/routes/_authenticated/reports.published-timetable.tsx",
];
for (const rel of newFlowRoutes) {
  const body = read(rel);
  assert(!body.includes('.from("sections")'), `${rel} queries no Legacy sections table`);
  assert(!body.includes("sections("), `${rel} embeds no Legacy sections projection`);
  assert(!body.includes("section_id"), `${rel} references no section_id`);
  assert(body.includes("fetchCohortDeliveryGroupLabels"), `${rel} resolves cohort/DG labels`);
}
for (const rel of [
  "src/routes/_authenticated/reports.instructor-schedule.tsx",
  "src/routes/_authenticated/reports.room-timetable.tsx",
  "src/routes/_authenticated/reports.program-level-timetable.tsx",
]) {
  const body = read(rel);
  assert(
    body.split("NEW_FLOW_TIMETABLE_TABLE_HEADERS").length - 1 >= 2,
    `${rel} uses NEW_FLOW_TIMETABLE_TABLE_HEADERS for shell + view`,
  );
}
const programRoute = read("src/routes/_authenticated/reports.program-level-timetable.tsx");
const programFilters = read("src/lib/reports/program-timetable-filters.ts");
assert(
  programRoute.includes('.from("academic_cohorts")') &&
    programRoute.includes("fetchProgramLevelTimetableSessions") &&
    programRoute.includes("deriveProgramTimetable") &&
    programRoute.includes("fetchCohortDeliveryGroupLabels"),
  "program-level options derive from scoped cohorts and labeled version sessions",
);
assert(
  !programRoute.includes('.from("delivery_groups")') &&
    programFilters.includes("s.delivery_group_id") &&
    programFilters.includes("cohortsById.has(s.cohort_id)"),
  "program-level group options require a scheduled group in an eligible cohort",
);
const publishedRoute = read("src/routes/_authenticated/reports.published-timetable.tsx");
assert(
  publishedRoute.includes('.from("academic_cohorts")') &&
    publishedRoute.includes('.from("delivery_groups")'),
  "published filter sources are cohorts + delivery groups",
);
assert(
  publishedRoute.includes("fetchHydratedVersionSessions") &&
    publishedRoute.includes("s.cohort_id === cohortId") &&
    publishedRoute.includes("s.delivery_group_id === dgId"),
  "published hydrated query filters by cohort/DG",
);
assert(
  publishedRoute.includes('{ key: "cohort", label: "الدفعة الدراسية" }'),
  "published table/export headers show the cohort column",
);

// ---------- 6) readiness New Flow metrics (fail-closed) ----------
const readiness = read("src/lib/reports/readiness.ts");
assert(
  readiness.includes("async function fetchNewFlowSignals") &&
    readiness.includes("NEW_FLOW_READINESS_QUERY_FAILED"),
  "readiness New Flow fetch is fail-closed (throws the query error)",
);
assert(
  readiness.includes("export function newFlowReadinessMetrics"),
  "New Flow readiness metrics exported",
);
assert(
  readiness.includes('.from("academic_cohorts")') &&
    readiness.includes('.from("delivery_groups")') &&
    readiness.includes('.not("delivery_group_id", "is", null)'),
  "readiness queries cohort/DG/TA V2 sources",
);
for (const label of [
  "دفعات دراسية نشطة بدون مجموعات محاضرات/معامل",
  "مجموعات محاضرات/معامل بدون إسناد تدريسي (V2)",
  "إسناد تدريسي (V2) بدون محاضر",
  "محاضرات بدون هوية دفعة/مجموعة (توافقية)",
]) {
  assert(readiness.includes(label), `readiness reports New Flow metric: ${label}`);
}
assert(
  readiness.includes("scheduling.push(...newFlowReadinessMetrics(newFlowSignals))"),
  "New Flow metrics feed the scheduling category",
);

const dashboard = read("src/routes/_authenticated/data-readiness.tsx");
assert(
  dashboard.includes("async function fetchNewFlowMetrics") &&
    dashboard.includes("sch.push(...(await fetchNewFlowMetrics(collegeId)))"),
  "dashboard readiness includes the same fail-closed New Flow metrics",
);
assert(
  dashboard.includes("دفعات دراسية نشطة بدون مجموعات محاضرات/معامل"),
  "dashboard surfaces New Flow cohort coverage",
);

// ---------- 7) conflict Legacy evidence retained; other surfaces stay clean ----------
const operational = read("src/lib/reports/queries/operational-queries.ts");
const conflictSelect = between(
  operational,
  "const CONFLICT_SESSION_SELECT",
  "async function fetchSessionsByIds",
);
assert(
  conflictSelect.includes("section_id") &&
    !/course_offerings\s*\([^)]*courses\s*\(/i.test(conflictSelect.replace(/\s+/g, " ")) &&
    !conflictSelect.includes("instructors(") &&
    operational.includes("hydrateWorkspaceSessions"),
  "conflict read model keeps section_id evidence via flat+hydrate (no nested courses/instructors embeds)",
);
const conflictsRoute = read("src/routes/_authenticated/reports.conflicts.tsx");
assert(
  conflictsRoute.includes('{ key: "legacy_section", label: "Legacy section" }'),
  "conflicts report labels the section column as Legacy evidence",
);
noDml(operational, "operational-queries.ts", "sections");

for (const rel of [
  "src/routes/_authenticated/reports.unscheduled.tsx",
  "src/routes/_authenticated/reports.quality-summary.tsx",
  "src/routes/_authenticated/reports.instructor-workload.tsx",
  "src/routes/_authenticated/reports.room-utilization.tsx",
  "src/routes/_authenticated/reports.data-readiness.tsx",
  "src/routes/_authenticated/reports.conflicts.tsx",
]) {
  const body = read(rel);
  assert(!body.includes('.from("sections")'), `${rel} never queries Legacy sections`);
}

// ---------- 8) runner registration ----------
const runner = read("tests/harness/run.mjs");
assert(
  runner.includes('"reports-read-model-a1-5.harness.ts",'),
  "harness registered in tests/harness/run.mjs",
);

console.log("reports-read-model-a1-5.harness.ts: PASS");

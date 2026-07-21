import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const ROUTES = "src/routes/_authenticated";
const QUERIES = "src/lib/reports/queries";
const LEGACY_TAG = "Legacy — للعرض التاريخي";

/**
 * A1-S5 — Reports data-source guard.
 *
 * Leadership scope decisions: `sections`, `course_offering_sections`, and TA V1
 * (teaching_assignments carrying section_id) are Legacy-only. Active reports
 * (not tagged Legacy) must source the group dimension from delivery_groups
 * (مجموعات المحاضرات والمعامل) and never read the Legacy sections model.
 * Purely historical reports keep their source but must carry the explicit
 * «Legacy — للعرض التاريخي» tag (same pattern as PR #59 sections.tsx).
 */

/** Forbidden Legacy read patterns on active report surfaces. */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/from\(\s*["']sections["']\s*\)/, 'queries the Legacy "sections" table'],
  [
    /from\(\s*["']course_offering_sections["']\s*\)/,
    'queries the Legacy "course_offering_sections" table',
  ],
  [/\bsections\s*\(/, "embeds the Legacy sections(...) relation"],
  [/\bsection_id\b/, "references the Legacy section_id column"],
];

/** Active (non-Legacy-tagged) report routes and their query-layer modules. */
const ACTIVE_REPORT_FILES = [
  `${ROUTES}/reports.index.tsx`,
  `${ROUTES}/reports.instructor-schedule.tsx`,
  `${ROUTES}/reports.room-timetable.tsx`,
  `${ROUTES}/reports.program-level-timetable.tsx`,
  `${ROUTES}/reports.published-timetable.tsx`,
  `${ROUTES}/reports.instructor-workload.tsx`,
  `${ROUTES}/reports.room-utilization.tsx`,
  `${ROUTES}/reports.conflicts.tsx`,
  `${ROUTES}/reports.unscheduled.tsx`,
  `${ROUTES}/reports.quality-summary.tsx`,
  `${ROUTES}/reports.data-readiness.tsx`,
  `${QUERIES}/session-queries.ts`,
  `${QUERIES}/operational-queries.ts`,
  `${QUERIES}/version-queries.ts`,
  "src/lib/reports/readiness.ts",
  "src/lib/reports/session-mappers.ts",
];

for (const rel of ACTIVE_REPORT_FILES) {
  const content = read(rel);
  for (const [pattern, why] of FORBIDDEN) {
    assert.equal(pattern.test(content), false, `${rel} ${why}`);
  }
}

/** Legacy-tagged reports must carry the explicit tag (sections.tsx pattern). */
for (const rel of [
  `${ROUTES}/reports.section-timetable.tsx`,
  `${ROUTES}/reports.department-schedule.tsx`,
]) {
  assert.ok(read(rel).includes(LEGACY_TAG), `${rel} must carry the explicit tag: ${LEGACY_TAG}`);
}

/** Reference anchor (PR #59): the sections page itself stays Legacy-tagged. */
assert.ok(
  read(`${ROUTES}/sections.tsx`).includes(LEGACY_TAG),
  "sections.tsx reference page must stay Legacy-tagged",
);

/** Historical section reads are quarantined in one explicitly-marked module. */
const legacyQueries = read(`${QUERIES}/legacy-session-queries.ts`);
assert.ok(
  legacyQueries.includes(LEGACY_TAG),
  "legacy-session-queries.ts must be marked Legacy — للعرض التاريخي",
);
assert.ok(
  legacyQueries.includes("section_id") && legacyQueries.includes("sections(section_number)"),
  "legacy-session-queries.ts is the designated home of historical section reads",
);

/** Reports hub badges both historical reports as legacy (titles unchanged). */
const hub = read(`${ROUTES}/reports.index.tsx`);
for (const route of ["/reports/section-timetable", "/reports/department-schedule"]) {
  const cardPattern = new RegExp(
    `to:\s*"${route.replace(/\//g, "\\/")}"[\s\S]{0,500}?badge:\s*"legacy"`,
  );
  assert.ok(cardPattern.test(hub), `hub card for ${route} must carry badge: "legacy"`);
}

/** V2 wiring: the group dimension flows from delivery_groups in active reports. */
const sessionQueries = read(`${QUERIES}/session-queries.ts`);
assert.ok(
  sessionQueries.includes("delivery_group_id"),
  "active timetable select carries delivery_group_id",
);
assert.ok(
  sessionQueries.includes('from("delivery_groups")'),
  "delivery-group options query reads delivery_groups",
);
const mappers = read("src/lib/reports/session-mappers.ts");
assert.ok(
  mappers.includes("deliveryGroupLabels"),
  "timetable mapper accepts delivery-group labels (V2-first group label)",
);
for (const rel of [
  `${ROUTES}/reports.program-level-timetable.tsx`,
  `${ROUTES}/reports.published-timetable.tsx`,
]) {
  assert.ok(
    read(rel).includes("مجموعات المحاضرات والمعامل"),
    `${rel} must use the official label «مجموعات المحاضرات والمعامل» for the group filter`,
  );
}

console.log(JSON.stringify({ harness: "reports-sources", status: "pass" }));

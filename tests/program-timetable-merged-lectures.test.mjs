import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const name = "20261003030000_shared_anchor_cohort_membership.sql";

test("the anchor cohort of a merged lecture is one of its attendees", async () => {
  const sql = await read(`supabase/migrations/${name}`);
  assert.match(sql, /public\.schedule_version_student_memberships\(uuid,uuid\[\]\)/);
  assert.match(sql, /SELECT r\.id,r\.own_cohort,NULL::uuid,NULL::integer,true/);
  assert.match(sql, /WHERE EXISTS \(SELECT 1 FROM links l WHERE l\.anchor_group_id=r\.id\)/);
  assert.match(sql, /AND NOT EXISTS \(SELECT 1 FROM direct d WHERE d\.group_id=r\.id\)/);
  // Derived from the live definition, guarded against drift and re-runs.
  assert.match(sql, /pg_get_functiondef\(target\)/);
  assert.match(sql, /SHARED_ANCHOR_MEMBERSHIP_DRIFT/);
  assert.doesNotMatch(sql, /\b(INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE|DROP)\b/);

  const rollback = await read(`supabase/rollbacks/${name}`);
  assert.match(rollback, /replace\(pg_get_functiondef\(target\), added, ''\)/);
});

test("the program/level report lists merged lectures for every attending cohort", async () => {
  const [route, catalog, sheet, print, css] = await Promise.all([
    read("src/routes/_authenticated/reports.program-level-timetable.tsx"),
    read("src/lib/reports/queries/delivery-group-coverage-queries.ts"),
    read("src/components/print-center/print-sheet.tsx"),
    read("src/components/reports/program-timetable-print.tsx"),
    read("src/styles.css"),
  ]);

  // Sessions are read for the whole version, expanded per cohort, then narrowed.
  assert.match(route, /fetchHydratedVersionSessions\(\{/);
  assert.match(route, /studySystem: "all",/);
  assert.match(route, /fetchStudentPrintMemberships\(hydrated, ctx\.collegeId!, ctx\.versionId!\)/);
  // Coverage and totals count a merged lecture once and include its anchor group.
  assert.match(route, /g\.sharedCohortIds\?\.some\(\(id\) => scopedCohortIds\.has\(id\)\)/);
  assert.match(route, /uniquePhysicalSessions\(baseView\.academicSessions\)/);
  assert.match(route, /uniquePhysicalSessions\(raw\)/);
  // The catalogue reads the version's own merges.
  assert.match(catalog, /fetchVersionStudentMemberships\(\s*params\.versionId,/);
  assert.match(
    catalog,
    /sharedCohortIds: \[\.\.\.\(attendingCohorts\.get\(group\.id\) \?\? \[\]\)\]/,
  );

  // Print: one cohort title, no separate coverage page, white paper, larger type.
  assert.match(sheet, /!readable && !\(props\.comfortable && cohortHeadline\.length > 0\) && \(/);
  assert.match(sheet, /print-center-page--keep-with-next/);
  assert.match(print, /keepWithNext=\{!!props\.coverage && i === pages\.length - 1\}/);
  assert.match(print, /print-coverage-block--inline/);
  assert.doesNotMatch(print, /ReportOfficialHeader/);
  assert.match(css, /\.print-center-page--comfortable table:not\(\.report-page-frame\) \{/);
  assert.match(css, /\.print-coverage-block \{\s+background: white !important;/);
  // An undivided group prints as ALL; day, time and type stay narrow.
  assert.match(sheet, /return "ALL";/);
  assert.doesNotMatch(sheet, /return "جميع المجموعات";/);
  assert.match(sheet, /!readable && props\.comfortable && \(/);
  assert.match(sheet, /className="schedule-type"/);
  assert.match(sheet, /className="schedule-group"/);
  assert.match(css, /td\.schedule-group \{\s+white-space: nowrap !important;/);
  assert.match(
    css,
    /\.print-center-page--comfortable table:not\(\.report-page-frame\) \{\s+\/\*[^*]*\*\/\s+table-layout: auto;/,
  );
});

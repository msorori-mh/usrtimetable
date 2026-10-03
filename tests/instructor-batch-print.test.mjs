import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const component = read("src/components/reports/instructor-batch-print.tsx");
const route = read("src/routes/_authenticated/reports.instructor-schedule.tsx");
const css = read("src/styles.css");

test("every lecturer's individual schedule prints in one job", () => {
  // The batch reuses the single-lecturer sheet: same header, view and hours summary.
  assert.match(route, /<InstructorBatchPrint\s+items=\{instructors\}/);
  assert.match(route, /const loadBatchSheet = async \(/);
  assert.match(route, /reportTitle=\{`جدول المحاضر — \$\{instructor\.full_name\}`\}/);
  assert.match(route, /summary=\{sheetSummary\}/);
  assert.match(route, /sessions=\{sheetSummary\.sessions\}/);
  // Scope follows the report: other colleges only for a cross-college viewer.
  assert.match(
    route,
    /canViewAcrossColleges && effectiveScope === "all"\s+\? await fetchInstructorTeachingCollegeIds/,
  );
  // A lecturer with nothing in scope gets no sheet.
  assert.match(route, /if \(!scoped\.length\) return null;/);
});

test("the batch never prints a partial set and prints only its own sheets", () => {
  assert.match(component, /const BATCH_CONCURRENCY = 4;/);
  assert.match(component, /لم يُطبع شيء/);
  assert.match(component, /root\.dataset\.instructorBatchPrint = "true";/);
  assert.match(component, /delete root\.dataset\.instructorBatchPrint;/);
  assert.match(component, /createPortal\(/);
  assert.match(component, /printPageStyleCss\(\)/);
  assert.match(
    css,
    /html\[data-instructor-batch-print\] body > \*:not\(\.instructor-batch-print\) \{\s+display: none !important;/,
  );
  assert.match(
    css,
    /\.instructor-batch-sheet \+ \.instructor-batch-sheet \{\s+break-before: page;/,
  );
});

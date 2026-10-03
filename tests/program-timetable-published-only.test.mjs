import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the program/level timetable report offers published versions only", async () => {
  const [page, hook, queries] = await Promise.all([
    read("src/routes/_authenticated/reports.program-level-timetable.tsx"),
    read("src/hooks/reports/useReportContext.ts"),
    read("src/lib/reports/queries/version-queries.ts"),
  ]);

  // The page locks the version list to published timetables.
  assert.match(page, /fixedStatusMode: "published_only"/);
  assert.doesNotMatch(page, /defaultStatusMode: "specific_version"/);
  // The lock reaches the version query and the printed filter summary.
  assert.match(hook, /statusMode: fixedStatusMode \?\? statusMode,\n\s+\}\),/);
  assert.match(hook, /statusMode: fixedStatusMode \?\? statusMode, studySystem \}/);
  assert.match(queries, /statusesForMode\(params\.statusMode\)/);
});

test("the printed sheet shows program, study system and level as one large line", async () => {
  const [sheet, css] = await Promise.all([
    read("src/components/print-center/print-sheet.tsx"),
    read("src/styles.css"),
  ]);

  assert.match(sheet, /data-testid="print-cohort-banner"/);
  assert.match(sheet, /cohortHeadline\.join\(" - "\)/);
  assert.match(sheet, /levelNumber \? `م\$\{levelNumber\}` : levelName \|\| null/);
  // The labelled detail fields stay for a distributed copy.
  assert.match(sheet, /label="البرنامج"/);
  assert.match(sheet, /label="النظام الدراسي"/);
  assert.match(css, /\.print-header-cohort-banner \{[^}]*font-size: 1\.7rem;/);
});

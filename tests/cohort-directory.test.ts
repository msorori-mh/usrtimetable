import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_COHORT_FILTERS,
  COHORT_PAGE_SIZE,
  filterCohortDirectory,
  cohortLevelOptions,
  cohortDirectoryPage,
  visibleCohortSelection,
  type CohortListRow,
} from "../src/lib/academic-delivery/cohort-directory";
const row = (id: string, extra: Partial<CohortListRow> = {}): CohortListRow => ({
  id,
  code: id,
  program_id: "cs",
  level_id: "cs-l1",
  term_id: "first",
  study_system: "regular",
  entry_year: 2026,
  expected_students: 60,
  count_status: "confirmed",
  active: true,
  programName: "علوم الحاسوب",
  levelName: "المستوى 1",
  levelNumber: 1,
  termName: "الفصل الأول",
  ...extra,
});
const rows = [
  row("CS-REG"),
  row("CS-PAR", { study_system: "parallel" }),
  row("CS-L2", { level_id: "cs-l2", levelNumber: 2, levelName: "المستوى 2" }),
  row("CY-REG", {
    program_id: "cy",
    programName: "الأمن السيبراني",
    level_id: "cy-l3",
    levelNumber: 3,
    levelName: "المستوى 3",
  }),
  row("OLD", { active: false, term_id: "second" }),
];
test("program and level filters cannot include cohorts from another program", () => {
  assert.deepEqual(cohortLevelOptions(rows, "cs"), [1, 2]);
  assert.deepEqual(cohortLevelOptions(rows, "cy"), [3]);
  assert.deepEqual(
    filterCohortDirectory(rows, { ...EMPTY_COHORT_FILTERS, program: "cs", level: "2" }).map(
      (r) => r.id,
    ),
    ["CS-L2"],
  );
});
test("system, term and activity filters combine without merging regular and parallel cohorts", () => {
  assert.deepEqual(
    filterCohortDirectory(rows, {
      ...EMPTY_COHORT_FILTERS,
      system: "parallel",
      term: "first",
      activity: "active",
    }).map((r) => r.id),
    ["CS-PAR"],
  );
  assert.deepEqual(
    filterCohortDirectory(rows, { ...EMPTY_COHORT_FILTERS, activity: "inactive" }).map((r) => r.id),
    ["OLD"],
  );
});
test("search accepts Arabic spelling and numerals, program names and cohort codes", () => {
  assert.deepEqual(
    filterCohortDirectory(rows, { ...EMPTY_COHORT_FILTERS, search: "امن ٣" }).map((r) => r.id),
    ["CY-REG"],
  );
  assert.deepEqual(
    filterCohortDirectory(rows, { ...EMPTY_COHORT_FILTERS, search: "cs-par" }).map((r) => r.id),
    ["CS-PAR"],
  );
  assert.deepEqual(
    filterCohortDirectory(rows, { ...EMPTY_COHORT_FILTERS, search: "نفقة خاصة" }).map((r) => r.id),
    ["CS-PAR"],
  );
});
test("pagination covers every matching cohort once and clamps a stale page", () => {
  const all = Array.from({ length: COHORT_PAGE_SIZE * 2 + 1 }, (_, i) => row(String(i)));
  assert.equal(cohortDirectoryPage(all, 99).page, 3);
  assert.deepEqual(
    [1, 2, 3].flatMap((p) => cohortDirectoryPage(all, p).rows.map((r) => r.id)),
    all.map((r) => r.id),
  );
  assert.equal(cohortDirectoryPage([], 7).page, 1);
});
test("filtering or paging away from the selected cohort cannot retain a hidden action target", () => {
  const filtered = filterCohortDirectory(rows, { ...EMPTY_COHORT_FILTERS, program: "cy" });
  assert.equal(visibleCohortSelection(filtered, "CS-REG"), "CY-REG");
  assert.equal(visibleCohortSelection([], "CS-REG"), null);
  assert.equal(visibleCohortSelection(rows, "CS-PAR"), "CS-PAR");
});

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_PROGRAM_REPORT_FILTERS,
  changeProgramReportFilter,
  deriveProgramTimetable,
  parseProgramReportSearch,
  programReportSearchParams,
  reconcileProgramReportScope,
  type ProgramReportReferences,
  type ProgramReportSelection,
} from "../src/lib/reports/program-timetable-filters";
import type { PrintSessionLike } from "../src/lib/print-center/types";

const references: ProgramReportReferences = {
  departments: [
    { id: "d1", name: "القسم الأول" },
    { id: "d2", name: "القسم الثاني" },
  ],
  programs: [
    { id: "is", name: "نظم المعلومات", department_id: "d1" },
    { id: "cs", name: "علوم الحاسوب", department_id: "d1" },
    { id: "ai", name: "الذكاء الاصطناعي", department_id: "d2" },
  ],
  levels: [
    { id: "is2", program_id: "is", level_number: 2, name: "المستوى 2" },
    { id: "is1", program_id: "is", level_number: 1, name: "المستوى الأول" },
    { id: "cs1", program_id: "cs", level_number: 1, name: "المستوى 1" },
    { id: "cs4", program_id: "cs", level_number: 4, name: "المستوى الرابع" },
    { id: "ai1", program_id: "ai", level_number: 1, name: "الأول" },
  ],
  cohorts: [
    {
      id: "is-r",
      code: "COH-IS-REG",
      program_id: "is",
      level_id: "is1",
      term_id: "t1",
      study_system: "regular",
      entry_year: 2026,
    },
    {
      id: "is-p",
      code: "COH-IS-PAR",
      program_id: "is",
      level_id: "is1",
      term_id: "t1",
      study_system: "parallel",
      entry_year: 2026,
    },
    {
      id: "is-r2",
      code: "COH-IS-L2",
      program_id: "is",
      level_id: "is2",
      term_id: "t1",
      study_system: "regular",
      entry_year: 2025,
    },
    {
      id: "cs-r",
      code: "COH-CS-REG",
      program_id: "cs",
      level_id: "cs1",
      term_id: "t1",
      study_system: "regular",
      entry_year: 2026,
    },
    {
      id: "old",
      code: "OLD",
      program_id: "is",
      level_id: "is1",
      term_id: "t0",
      study_system: "regular",
      entry_year: 2025,
    },
  ],
};
const scope = { collegeId: "college", termId: "t1", versionId: "v1", studySystem: "all" as const };
const session = (
  id: string,
  group: string,
  cohort: string,
  program: string,
  level: string,
  study = "regular",
): PrintSessionLike => ({
  id,
  college_id: "college",
  cohort_id: cohort,
  delivery_group_id: group,
  study_system: study,
  day_of_week: 0,
  start_time: "08:00",
  end_time: "10:00",
  session_type: "lecture",
  course_offerings: {
    program_id: program,
    level_id: level,
    courses: { code: group, name: `مقرر ${group}`, department_id: "service-department" },
  },
});
const sessions = [
  session("a", "g1", "is-r", "is", "is1"),
  session("b", "g1", "is-r", "is", "is1"),
  session("c", "g2", "is-r", "is", "is1"),
  session("p", "gp", "is-p", "is", "is1", "parallel"),
  session("d", "gc", "cs-r", "cs", "cs1"),
  session("e", "gl2", "is-r2", "is", "is2"),
];
const deliveryGroupLabels = new Map(sessions.map((s) => [s.delivery_group_id!, "G1"]));
const derive = (
  selection: Partial<ProgramReportSelection> = {},
  studySystem: "all" | "regular" | "parallel" = "all",
) =>
  deriveProgramTimetable({
    references,
    sessions,
    scope: { ...scope, studySystem },
    selection: { ...ALL_PROGRAM_REPORT_FILTERS, ...selection },
    deliveryGroupLabels,
  });

describe("dependent program timetable filters", () => {
  test("level options are ordered and unique across programs", () => {
    assert.deepEqual(
      derive().levels.map((l) => l.value),
      ["1", "2", "4"],
    );
    assert.deepEqual(
      derive({ programId: "is" }).levels.map((l) => l.value),
      ["1", "2"],
    );
    assert.deepEqual(
      derive({ departmentId: "d2" }).levels.map((l) => l.value),
      ["1"],
    );
  });
  test("level number filters every matching ID, without merging session identities", () => {
    assert.deepEqual(
      derive({ levelValue: "1" }).sessions.map((s) => s.id),
      ["a", "b", "c", "p", "d"],
    );
  });
  test("cohorts follow program, level, term and study system", () => {
    const view = derive({ programId: "is", levelValue: "1" }, "regular");
    assert.deepEqual(
      view.cohorts.map((c) => c.id),
      ["is-r"],
    );
    assert.ok(view.cohorts[0].name.includes("نظم المعلومات"));
    assert.ok(view.cohorts[0].name.includes("النظام العام"));
    assert.ok(view.cohorts[0].name.includes("دفعة 2026"));
  });
  test("groups follow the selected cohort and distinguish same G1 across courses", () => {
    const view = derive({ programId: "is", levelValue: "1", cohortId: "is-r" });
    assert.deepEqual(
      view.deliveryGroups.map((g) => g.id),
      ["g1", "g2"],
    );
    assert.equal(new Set(view.deliveryGroups.map((g) => g.name)).size, 2);
    assert.equal(
      view.deliveryGroups.every((g) => g.name.includes("محاضرة")),
      true,
    );
    assert.deepEqual(
      derive({ cohortId: "is-r", deliveryGroupId: "g1" }).sessions.map((s) => s.id),
      ["a", "b"],
    );
  });
  test("department follows program ownership, including service courses", () => {
    assert.deepEqual(
      derive({ departmentId: "d1", programId: "is", levelValue: "1" }).sessions.map((s) => s.id),
      ["a", "b", "c", "p"],
    );
    assert.deepEqual(derive({ departmentId: "d2" }).sessions, []);
  });
  test("parent changes immediately clear descendants", () => {
    const selected = {
      departmentId: "d1",
      programId: "is",
      levelValue: "1",
      cohortId: "is-r",
      deliveryGroupId: "g1",
    };
    assert.deepEqual(changeProgramReportFilter(selected, "programId", "cs"), {
      ...selected,
      programId: "cs",
      levelValue: "all",
      cohortId: "all",
      deliveryGroupId: "all",
    });
    assert.deepEqual(
      changeProgramReportFilter(selected, "departmentId", "all"),
      ALL_PROGRAM_REPORT_FILTERS,
    );
    assert.equal(changeProgramReportFilter(selected, "cohortId", "is-p").deliveryGroupId, "all");
  });
  test("college clears all; term/version/system clear only cohort and group", () => {
    const selected = {
      ...ALL_PROGRAM_REPORT_FILTERS,
      programId: "is",
      levelValue: "1",
      cohortId: "is-r",
      deliveryGroupId: "g1",
    };
    assert.deepEqual(
      reconcileProgramReportScope(selected, scope, { ...scope, collegeId: "other" }),
      ALL_PROGRAM_REPORT_FILTERS,
    );
    for (const next of [
      { ...scope, termId: "t2" },
      { ...scope, versionId: "v2" },
      { ...scope, studySystem: "regular" as const },
    ]) {
      assert.deepEqual(reconcileProgramReportScope(selected, scope, next), {
        ...selected,
        cohortId: "all",
        deliveryGroupId: "all",
      });
    }
  });
  test("unavailable and cross-program dependent choices cannot remain active", () => {
    const view = derive({
      programId: "cs",
      levelValue: "2",
      cohortId: "is-r",
      deliveryGroupId: "g1",
    });
    assert.deepEqual(view.selected, { ...ALL_PROGRAM_REPORT_FILTERS, programId: "cs" });
    assert.deepEqual(
      view.sessions.map((s) => s.id),
      ["d"],
    );
  });
  test("groups from another version or college are not offered", () => {
    const view = deriveProgramTimetable({
      references,
      sessions: [{ ...sessions[0], college_id: "other" }],
      selection: ALL_PROGRAM_REPORT_FILTERS,
      scope,
      deliveryGroupLabels,
    });
    assert.deepEqual(view.sessions, []);
    assert.deepEqual(view.deliveryGroups, []);
    const empty = deriveProgramTimetable({
      references,
      sessions: [],
      selection: ALL_PROGRAM_REPORT_FILTERS,
      scope,
      deliveryGroupLabels,
    });
    assert.deepEqual(empty.deliveryGroups, []);
  });
  test("QR round-trip preserves exact version, all-system choice and every selected filter", () => {
    const selected = {
      departmentId: "d1",
      programId: "is",
      levelValue: "1",
      cohortId: "is-r",
      deliveryGroupId: "g1",
    };
    const restored = parseProgramReportSearch(programReportSearchParams(scope, selected));
    assert.deepEqual(restored.selection, selected);
    assert.deepEqual(restored.context, {
      termId: "t1",
      versionId: "v1",
      statusMode: "specific_version",
      studySystem: "all",
    });
  });
});

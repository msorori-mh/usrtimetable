import assert from "node:assert/strict";
import test from "node:test";
import {
  importedTimetableRows,
  filterImportedTimetable,
  sourceDuration,
} from "../src/lib/reports/imported-timetable.ts";

const source = (overrides = {}) => ({
  id: "a",
  college_id: "education",
  term_id: "first",
  source_id: "source-a",
  source_file: "جدول.docx",
  source_cell: "T1/R4",
  raw_course: "مقرر المصدر",
  raw_teacher: "د. أحمد",
  raw_day: "الأحد",
  raw_time: "8-11",
  raw_room: "ق36 السعودي",
  day_of_week: 0,
  start_time: "08:00:00",
  end_time: "11:00:00",
  level_number: 1,
  study_plan_id: null,
  notes: JSON.stringify({ raw_extraction: { id: "S0001", dept: "الرياضيات", hours: 3 } }),
  schedule_session_id: null,
  teaching_assignment_id: null,
  pending_reasons: ["تحديد الهوية"],
  ...overrides,
});
const scope = { collegeId: "education", termId: "first" };
const filters = {
  kind: "timetable",
  department: "all",
  level: "all",
  teacher: "all",
  room: "all",
  search: "",
};

test("unlinked source remains reportable with all verbatim fields and references", () => {
  const row = importedTimetableRows([source()], scope)[0];
  assert.equal(row.course, "مقرر المصدر");
  assert.equal(row.teacher, "د. أحمد");
  assert.equal(row.rawTime, "8-11");
  assert.equal(row.room, "ق36 السعودي");
  assert.equal(row.hours, 3);
  assert.equal(row.sourceFile, "جدول.docx");
  assert.equal(row.sourceCell, "T1/R4");
  assert.equal(row.sessionLinked, false);
  assert.equal(row.assignmentLinked, false);
});
test("missing teacher, level and time are preserved, never fabricated or dropped", () => {
  const rows = importedTimetableRows(
    [
      source({
        raw_teacher: null,
        level_number: null,
        start_time: null,
        end_time: null,
        raw_time: null,
      }),
    ],
    scope,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].teacher, "");
  assert.equal(rows[0].level, "غير محدد");
  assert.equal(rows[0].hours, "");
  assert.equal(rows[0].missingTime, true);
});
test("scope excludes another college and another term even with identical IDs", () => {
  assert.equal(
    importedTimetableRows(
      [source(), source({ college_id: "arts" }), source({ term_id: "second" })],
      scope,
    ).length,
    1,
  );
});
test("assignment corroboration is separate from timetable and all-source exports retain both", () => {
  const rows = importedTimetableRows(
    [
      source(),
      source({
        id: "b",
        notes: JSON.stringify({ raw_extraction: { id: "C0001" } }),
        day_of_week: null,
        raw_day: null,
      }),
    ],
    scope,
  );
  assert.equal(filterImportedTimetable(rows, filters).length, 1);
  assert.equal(filterImportedTimetable(rows, { ...filters, kind: "all" }).length, 2);
  assert.equal(
    filterImportedTimetable(rows, { ...filters, kind: "assignment" })[0].kind,
    "assignment",
  );
});
test("malformed/plain notes and empty raw names remain visible", () => {
  const rows = importedTimetableRows(
    [source({ notes: "ملاحظة المصدر", raw_course: "" }), source({ id: "b", notes: "{broken" })],
    scope,
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].course, "");
  assert.equal(rows[1].department, "غير محدد في المصدر");
});
test("same short teacher name is not interpreted as a resolved university identity", () => {
  const rows = importedTimetableRows(
    [
      source(),
      source({
        id: "b",
        notes: JSON.stringify({ raw_extraction: { id: "S0002", dept: "الفيزياء" } }),
      }),
    ],
    scope,
  );
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => !row.assignmentLinked));
  assert.equal(
    filterImportedTimetable(rows, { ...filters, department: "الرياضيات", teacher: "د. أحمد" })
      .length,
    1,
  );
});
test("filters preserve conjunction, empty-field selection, and raw source search", () => {
  const rows = importedTimetableRows([source(), source({ id: "b", raw_teacher: null })], scope);
  assert.equal(filterImportedTimetable(rows, { ...filters, teacher: "" }).length, 1);
  assert.equal(
    filterImportedTimetable(rows, { ...filters, level: "2", room: "ق36 السعودي" }).length,
    0,
  );
  assert.equal(filterImportedTimetable(rows, { ...filters, search: "جدول.docx" }).length, 2);
});
test("invalid and backwards times are never coerced into zero or overnight hours", () => {
  for (const pair of [
    [null, null],
    ["11:00", "08:00"],
    ["25:00", "26:00"],
    ["08:70", "11:00"],
    ["", "11:00"],
  ])
    assert.equal(sourceDuration(...pair), null);
  assert.equal(sourceDuration("08:30", "11:00"), 2.5);
});
test("linked sources do not acquire duplicate synthetic sessions", () => {
  const rows = importedTimetableRows(
    [source({ schedule_session_id: "session-1", teaching_assignment_id: "assignment-1" })],
    scope,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sessionLinked, true);
  assert.equal(rows[0].assignmentLinked, true);
});

import assert from "node:assert/strict";
import test from "node:test";
import { previewSourceRows } from "../src/lib/existing-schedules/source-row-import.ts";

const item = (overrides = {}) => ({
  source_id: "CHEM-2026F-01",
  source_file: "كيمياء.docx",
  source_cell: "T1/R4/C2",
  program: "كيمياء التربية",
  level_number: 1,
  raw_course: "تفاضل وتكامل 1",
  raw_teacher: "د. زينب",
  raw_day: "السبت",
  raw_time: "8-11",
  raw_room: "ق11",
  day_of_week: 6,
  start_time: "08:00",
  end_time: "11:00",
  ...overrides,
});
const saved = (overrides = {}) => ({
  ...item(),
  start_time: "08:00:00",
  end_time: "11:00:00",
  ...overrides,
});

test("new source row retains raw evidence without inventing plan or session", () => {
  const result = previewSourceRows([item()], []);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].start_time, "08:00:00");
  assert.equal(JSON.parse(result.rows[0].notes).raw_extraction.dept, "كيمياء التربية");
  assert.equal("plan_course_id" in result.rows[0], false);
});

test("exact repeat is skipped; changed same ID or location is blocked", () => {
  assert.equal(previewSourceRows([item()], [saved()]).skipped, 1);
  assert.equal(previewSourceRows([item({ raw_teacher: "د. آخر" })], [saved()]).errors.length, 1);
  assert.equal(previewSourceRows([item({ source_id: "DIFFERENT" })], [saved()]).errors.length, 1);
});

test("rejects invalid duration and repeated file identifiers before writing", () => {
  assert.equal(previewSourceRows([item({ end_time: "07:00" })], []).errors.length, 1);
  const result = previewSourceRows([item(), item()], []);
  assert.equal(result.errors.length, 1);
  assert.equal(result.rows.length, 1);
});

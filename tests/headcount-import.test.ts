import test from "node:test";
import assert from "node:assert/strict";
import { HEADCOUNT_HEADERS, previewHeadcounts, type ImportCohort } from "../src/lib/scheduling-headcount/import.ts";

const cohort = { id: "cohort", code: "CIS-L1-2026", term_id: "term", term_code: "2026-T1", program_code: "cis", level_number: 1, study_system: "regular", entry_year: 2026, cohort_version: "c1", expected_version: null } as ImportCohort;
const options = { sameCounts: false, allowOverEligible: false, source: "counts.xlsx" };
const values = ["CIS-L1-2026", "2026-T1", 68, 60, 58, 2, 60, 57, "المسجل", ""];
const preview = (rows: unknown[][], opts = options, catalog = [cohort]) => previewHeadcounts([HEADCOUNT_HEADERS, ...rows], catalog, opts);

test("preserves different categories and preview versions without autoapproval", () => {
  const p = preview([values]);
  assert.equal(p.errors.length, 0); assert.equal(p.rows[0].exam_eligible_count, 57);
  assert.equal(p.rows[0].registered_student_count, 68); assert.equal(p.rows[0].scheduling_headcount, 60);
  assert.equal(p.rows[0].cohort_version, "c1"); assert.equal(p.rows[0].expected_version, null);
  assert.equal("approval_status" in p.rows[0], false);
});
test("Arabic and Persian digits work; empty cells, fractions, negative numbers and overflow fail", () => {
  for (const value of ["٦٨", "۶۸", 68]) { const r = [...values]; r[2] = value; assert.equal(preview([r]).errors.length, 0); }
  for (const value of ["", null, "-1", "1.2", "1e2", 2147483648, true]) {
    const r: unknown[] = [...values]; r[2] = value; assert.ok(preview([r]).errors.some((e) => e.column === "عدد_المسجلين"));
  }
});
test("unknown, inactive or ambiguous cohort/term cannot match a different college", () => {
  assert.equal(preview([values], options, []).rows.length, 0);
  assert.equal(preview([values], options, [cohort, { ...cohort, id: "other" }]).rows.length, 0);
  const r = [...values]; r[1] = "Sem2"; assert.equal(preview([r]).rows.length, 0);
});
test("duplicate rows and duplicate or missing headers block the whole batch", () => {
  assert.ok(preview([values, values]).errors.some((e) => e.message.includes("مكرران")));
  assert.ok(previewHeadcounts([[...HEADCOUNT_HEADERS, "رمز_الدفعة"], values], [cohort], options).errors.length);
  assert.ok(previewHeadcounts([HEADCOUNT_HEADERS.slice(1), values.slice(1)], [cohort], options).errors.length);
});
const oldHeaders = ["رمز_البرنامج", "رقم_المستوى", "نظام_الدراسة", "سنة_الدخول", "رمز_الفصل", "الطلاب_المتوقعون", "حالة_العد", "رمز_الدفعة", "نشط"];
const oldRow = ["cis", 1, "regular", 2026, "2026-T1", 68, "confirmed", "CIS-L1-2026", "true"];
test("previous cohort workbook requires explicit same-counts acknowledgement", () => {
  const p = previewHeadcounts([oldHeaders, oldRow], [cohort], options);
  assert.equal(p.rows.length, 0); assert.ok(p.errors.length);
  const accepted = previewHeadcounts([oldHeaders, oldRow], [cohort], { ...options, sameCounts: true });
  assert.equal(accepted.errors.length, 0); assert.equal(accepted.rows[0].reserve_margin, 0);
  assert.equal(accepted.rows[0].exam_eligible_count, 68); assert.equal(accepted.rows[0].source, options.source);
});
test("provided program/level/system/year must match the actual cohort", () => {
  for (const index of [0, 1, 2, 3]) {
    const row = [...oldRow]; row[index] = "wrong";
    assert.ok(previewHeadcounts([oldHeaders, row], [cohort], { ...options, sameCounts: true }).errors.length);
  }
});
test("exception requires both manager acknowledgement and written reason", () => {
  const row = [...values]; row[6] = 70;
  assert.ok(preview([row]).errors.length);
  assert.ok(preview([row], { ...options, allowOverEligible: true }).errors.length);
  row[9] = "احتياط معتمد";
  assert.ok(preview([row]).errors.length);
  assert.equal(preview([row], { ...options, allowOverEligible: true }).errors.length, 0);
});
test("zero scheduling count, empty workbook and oversized batch cannot be saved", () => {
  const row = [...values]; row[6] = 0; assert.ok(preview([row]).errors.length);
  assert.ok(preview([]).errors.length);
  assert.ok(preview(Array.from({ length: 501 }, () => values)).errors.some((e) => e.message.includes("500")));
});
test("same-counts checkbox never overwrites a detailed workbook", () => {
  const p = preview([values], { ...options, sameCounts: true });
  assert.equal(p.rows[0].registered_student_count, 68); assert.equal(p.rows[0].exam_eligible_count, 57);
});
test("missing numeric column in a partly detailed workbook does not fall back to expected count", () => {
  const headers = [...HEADCOUNT_HEADERS.slice(0, 3), "الطلاب_المتوقعون"];
  assert.ok(previewHeadcounts([headers, values], [cohort], { ...options, sameCounts: true }).errors.length);
});

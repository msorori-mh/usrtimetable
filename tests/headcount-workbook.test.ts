import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { HEADCOUNT_HEADERS } from "../src/lib/scheduling-headcount/import.ts";
import { readHeadcountWorkbook } from "../src/lib/scheduling-headcount/import-workbook.ts";

function file(sheet: XLSX.WorkSheet, names = ["scheduling_headcounts"], filename = "counts.xlsx") {
  const book = XLSX.utils.book_new();
  for (const name of names) XLSX.utils.book_append_sheet(book, sheet, name);
  return new File([XLSX.write(book, { type: "array", bookType: "xlsx" })], filename);
}
const sheet = () => XLSX.utils.aoa_to_sheet([HEADCOUNT_HEADERS, ["C1", "T1", 20, 20, 20, 0, 20, 20, "test", ""]]);
test("real XLSX values survive decoding and unused sheets are reported", async () => {
  const result = await readHeadcountWorkbook(file(sheet(), ["scheduling_headcounts", "تعليمات"]));
  assert.equal(result.matrix[1][2], 20); assert.equal(result.matrix[1][5], 0);
  assert.deepEqual(result.ignored, ["تعليمات"]);
});
test("previous academic_cohorts sheet is selected with pending sheets explicitly excluded", async () => {
  const result = await readHeadcountWorkbook(file(sheet(), ["academic_cohorts", "الجوف_بانتظار_المستويات"]));
  assert.equal(result.name, "academic_cohorts"); assert.equal(result.ignored.length, 1);
});
test("formulas with cached values and error cells are rejected", async () => {
  const formula = sheet(); formula.C2 = { t: "n", f: "10+10", v: 20 };
  await assert.rejects(readHeadcountWorkbook(file(formula)), /معادلة/);
  const error = sheet(); error.C2 = { t: "e", v: 7 };
  await assert.rejects(readHeadcountWorkbook(file(error)), /خطأ/);
});
test("ambiguous workbook, disguised file, excessive range and invalid binary are rejected", async () => {
  await assert.rejects(readHeadcountWorkbook(file(sheet(), ["one", "two"])), /التباس/);
  await assert.rejects(readHeadcountWorkbook(file(sheet(), ["scheduling_headcounts"], "counts.xlsm")), /XLSX/);
  const big = sheet(); big.A502 = { t: "n", v: 1 }; big["!ref"] = "A1:J502";
  await assert.rejects(readHeadcountWorkbook(file(big)), /500/);
});

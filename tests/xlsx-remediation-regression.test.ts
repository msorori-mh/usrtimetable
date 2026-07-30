/**
 * DEPENDENCY-SECURITY-REMEDIATION-01 — Excel import regression after xlsx remount.
 * Uses @e965/xlsx via the `xlsx` package alias. No DB writes.
 */
import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import {
  TEMPLATES,
  buildTemplateWorkbook,
  parseExcel,
} from "../src/lib/excel-import/templates";
import { parseSourceWorkbookFile } from "../src/lib/excel-import/teaching-assignments-source-parser";
import { anonymizedRealWorkbookSheet } from "./fixtures/teaching-assignments-source/anonymized-real-layout";

const require = createRequire(import.meta.url);
const xlsxPkg = require(resolve(import.meta.dir, "../node_modules/xlsx/package.json")) as {
  name: string;
  version: string;
};

async function blobToFile(blob: Blob, name: string): Promise<File> {
  const buf = await blob.arrayBuffer();
  return new File([buf], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function aoaToXlsxFile(sheetName: string, aoa: readonly (readonly unknown[])[], name: string): File {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa.map((row) => [...row]));
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
  return new File([out], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("xlsx remediation regression", () => {
  test("resolves community SheetJS remount at a patched version", () => {
    expect(xlsxPkg.name).toBe("@e965/xlsx");
    expect(xlsxPkg.version).toBe("0.20.3");
  });

  test("teaching_assignments_v2 template round-trips headers and example row", async () => {
    const tpl = TEMPLATES.teaching_assignments_v2;
    const blob = await buildTemplateWorkbook("teaching_assignments_v2");
    const file = await blobToFile(blob, "assignments_v2.xlsx");
    const { headers, rows } = await parseExcel(file);

    expect(headers).toEqual(tpl.columns.map((c) => c.header));
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const col of tpl.columns) {
      if (col.example === undefined || col.example === "") continue;
      expect(String(rows[0][col.header] ?? "")).toBe(String(col.example));
    }
  });

  test("study_plan_courses and full_study_plan templates round-trip", async () => {
    for (const entity of ["study_plan_courses", "full_study_plan"] as const) {
      const tpl = TEMPLATES[entity];
      const blob = await buildTemplateWorkbook(entity);
      const file = await blobToFile(blob, `${entity}.xlsx`);
      const { headers, rows } = await parseExcel(file);
      expect(headers).toEqual(tpl.columns.map((c) => c.header));
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const col of tpl.columns) {
        if (col.example === undefined || col.example === "") continue;
        expect(String(rows[0][col.header] ?? "")).toBe(String(col.example));
      }
    }
  });

  test("teaching-assignments source workbook parse keeps row/sheet contract", async () => {
    const file = aoaToXlsxFile("Sheet1", anonymizedRealWorkbookSheet, "source-ta.xlsx");
    const parsed = await parseSourceWorkbookFile(file);
    expect(parsed.sheets.length).toBe(1);
    expect(parsed.totalRowsRead).toBeGreaterThan(0);
    expect(parsed.totalDataRows).toBeGreaterThan(0);
    const first = parsed.sheets[0];
    expect(first.sheetName).toBe("Sheet1");
    expect(first.dataRowCount).toBeGreaterThan(0);
  });
});

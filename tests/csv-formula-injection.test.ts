import { test, expect } from "bun:test";
import { csvField, neutralizeFormulaText } from "../src/lib/reports/spreadsheet-safe.ts";
import { buildAdminExportCsv } from "../src/lib/admin-export/dataset.ts";

test("M-2: formula-triggering text cells are neutralized", () => {
  for (const bad of [
    '=HYPERLINK("x")',
    "+cmd",
    "-2+3",
    "@SUM(A1)",
    "\tx",
    "\rx",
    "\nx",
    "  =1",
    "﻿=1",
  ])
    expect(String(neutralizeFormulaText(bad)).startsWith("'")).toBe(true);
  expect(neutralizeFormulaText("قاعة 1")).toBe("قاعة 1");
  expect(neutralizeFormulaText("a=b")).toBe("a=b");
});

test("M-2: numbers (including negatives) stay numeric", () => {
  expect(neutralizeFormulaText(-5)).toBe(-5);
  expect(csvField(-5)).toBe("-5");
  expect(csvField(0)).toBe("0");
  expect(csvField(null)).toBe("");
});

test("M-2: neutralized cells are still quoted correctly", () => {
  expect(csvField("=1,2")).toBe(`"'=1,2"`);
  expect(csvField('=A1"x')).toBe(`"'=A1""x"`);
  expect(csvField("-cmd")).toBe("'-cmd");
});

test("M-2: admin CSV export neutralizes text cells and keeps numeric cells", () => {
  const csv = buildAdminExportCsv(
    {
      title: "اختبار",
      fileBase: "t",
      sheetName: "t",
      collegeName: "ك",
      filters: [],
      columns: [
        { key: "name", label: "الاسم", value: (r: { name: string; n: number }) => r.name },
        { key: "n", label: "العدد", value: (r: { name: string; n: number }) => r.n },
      ],
      rows: [{ name: "=cmd|' /C calc'!A0", n: -3 }],
    } as never,
    new Date("2026-01-01T00:00:00Z"),
  );
  const line = csv.replace(/^\uFEFF/, "").split("\r\n")[1];
  expect(line).toBe(`'=cmd|' /C calc'!A0,-3`);
});

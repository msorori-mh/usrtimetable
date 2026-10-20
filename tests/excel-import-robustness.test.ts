import { test, expect } from "bun:test";
import {
  isEndAfterStart,
  parseDaysCsv,
  parseDecimalCell,
  timeToMinutes,
} from "../src/lib/excel-import/cell-parse.ts";
import {
  normalizeArabicText,
  normalizedMatchKey,
} from "../src/lib/excel-import/arabic-normalize.ts";
import { canonicalImportHeader, headerMatchKey } from "../src/lib/excel-import/header-aliases.ts";
import { matrixToImportRows, pickTemplateSheet } from "../src/lib/excel-import/sheet-detect.ts";
import type { ColumnDef } from "../src/lib/excel-import/types.ts";

test("M-13: numeric cells accept Arabic digits and reject exponent/hex", () => {
  expect(parseDecimalCell("٣٠")).toBe(30);
  expect(parseDecimalCell("۱۲")).toBe(12);
  expect(parseDecimalCell("2٫5")).toBe(2.5);
  expect(parseDecimalCell(" 18 ")).toBe(18);
  expect(parseDecimalCell("-3")).toBe(-3);
  expect(parseDecimalCell("1,250")).toBe(1250);
  expect(parseDecimalCell(42)).toBe(42);
  for (const bad of ["1e3", "0x10", "Infinity", "12abc", "", "1,2", "NaN", "0b1", "."])
    expect(parseDecimalCell(bad)).toBeNull();
});

test("M-13: days_csv normalizes digits and rejects invalid tokens instead of dropping them", () => {
  expect(parseDaysCsv("0,١,2")).toEqual({ ok: true, days: [0, 1, 2] });
  expect(parseDaysCsv("0،3")).toEqual({ ok: true, days: [0, 3] });
  expect(parseDaysCsv("0,x,2")).toEqual({ ok: false, invalid: ["x"] });
  expect(parseDaysCsv("7")).toEqual({ ok: false, invalid: ["7"] });
  expect(parseDaysCsv("1.5")).toEqual({ ok: false, invalid: ["1.5"] });
});

test("M-13: time ranges compare minutes, not strings", () => {
  expect(timeToMinutes("8:00")).toBe(480);
  expect(timeToMinutes("08:30:00")).toBe(510);
  expect(timeToMinutes("٠٨:٠٠")).toBe(480);
  expect(timeToMinutes("24:00")).toBeNull();
  // Lexically "10:00" < "8:00" — this used to be wrongly rejected.
  expect(isEndAfterStart("8:00", "10:00")).toBe(true);
  // Lexically "9:00" > "10:00" — this used to be wrongly accepted.
  expect(isEndAfterStart("10:00", "9:00")).toBe(false);
  expect(isEndAfterStart("10:00", "10:00")).toBe(false);
});

test("M-13: Arabic normalizer strips invisible marks, Persian letters and presentation forms", () => {
  expect(normalizeArabicText("علی")).toBe(normalizeArabicText("علي"));
  expect(normalizeArabicText("کلية")).toBe(normalizeArabicText("كلية"));
  expect(normalizeArabicText("‏محمد​﻿")).toBe("محمد");
  expect(normalizeArabicText("أحمد؜")).toBe("احمد");
  // U+FEDF U+FEE0 U+FEE8 ... presentation forms of "لمن" fold via NFKC.
  expect(normalizeArabicText("ﻟﻤﻦ")).toBe(normalizeArabicText("لمن"));
  expect(normalizedMatchKey("CS‍101")).toBe("cs101");
});

const columns: ColumnDef[] = [
  { key: "code", header: "الرمز", required: true },
  { key: "lectures_per_week", header: "عدد_المحاضرات_أسبوعياً", type: "number" },
  { key: "name", header: "الاسم" },
];

test("M-13: headers match across tanween / underscores / invisible marks", () => {
  expect(headerMatchKey("عدد المحاضرات أسبوعيا")).toBe(headerMatchKey("عدد_المحاضرات_أسبوعياً"));
  expect(canonicalImportHeader(columns, "عدد المحاضرات أسبوعيا")).toBe("عدد_المحاضرات_أسبوعياً");
  expect(canonicalImportHeader(columns, "‏الرمز")).toBe("الرمز");
  expect(canonicalImportHeader(columns, "غير معروف")).toBe("غير معروف");
});

test("M-13: header row detection and duplicate headers preserved from raw matrix", () => {
  const sheets = [
    { name: "تعليمات_إضافية", matrix: [["ملاحظة"], ["أي شيء"]] },
    {
      name: "بيانات",
      matrix: [
        ["كشف المقررات للعام 2026"],
        [],
        ["الرمز", "الاسم", "الاسم"],
        ["CS101", "برمجة", "x"],
        ["", "", ""],
        ["CS102", "هياكل", ""],
      ],
    },
  ];
  const picked = pickTemplateSheet(sheets, columns);
  expect(picked.name).toBe("بيانات");
  expect(picked.headerIndex).toBe(2);
  const out = matrixToImportRows(picked.matrix, picked.headerIndex, picked.name);
  expect(out.headers).toEqual(["الرمز", "الاسم", "الاسم"]);
  expect(out.headerRowNumber).toBe(3);
  expect(out.rowNumbers).toEqual([4, 6]);
  expect(out.rows[0]).toEqual({ الرمز: "CS101", الاسم: "برمجة" });
});

test("M-13: template sheet name wins; unmatched workbook falls back to first sheet row 1", () => {
  const a = {
    name: "A",
    matrix: [
      ["الرمز", "الاسم"],
      ["1", "x"],
    ],
  };
  const b = {
    name: "مقررات",
    matrix: [
      ["الرمز", "الاسم"],
      ["2", "y"],
    ],
  };
  expect(pickTemplateSheet([a, b], columns, "مقررات").name).toBe("مقررات");
  expect(pickTemplateSheet([a, b], columns).name).toBe("A");
  const none = pickTemplateSheet([{ name: "S", matrix: [["foo"]] }], columns);
  expect(none).toMatchObject({ name: "S", headerIndex: 0 });
});

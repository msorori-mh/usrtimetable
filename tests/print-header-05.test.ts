/** PRINT-HEADER-05 — compact Arabic RTL timetable header regressions. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("PRINT-HEADER-05 compact print header", () => {
  const sheet = read("src/components/print-center/print-sheet.tsx");
  const css = read("src/styles.css");
  const fixture = read("scripts/print-proof/shell-entry.tsx");
  const runner = read("scripts/print-proof/run-shell.py");

  test("keeps the official identity, centered timetable title, QR and group title", () => {
    expect(sheet.includes('data-print-header="compact"')).toBe(true);
    expect(sheet.includes("print-header-institution")).toBe(true);
    expect(sheet.includes("print-header-title-block")).toBe(true);
    expect(sheet.includes(">الجدول الأسبوعي</p>")).toBe(true);
    expect(sheet.includes("الجدول الأسبوعي المعتمد")).toBe(false);
    expect(sheet.includes("الجدول الدراسي")).toBe(true);
    expect(sheet.includes('title="رابط الطباعة"')).toBe(true);
    expect(sheet.includes("print-center-context-row")).toBe(true);
  });

  test("retains all existing optional header fields and labels", () => {
    for (const marker of [
      "visibility.showCollege",
      "visibility.showDepartment",
      "visibility.showProgram",
      "visibility.showLevel",
      "visibility.showStudySystem",
      "visibility.showVersionStatus",
      "visibility.showVersionNumber",
      "visibility.showExportDate",
      "visibility.showQr",
      "REPORT_COLLEGE_NAME_FALLBACK_AR",
    ]) {
      expect(sheet.includes(marker)).toBe(true);
    }
    for (const label of ["القسم", "البرنامج", "المستوى", "النظام الدراسي", "الفصل / العام"]) {
      expect(sheet.includes(`label="${label}"`)).toBe(true);
    }
  });

  test("uses a bounded responsive grid and compact print dimensions", () => {
    for (const marker of [
      ".print-header-identity-band",
      ".print-header-details",
      "grid-template-columns: repeat(3, minmax(0, 1fr))",
      "overflow-wrap: anywhere",
      "@media screen and (max-width: 640px)",
      "font-size: 7.5pt",
    ]) {
      expect(css.includes(marker)).toBe(true);
    }
  });

  test("real full-shell fixture and runner exercise long Arabic metadata", () => {
    expect(fixture.includes('from "@/components/app-layout"')).toBe(true);
    expect(fixture.includes('from "@/components/print-center/print-sheet"')).toBe(true);
    expect(fixture.includes("والأنظمة الذكية التطبيقية")).toBe(true);
    expect(fixture.includes("وهندسة البرمجيات المتقدمة")).toBe(true);
    expect(runner.includes("compact identity/title/details/meta header structure")).toBe(true);
    expect(runner.includes("compact header stays at or below 200px at printable width")).toBe(true);
  });
});

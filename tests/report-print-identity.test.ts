/**
 * PRINT-REGRESSION — every schedule report print path must carry the official
 * identity band: university logo, university + college name, term/system, report
 * title, version metadata and a REAL verification QR (the report URL).
 *
 * Root cause covered: only /reports/program-level-timetable rendered the branded
 * PrintSheet; all other report print paths (notably /reports/instructor-schedule)
 * printed the plain screen header, which had no logo and no QR.
 */
import { describe, expect, test } from "bun:test";
import { printPageStyleCss } from "../src/lib/print-center/page-style";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const header = read("src/components/reports/report-official-header.tsx");
const shell = read("src/components/reports/report-shell.tsx");
const css = read("src/styles.css");

describe("report print identity", () => {
  test("official report header renders the local university logo asset", () => {
    expect(header.includes("USR_UNIVERSITY_LOGO_SRC")).toBe(true);
    expect(header.includes("print-header-logo")).toBe(true);
    expect(existsSync(resolve(root, "public/branding/usr-university-logo.png"))).toBe(true);
  });

  test("official report header renders a real verification QR from a URL", () => {
    expect(header.includes("PrintQrCode")).toBe(true);
    expect(header.includes("qrUrl")).toBe(true);
    expect(header.includes('title="رابط التقرير"')).toBe(true);
  });

  test("header keeps university, college, title, term, version and generation data", () => {
    for (const marker of [
      "REPORT_UNIVERSITY_NAME_AR",
      "REPORT_COLLEGE_NAME_FALLBACK_AR",
      "reportTitle",
      "الفصل الدراسي",
      "نسخة الجدول",
      "حالة النسخة",
      "النظام الدراسي",
      "تاريخ التوليد",
    ]) {
      expect(header.includes(marker)).toBe(true);
    }
  });

  test("shell supplies the current report URL to the QR and an A4 RTL page box", () => {
    expect(shell.includes("window.location.href")).toBe(true);
    expect(shell.includes('printPageStyleCss("A4", printOrientation)')).toBe(true);
    expect(shell.includes('printOrientation = "portrait"')).toBe(true);
    expect(printPageStyleCss()).toContain("size: A4 portrait;");
    expect(shell.includes('dir="rtl"')).toBe(true);
  });

  test("print CSS avoids splitting the header and table rows", () => {
    expect(css.includes(".report-official-header")).toBe(true);
    for (const marker of [
      "page-break-inside: avoid",
      "break-inside: avoid",
      "display: table-header-group",
    ]) {
      expect(css.includes(marker)).toBe(true);
    }
  });

  test("regression: single instructor schedule prints detail page then weekly page", () => {
    const route = read("src/routes/_authenticated/reports.instructor-schedule.tsx");
    const view = read("src/components/reports/report-timetable-view.tsx");
    expect(route.includes("ReportShell")).toBe(true);
    expect(route.includes("window.print")).toBe(false);
    expect(route.includes("printDetailOnly")).toBe(false);
    expect(route.includes("compactDetails")).toBe(true);
    expect(view.includes("instructor-print-page--first")).toBe(true);
    expect(view.includes("instructor-print-page--second")).toBe(true);
    expect(view).toMatch(/<>\s*\{detailPage\}\s*\{weeklyPage\}\s*<\/>/);
    expect(view.includes('data-print-section="details"')).toBe(true);
    expect(view.includes('data-print-section="weekly"')).toBe(true);
    expect(view.includes("compactInstructorDetailColumns")).toBe(true);
    expect(view.includes('data-testid="instructor-academic-context"')).toBe(true);
    expect(view.includes('label: "المستوى"')).toBe(true);
    expect(view.includes('label: "البرنامج والمستوى"')).toBe(false);
    expect(view.includes('label: "المجموعة"')).toBe(true);
    expect(view.includes('label: "الدفعة والمجموعة"')).toBe(false);
    expect(view.includes("compactSessionTypeLabel")).toBe(true);
    expect(view.includes("row.course_code")).toBe(false);
    expect(view.includes("detailText(row.hours)")).toBe(false);
    expect(view.includes("instructor-detail-room")).toBe(true);
    expect(view.includes("instructor-detail-group")).toBe(true);
    expect(view.includes('className: "w-[21%] text-center align-middle"')).toBe(true);
    expect(view.includes("compactAcademicLevelLabel")).toBe(true);
  });

  test("no report route uses a bespoke print path that bypasses the shell header", () => {
    const dir = resolve(root, "src/routes/_authenticated");
    const routes = readdirSync(dir).filter((f) => f.startsWith("reports.") && f.endsWith(".tsx"));
    expect(routes.length).toBeGreaterThan(5);
    for (const file of routes) {
      const src = read(`src/routes/_authenticated/${file}`);
      if (file === "reports.index.tsx" || file === "reports.tsx") continue;
      expect(src.includes("window.print()")).toBe(false);
    }
  });
});

/**
 * REPORTS-VISUAL-BATCH-INVENTORY-01 — proves the shared batch is what every
 * report route inherits: one shell, one header, one state machine, one filter
 * bar, one KPI strip, plus a discoverable hub. Pure file inventory, no DB.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

const ROUTES_DIR = "src/routes/_authenticated";
const SHARED_DIR = "src/components/reports";
const HUB = "reports.index.tsx";
const LAYOUT = "reports.tsx";
const read = (path: string) => readFileSync(path, "utf8");

const routeFiles = readdirSync(ROUTES_DIR).filter(
  (f) => f.startsWith("reports.") && f.endsWith(".tsx"),
);
const contentRoutes = routeFiles.filter((f) => f !== HUB && f !== LAYOUT);

describe("shared report batch inventory", () => {
  test("the report surface is fully enumerated: hub + layout + content routes", () => {
    expect(routeFiles).toContain(HUB);
    expect(routeFiles).toContain(LAYOUT);
    expect(contentRoutes.length).toBeGreaterThanOrEqual(13);
  });

  test("every shared presentation module of the batch exists", () => {
    for (const file of [
      "report-shell.tsx",
      "report-official-header.tsx",
      "report-kpis.tsx",
      "report-filter-bar.tsx",
      "report-filters.tsx",
      "report-states.tsx",
      "report-section.tsx",
      "report-timetable-view.tsx",
    ]) {
      expect(read(`${SHARED_DIR}/${file}`).length).toBeGreaterThan(0);
    }
  });

  test("every content route inherits the shell (no ad-hoc report chrome)", () => {
    for (const file of contentRoutes) {
      const src = read(`${ROUTES_DIR}/${file}`);
      expect(src).toContain("@/components/reports/report-shell");
      expect(src).toContain("<ReportShell");
    }
  });

  test("the shell owns header, KPIs, states and export for all routes", () => {
    const shell = read(`${SHARED_DIR}/report-shell.tsx`);
    for (const dependency of [
      "ReportOfficialHeader",
      "ReportKpiRow",
      "ReportErrorState",
      "ReportNotReadyState",
      "ReportLoadingState",
      "ReportEmptyState",
      "downloadCSV",
      "downloadXLSX",
      "printPageStyleCss",
    ]) {
      expect(shell).toContain(dependency);
    }
  });

  // Deliberate, reviewed exceptions (keep this list short and explained):
  // - instructor-schedule / rooms-report print several sheets in one job; each sheet
  //   repeats the official header via <RepeatingPrintHeader header={<ReportOfficialHeader…/>}>
  //   (a9b9c88, d6a8411). They still render inside <ReportShell>.
  // - teaching-demand-capacity offers an additional «summary» CSV next to the shell export.
  const OFFICIAL_HEADER_ALLOWED = new Set([
    "reports.instructor-schedule.tsx",
    "reports.rooms-report.tsx",
  ]);
  const EXTRA_CSV_ALLOWED = new Set(["reports.teaching-demand-capacity.tsx"]);

  test("no content route re-implements the official header or export buttons", () => {
    for (const file of contentRoutes) {
      const src = read(`${ROUTES_DIR}/${file}`);
      if (OFFICIAL_HEADER_ALLOWED.has(file)) {
        // Only the repeating per-sheet print header form is allowed.
        const uses = src.split("<ReportOfficialHeader").length - 1;
        const repeated = src.split("<RepeatingPrintHeader").length - 1;
        expect(uses).toBeLessThanOrEqual(repeated);
      } else {
        expect(src.includes("<ReportOfficialHeader")).toBe(false);
      }
      if (!EXTRA_CSV_ALLOWED.has(file)) expect(src.includes("downloadCSV(")).toBe(false);
    }
  });

  test("the hub stays searchable, sectioned and SEO-described", () => {
    const hub = read(`${ROUTES_DIR}/${HUB}`);
    expect(hub).toContain("normalizeSearchText");
    expect(hub).toContain("ابحث عن تقرير");
    expect(hub).toContain("reports-legacy-section");
    expect(hub).toContain('name: "description"');
    expect(hub).toContain('property: "og:title"');
  });

  test("the hub links only to routes that exist", () => {
    const hub = read(`${ROUTES_DIR}/${HUB}`);
    const links = [...hub.matchAll(/to: "\/reports\/([a-z-]+)"/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThanOrEqual(13);
    for (const slug of links) {
      expect(routeFiles).toContain(`reports.${slug}.tsx`);
    }
  });

  // education-source-timetable is a single-college page (كلية التربية) reached from the
  // published-timetable, published-schedules and timetable pages, not from the hub.
  const NOT_IN_HUB = new Set(["reports.education-source-timetable.tsx"]);

  test("every content route is reachable from the hub", () => {
    const hub = read(`${ROUTES_DIR}/${HUB}`);
    for (const file of contentRoutes.filter((f) => !NOT_IN_HUB.has(f))) {
      const slug = file.replace(/^reports\./, "").replace(/\.tsx$/, "");
      expect(hub).toContain(`to: "/reports/${slug}"`);
    }
  });

  test("the whole report surface stays read-only", () => {
    for (const file of routeFiles) {
      const src = read(`${ROUTES_DIR}/${file}`);
      // URLSearchParams.delete(...) is not a write; strip it before checking for DML.
      const code = src.replace(/searchParams\.delete\(/g, "searchParams_remove(");
      for (const dml of [".insert(", ".update(", ".upsert(", ".delete("]) {
        expect(code.includes(dml)).toBe(false);
      }
    }
  });
});

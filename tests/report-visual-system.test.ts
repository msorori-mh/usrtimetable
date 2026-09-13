import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import {
  filterRowsBySearch,
  normalizeSearchText,
  rowMatchesSearch,
} from "../src/lib/reports/search";

const ROUTES_DIR = "src/routes/_authenticated";
const reportRoutes = readdirSync(ROUTES_DIR).filter(
  (f) => f.startsWith("reports.") && f.endsWith(".tsx"),
);
const read = (file: string) => readFileSync(`${ROUTES_DIR}/${file}`, "utf8");

describe("shared report visual system", () => {
  test("every report route (except the hub) renders through ReportShell", () => {
    for (const file of reportRoutes) {
      if (file === "reports.index.tsx") continue;
      expect(read(file)).toContain("ReportShell");
    }
  });

  test("report routes use the shared filter bar, not ad-hoc filter grids", () => {
    for (const file of reportRoutes) {
      if (file === "reports.index.tsx") continue;
      const src = read(file);
      if (!src.includes("filters={")) continue;
      expect(
        src.includes("ReportFilterBar") ||
          src.includes("<ReportFilters") ||
          src.includes("ReportFilterField"),
      ).toBe(true);
    }
  });

  test("report routes never issue write operations", () => {
    for (const file of reportRoutes) {
      const src = read(file);
      for (const dml of [".insert(", ".update(", ".upsert(", ".delete("]) {
        expect(src.includes(dml)).toBe(false);
      }
    }
  });

  test("shell keeps the state machine order error → not ready → loading → empty", () => {
    const shell = readFileSync("src/components/reports/report-shell.tsx", "utf8");
    const order = ["ReportErrorState", "ReportNotReadyState", "ReportLoadingState", "ReportEmptyState"];
    const positions = order.map((name) => shell.indexOf(`<${name}`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test("official print header keeps logo, QR and university identity", () => {
    const header = readFileSync("src/components/reports/report-official-header.tsx", "utf8");
    expect(header).toContain("PrintQrCode");
    expect(header).toContain("USR_UNIVERSITY_LOGO_SRC");
    expect(header).toContain("REPORT_UNIVERSITY_NAME_AR");
    expect(header).toContain("print-header-college");
  });

  test("KPI strip is screen-only and capped at five indicators", () => {
    const kpis = readFileSync("src/components/reports/report-kpis.tsx", "utf8");
    expect(kpis).toContain("report-no-print");
    expect(kpis).toContain("items.slice(0, 5)");
  });

  test("advanced filters are collapsed behind a disclosure", () => {
    const bar = readFileSync("src/components/reports/report-filter-bar.tsx", "utf8");
    expect(bar).toContain("report-advanced-filters-toggle");
    expect(bar).toContain("useState(false)");
    expect(bar).toContain("report-no-print");
  });

  test("published timetable keeps its export headers and published-only scope", () => {
    const src = read("reports.published-timetable.tsx");
    expect(src).toContain('.eq("status", "published")');
    for (const key of [
      "version",
      "department",
      "program",
      "level",
      "cohort",
      "delivery_group",
      "course",
      "day",
      "time",
      "session_type",
      "instructor",
      "room",
    ]) {
      expect(src).toContain(`key: "${key}"`);
    }
  });

  test("program/level timetable still exports the honest status column", () => {
    const src = read("reports.program-level-timetable.tsx");
    expect(src).toContain("PROGRAM_TIMETABLE_EXPORT_HEADERS");
    expect(src).toContain('{ key: "status", label: "الحالة" }');
    expect(src).toContain("buildDeliveryGroupCoverage");
  });
});

describe("presentation-only search", () => {
  const rows = [
    { course: "CS101 مقدمة", instructor: "أحمد", room: "A1" },
    { course: "CS102 خوارزميات", instructor: "سعيد", room: "B2" },
  ];

  test("empty query keeps every row and its keys", () => {
    const out = filterRowsBySearch(rows, "  ");
    expect(out).toEqual(rows);
    expect(Object.keys(out[0]!)).toEqual(Object.keys(rows[0]!));
  });

  test("matching narrows rows without changing values", () => {
    const out = filterRowsBySearch(rows, "خوارزميات");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(rows[1]!);
  });

  test("normalization ignores case, diacritics and alef variants", () => {
    expect(normalizeSearchText("أحمد")).toBe(normalizeSearchText("احمد"));
    expect(rowMatchesSearch(rows[0]!, "cs101")).toBe(true);
  });
});

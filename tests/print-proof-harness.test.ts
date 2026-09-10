/**
 * LAUNCH-CLOSURE-03 print/export proof — source-level contracts.
 *
 * The behavioural proof is produced by `scripts/print-proof/run.py` in a real
 * Chromium (PDF + PNG + downloaded CSV/XLSX bytes under docs/print-proof/).
 * These tests guard the invariants that make that proof meaningful:
 *   - the harness renders the REAL PrintSheet + REAL export helpers, not a copy,
 *   - the printed page box comes from one shared source of truth,
 *   - the fixture is synthetic (no production college / no auth / no database),
 *   - the recorded results file matches an all-green run.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { PRINT_PAGE_STYLE_ELEMENT_ID, printPageStyleCss } from "@/lib/print-center/page-style";

const read = (p: string) => readFileSync(p, "utf8");
const ENTRY = read("scripts/print-proof/entry.tsx");
const FIXTURE = read("scripts/print-proof/fixture.ts");
const RUNNER = read("scripts/print-proof/run.py");
const PAGE = read("src/components/print-center/print-center-page.tsx");
const STYLES = read("src/styles.css");

describe("printed page box is a single source of truth", () => {
  test("printPageStyleCss emits a real @page rule per paper size and orientation", () => {
    expect(printPageStyleCss("A4", "portrait")).toContain("@page { size: A4 portrait;");
    expect(printPageStyleCss("A3", "landscape")).toContain("@page { size: A3 landscape;");
    expect(printPageStyleCss("A4", "portrait")).toContain("margin: 1.2cm 1.5cm");
    expect(PRINT_PAGE_STYLE_ELEMENT_ID).toBe("print-center-page-style");
  });

  test("the print centre injects the shared helper instead of an inline duplicate", () => {
    expect(PAGE).toContain("printPageStyleCss(paper, orientation)");
    expect(PAGE).toContain("PRINT_PAGE_STYLE_ELEMENT_ID");
    expect(PAGE).not.toContain("@page { size: ${paper}");
  });

  test("the proof harness reuses the same helper, so it cannot drift from the app", () => {
    expect(ENTRY).toContain("printPageStyleCss");
    expect(ENTRY).toContain("PRINT_PAGE_STYLE_ELEMENT_ID");
  });
});

describe("footer orphaning fix (observed on A3 landscape)", () => {
  test("the endorsement footer is told not to start a new printed page", () => {
    const printBlock = STYLES.slice(STYLES.indexOf("@media print"));
    expect(printBlock).toContain("break-before: avoid");
    expect(printBlock).toContain("page-break-before: avoid");
    expect(printBlock).toContain("display: table-header-group");
  });
});

describe("the harness exercises real application code", () => {
  test("it mounts the real PrintSheet and the real filter/group/export pipeline", () => {
    for (const symbol of [
      "@/components/print-center/print-sheet",
      "filterPrintSessions",
      "groupPrintPages",
      "buildExportRows",
      "@/styles.css",
    ]) {
      expect(ENTRY).toContain(symbol);
    }
  });

  test("it downloads through the existing export helpers, not a reimplementation", () => {
    expect(ENTRY).toContain("@/lib/reports/export");
    expect(ENTRY).toContain("downloadCSV");
    expect(ENTRY).toContain("downloadXLSX");
    expect(ENTRY).toContain("@/lib/admin-export/to-xlsx");
    expect(ENTRY).toContain("exportRowsToXlsx");
  });
});

describe("the fixture is isolated from production", () => {
  test("the college id is synthetic and no client/database/auth module is imported", () => {
    expect(FIXTURE).toContain('"00000000-0000-4000-8000-00000000f170"');
    for (const forbidden of ["@/integrations/supabase", "supabase", "auth"]) {
      expect(ENTRY.includes(forbidden)).toBe(false);
      expect(FIXTURE.includes(forbidden)).toBe(false);
    }
  });

  test("short fixture mirrors the published 2-session shape; long fixture is multi-page Arabic", () => {
    expect(FIXTURE).toContain('session_type: "practical"');
    expect(FIXTURE).toContain('session_type: "theory"');
    expect(FIXTURE).toContain("length: 120");
    expect(FIXTURE).toContain("أساسيات هندسة البرمجيات");
  });

  test("the program report is complete, so the filter does not silently drop every row", () => {
    expect(FIXTURE).toContain('reportType: "program"');
    expect(FIXTURE).toContain('programId: "fx-prog-1"');
  });
});

describe("the runner proves the gates it claims", () => {
  test("it covers A4/A3 x portrait/landscape with CSS page size honoured", () => {
    for (const combo of [
      '("A4", "portrait")',
      '("A4", "landscape")',
      '("A3", "portrait")',
      '("A3", "landscape")',
    ]) {
      expect(RUNNER).toContain(combo);
    }
    expect(RUNNER).toContain("prefer_css_page_size=True");
    expect(RUNNER).toContain("print_background=True");
  });

  test("it checks clipping, blank pages, repeated headers and horizontal overflow", () => {
    expect(RUNNER).toContain("clipping_report");
    expect(RUNNER).toContain("no blank printed pages");
    expect(RUNNER).toContain("table header repeats on every page that carries rows");
    expect(RUNNER).toContain("no horizontal overflow");
  });

  test("it captures actual downloaded bytes rather than only firing the helper", () => {
    expect(RUNNER).toContain("expect_download");
    expect(RUNNER).toContain("dl.save_as");
    expect(RUNNER).toContain("utf-8-sig");
  });

  test("the recorded run under docs/print-proof is all-green", () => {
    const results = JSON.parse(read("docs/print-proof/RESULTS.json")) as {
      total: number;
      passed: number;
      failed: string[];
    };
    expect(results.failed).toEqual([]);
    expect(results.passed).toBe(results.total);
    expect(results.total).toBeGreaterThanOrEqual(50);
  });
});

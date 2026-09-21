/**
 * LAUNCH-CLOSURE-04 — full-shell print regressions.
 *
 * The root review of an actual user-produced PDF found that the mobile AppLayout
 * header, brand mark and college badge printed on top of the official sheet header,
 * and that the viewport-sized flex shell clipped the QR code and the heading edge.
 * The earlier proof mounted PrintSheet standalone and could not see any of it.
 *
 * These tests pin the narrow print-only fix (chrome tagging + shell release) and the
 * existence/outcome of the full-shell runtime proof.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

describe("LAUNCH-CLOSURE-04 print-only app chrome suppression", () => {
  const layout = read("src/components/app-layout.tsx");
  const css = read("src/styles.css");

  test("app shell tags its print-only chrome and its root wrapper", () => {
    expect(layout.includes('data-app-shell="root"')).toBe(true);
    expect(layout.includes('data-app-chrome="mobile-header"')).toBe(true);
    expect(layout.includes('data-app-chrome="context-bar"')).toBe(true);
    // screen UI untouched: the mobile header is still md:hidden, badge still rendered
    expect(layout.includes("md:hidden")).toBe(true);
    expect(layout.includes('data-testid="page-context-bar"')).toBe(true);
  });

  test("print stylesheet hides chrome and releases the shell viewport box", () => {
    const print = css.slice(css.indexOf("@media print"));
    expect(print.includes("[data-app-chrome]")).toBe(true);
    expect(print.includes('[data-app-shell="root"]')).toBe(true);
    // the flex/height/overflow constraints of the shell must be released
    for (const rule of [
      "min-height: 0 !important",
      "overflow: visible !important",
      "flex: none !important",
    ]) {
      expect(print.includes(rule)).toBe(true);
    }
    // official header stays printed
    expect(print.includes(".print-center-header")).toBe(true);
    expect(print.includes(".print-center-header,\n  .print-center-footer")).toBe(true);
  });
});

describe("LAUNCH-CLOSURE-04 full-shell proof harness", () => {
  test("fixture mounts the REAL AppLayout around the REAL PrintSheet", () => {
    const entry = read("scripts/print-proof/shell-entry.tsx");
    expect(entry.includes('from "@/components/app-layout"')).toBe(true);
    expect(entry.includes('from "@/components/print-center/print-sheet"')).toBe(true);
    expect(entry.includes("printPageStyleCss")).toBe(true);
    expect(entry.includes("filterPrintSessions")).toBe(true);
    expect(entry.includes("groupPrintPages")).toBe(true);
  });

  test("fixture mocks touch no database and no auth", () => {
    const client = read("scripts/print-proof/mocks/supabase-client.ts");
    expect(client.includes("no database access is allowed")).toBe(true);
    for (const f of [
      "mocks/use-current-user.ts",
      "mocks/use-colleges.ts",
      "mocks/react-router.tsx",
    ]) {
      expect(existsSync(resolve(root, "scripts/print-proof", f))).toBe(true);
    }
    const vite = read("scripts/print-proof/vite.config.mts");
    expect(vite.includes("mocks/supabase-client.ts")).toBe(true);
    expect(vite.includes("shell.html")).toBe(true);
  });

  test("runner covers both viewports and fixtures on A4 portrait", () => {
    const runner = read("scripts/print-proof/run-shell.py");
    expect(runner.includes('("desktop"')).toBe(true);
    expect(runner.includes('("mobile"')).toBe(true);
    expect(runner.includes('combos = [("A4", "portrait")]')).toBe(true);
    expect(runner.includes('for f in ("long", "short")')).toBe(true);
    expect(runner.includes("no app chrome printed")).toBe(true);
    expect(runner.includes("official sheet header printed")).toBe(true);
    expect(runner.includes("clipping check")).toBe(true);
    expect(runner.includes("physical counters correct and sequential")).toBe(true);
    expect(runner.includes("no blank printed pages")).toBe(true);
    // measured at the real printable width, not the browser viewport width
    expect(runner.includes("def content_px")).toBe(true);
  });

  test("recorded full-shell proof run passed every case", () => {
    const res = JSON.parse(read("docs/print-proof/full-shell/RESULTS.json")) as {
      total: number;
      passed: number;
      failed: string[];
      cases: { name: string; pass: boolean }[];
    };
    expect(res.failed).toEqual([]);
    expect(res.passed).toBe(res.total);
    expect(res.total).toBeGreaterThanOrEqual(200);
    const names = res.cases.map((c) => c.name).join("\n");
    for (const needle of [
      "mobile A4 portrait short: no app chrome printed",
      "desktop A4 portrait long: no ink touching the page edge (clipping check)",
      "mobile A4 portrait short: all 8 columns present in every sheet",
      "mobile A4 portrait short: exactly the 2 fixture rows (practical Sunday + theory Monday)",
    ]) {
      expect(names.includes(needle)).toBe(true);
    }
    expect(res.cases.every((c) => c.pass)).toBe(true);
  });

  test("actual user artifact hashes are recorded and the PDF gate stays on HOLD", () => {
    const report = read("docs/LAUNCH-CLOSURE-04-FULL-SHELL-PRINT.md");
    for (const sha of [
      "24af512cbdb2f0f3119c92a38dd414fb0584cd44bce5fee85dd895a4878cb625",
      "d54657db434abcb1a8ce2ad5324e20866878ee3fd5959bc2ccc0ae3add58a8e9",
      "65f6820d85e8218e05f244a91293328d68695a9190ddf53d8c07f4786ffc54a7",
    ]) {
      expect(report.includes(sha)).toBe(true);
    }
    expect(report.includes("HOLD")).toBe(true);
  });
});

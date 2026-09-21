import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { printPageStyleCss } from "../src/lib/print-center/page-style";

const PRINT_ROOTS = [
  "src/lib/print-center",
  "src/components/print-center",
  "src/components/reports",
  "src/routes/_authenticated",
  "scripts/print-proof",
  "scripts/reports-proof",
];

function filesUnder(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesUnder(child) : [child];
  });
}

const printSources = [...PRINT_ROOTS.flatMap(filesUnder), "src/styles.css"].filter((path) => {
  if (!/\.(css|ts|tsx|js|mjs)$/.test(path)) return false;
  return /print|@page|PDF/i.test(readFileSync(path, "utf8"));
});

describe("platform print page standard", () => {
  test("the shared page box is A4 portrait with safe margins", () => {
    const css = printPageStyleCss();
    expect(css).toContain("size: A4 portrait;");
    expect(css).toContain("margin: 1.2cm 1.5cm;");
  });

  test("no print source can request a non-standard page", () => {
    const violations = printSources.filter((path) => {
      const source = readFileSync(path, "utf8");
      return /\blandscape\b|\bA3\b|printOrientation|PrintOrientation|PrintPaperSize/.test(source);
    });
    expect(violations).toEqual([]);
  });

  test("all report routes use the shared shell or shared page helper", () => {
    const routes = filesUnder("src/routes/_authenticated").filter(
      (path) => /reports\..*\.tsx$/.test(path) && !/reports\.(index|route)\.tsx$/.test(path),
    );
    const bypasses = routes.filter((path) => {
      const source = readFileSync(path, "utf8");
      return !source.includes("ReportShell") && !source.includes("printPageStyleCss");
    });
    expect(bypasses).toEqual([]);
  });
});

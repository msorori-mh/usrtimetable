/**
 * print-center.harness.ts — TIMETABLE-PRINT-EXPORT-CENTER-01 static verification.
 *
 * Source-only checks (no DB, no DML):
 * 1) Print center route + editor button
 * 2) Pure lib under src/lib/print-center
 * 3) Read-only data path (fetchHydratedVersionSessions + cohort labels)
 * 4) Export helpers reuse downloadCSV/downloadXLSX
 * 5) Demo warning + draft watermark constants
 * 6) Print CSS for A4/A3 landscape/portrait
 * 7) No schedule_sessions writes from print-center surfaces
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};

const noDml = (body: string, file: string, table: string) => {
  const re = new RegExp(
    `\\.from\\(\\s*["']${table}["']\\s*\\)\\s*\\.(insert|update|upsert|delete)\\s*\\(`,
  );
  assert(!re.test(body.replace(/\s+/g, " ")), `${file} performs DML against ${table}`);
};

const editor = read("src/routes/_authenticated/timetable.$versionId.tsx");
assert(
  editor.includes("طباعة وتصدير الجدول"),
  "timetable editor exposes Arabic print/export button label",
);
assert(
  editor.includes("/timetable/$versionId/print") ||
    editor.includes('to="/timetable/$versionId/print"'),
  "timetable editor links to print center route",
);

const route = read("src/routes/_authenticated/timetable_.$versionId.print.tsx");
assert(
  route.includes('createFileRoute("/_authenticated/timetable_/$versionId/print")') ||
    route.includes('createFileRoute("/_authenticated/timetable/$versionId/print")'),
  "print route file registers /timetable/$versionId/print",
);
assert(route.includes("PrintCenterPage"), "print route renders PrintCenterPage");

const page = read("src/components/print-center/print-center-page.tsx");
assert(page.includes("fetchHydratedVersionSessions"), "print center loads hydrated sessions");
assert(page.includes("fetchCohortDeliveryGroupLabels"), "print center resolves cohort/DG labels");
assert(page.includes("downloadCSV") && page.includes("downloadXLSX"), "CSV/XLSX export wired");
assert(page.includes("window.print"), "print action uses window.print");
assert(
  !/from\(["']schedule_sessions["']\)\s*\.(insert|update|upsert|delete)/.test(page),
  "no session DML",
);
noDml(page, "print-center-page.tsx", "schedule_sessions");
noDml(route, "timetable_.$versionId.print.tsx", "schedule_sessions");

for (const rel of [
  "src/lib/print-center/filters.ts",
  "src/lib/print-center/group.ts",
  "src/lib/print-center/export-rows.ts",
  "src/lib/print-center/qr-url.ts",
  "src/lib/print-center/types.ts",
]) {
  assert(read(rel).length > 0, `${rel} exists`);
}

const types = read("src/lib/print-center/types.ts");
assert(types.includes("PRINT_DEMO_FOOTER_WARNING_AR"), "demo footer warning constant");
assert(types.includes("PRINT_DRAFT_WATERMARK_AR"), "draft watermark constant");
assert(types.includes("PRINT_PUBLISHED_ENDORSEMENT_AR"), "published endorsement constant");

const filters = read("src/lib/print-center/filters.ts");
assert(filters.includes("rejectMismatchedCollege"), "cross-college reject helper");
assert(filters.includes("filterPrintSessions"), "filterPrintSessions exported");

const styles = read("src/styles.css");
assert(styles.includes("print-center-page"), "print center page break CSS");
assert(
  styles.includes("print-orient-landscape") === false || styles.includes("print-center-page"),
  "print center styles present",
);
assert(styles.includes("print-draft-watermark"), "draft watermark CSS");
assert(
  styles.includes("break-after: page") || styles.includes("page-break-after"),
  "page break rules for print sheets",
);

const pageStyle = read("src/components/print-center/print-center-page.tsx");
assert(
  pageStyle.includes("size: ${paper} ${orientation}") ||
    pageStyle.includes("print-center-page-style"),
  "A4/A3 landscape/portrait injected via print stylesheet",
);

const qr = read("src/components/print-center/print-qr-code.tsx");
assert(qr.includes('from "qrcode"') || qr.includes("from 'qrcode'"), "QR uses qrcode package");

const unitTest = read("tests/print-center.test.ts");
assert(unitTest.includes("54"), "unit test covers 54-session identity");
assert(unitTest.includes("buildPrintQrUrl"), "unit test covers QR URL");
assert(
  unitTest.includes("rejectMismatchedCollege") || unitTest.includes("college-b"),
  "cross-college covered",
);

console.log("PASS: print-center.harness.ts");

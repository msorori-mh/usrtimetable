/**
 * DEPENDENCY-SECURITY-REMEDIATION-01 harness mirror for Excel remount.
 * Pure local checks — no DB writes.
 */
import * as XLSX from "xlsx";
import {
  TEMPLATES,
  buildTemplateWorkbook,
  parseExcel,
} from "../../src/lib/excel-import/templates.ts";
import { parseSourceWorkbookFile } from "../../src/lib/excel-import/teaching-assignments-source-parser.ts";
import { anonymizedRealWorkbookSheet } from "../fixtures/teaching-assignments-source/anonymized-real-layout.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function blobToFile(blob: Blob, name: string): Promise<File> {
  const buf = await blob.arrayBuffer();
  return new File([buf], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

async function run() {
  const pkg = await import("../../node_modules/xlsx/package.json", {
    with: { type: "json" },
  });
  assert(pkg.default.name === "@e965/xlsx", `xlsx remount name=${pkg.default.name}`);
  assert(pkg.default.version === "0.20.3", `xlsx remount version=${pkg.default.version}`);

  for (const entity of [
    "teaching_assignments_v2",
    "study_plan_courses",
    "full_study_plan",
  ] as const) {
    const tpl = TEMPLATES[entity];
    const blob = await buildTemplateWorkbook(entity);
    const file = await blobToFile(blob, `${entity}.xlsx`);
    const { headers, rows } = await parseExcel(file);
    assert(
      headers.length === tpl.columns.length && headers.every((h, i) => h === tpl.columns[i].header),
      `${entity}: headers match template contract`,
    );
    assert(rows.length >= 1, `${entity}: example row present`);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(anonymizedRealWorkbookSheet.map((r) => [...r]));
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
  const sourceFile = new File([out], "source-ta.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const parsed = await parseSourceWorkbookFile(sourceFile);
  assert(parsed.sheets.length === 1, "source workbook: one sheet");
  assert(parsed.totalDataRows > 0, "source workbook: data rows parsed");
  assert(parsed.sheets[0].sheetName === "Sheet1", "source workbook: sheet name");
  assert(parsed.sheets[0].dataRowCount > 0, "source workbook: sheet data rows");

  console.log("PASS xlsx-remediation-regression");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

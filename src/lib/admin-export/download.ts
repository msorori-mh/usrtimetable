/**
 * ADMIN-EXPORT-01 — browser writers for admin exports (CSV + Excel).
 * Excel workbooks always carry a data sheet and a filter-criteria sheet.
 */
import * as XLSX from "xlsx";
import {
  ADMIN_EXPORT_CRITERIA_SHEET_AR,
  adminExportFilename,
  buildAdminExportCsv,
  buildAdminExportMetadata,
  buildAdminExportTable,
  type AdminExportCell,
  type AdminExportDataset,
} from "./dataset";

export type AdminExportFormat = "xlsx" | "csv";

export const ADMIN_EXPORT_FORMAT_LABEL_AR: Record<AdminExportFormat, string> = {
  xlsx: "تصدير Excel",
  csv: "تصدير CSV",
};

function sheetName(name: string, fallback: string): string {
  const clean = name.replace(/[\\/?*[\]:]/g, " ").trim();
  return (clean || fallback).slice(0, 31);
}

function autoWidths(matrix: AdminExportCell[][]): { wch: number }[] {
  const widths: number[] = [];
  for (const row of matrix) {
    row.forEach((cell, i) => {
      const len = String(cell).length + 2;
      widths[i] = Math.min(48, Math.max(widths[i] ?? 10, len));
    });
  }
  return widths.map((wch) => ({ wch }));
}

/** Build the workbook object (exported for tests; no DOM access). */
export function buildAdminExportWorkbook<T>(
  dataset: AdminExportDataset<T>,
  now: Date = new Date(),
): XLSX.WorkBook {
  const table = buildAdminExportTable(dataset);
  const matrix: AdminExportCell[][] = [table.headers, ...table.body];
  const ws = XLSX.utils.aoa_to_sheet(matrix);
  (ws as unknown as { "!views"?: unknown[] })["!views"] = [{ RTL: true }];
  (ws as unknown as { "!cols"?: unknown[] })["!cols"] = autoWidths(matrix);
  (ws as unknown as { "!freeze"?: unknown })["!freeze"] = { xSplit: 0, ySplit: 1 };
  const meta = buildAdminExportMetadata(dataset, now);
  const metaWs = XLSX.utils.aoa_to_sheet(meta);
  (metaWs as unknown as { "!views"?: unknown[] })["!views"] = [{ RTL: true }];
  (metaWs as unknown as { "!cols"?: unknown[] })["!cols"] = autoWidths(meta);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName(dataset.sheetName, "البيانات"));
  XLSX.utils.book_append_sheet(wb, metaWs, sheetName(ADMIN_EXPORT_CRITERIA_SHEET_AR, "Filters"));
  return wb;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export the dataset. Throws Arabic, actionable errors (empty result, too many
 * rows) so callers can surface them with a toast.
 */
export function exportAdminDataset<T>(
  dataset: AdminExportDataset<T>,
  format: AdminExportFormat,
  now: Date = new Date(),
): { filename: string; rowCount: number } {
  const base = adminExportFilename(dataset.fileBase, now);
  if (format === "csv") {
    const csv = buildAdminExportCsv(dataset, now);
    triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${base}.csv`);
    return { filename: `${base}.csv`, rowCount: dataset.rows.length };
  }
  const wb = buildAdminExportWorkbook(dataset, now);
  XLSX.writeFile(wb, `${base}.xlsx`);
  return { filename: `${base}.xlsx`, rowCount: dataset.rows.length };
}

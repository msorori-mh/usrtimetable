import * as XLSX from "xlsx";

/**
 * Legacy single-sheet XLSX helper kept for the print-center export path.
 * New admin list exports use ./dataset + ./download instead.
 */
export function exportRowsToXlsx(
  rows: Record<string, string | number>[],
  filename: string,
  sheetName = "البيانات",
): void {
  const ws = XLSX.utils.json_to_sheet(rows);
  (ws as unknown as { "!views"?: unknown[] })["!views"] = [{ RTL: true }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

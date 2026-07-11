import * as XLSX from "xlsx";

export function exportRowsToXlsx(
  filename: string,
  sheetName: string,
  rows: Record<string, unknown>[],
) {
  const ws = XLSX.utils.json_to_sheet(rows);
  // RTL layout for Arabic worksheets
  (ws as unknown as { "!views"?: unknown[] })["!views"] = [{ RTL: true }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || "Sheet1");
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const safe = filename.replace(/[^\w\-]+/g, "-");
  XLSX.writeFile(wb, `${safe}-${stamp}.xlsx`);
}

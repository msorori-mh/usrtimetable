// CSV + XLSX export helpers for reports
import * as XLSX from "xlsx";

export type Row = Record<string, unknown>;

export function downloadCSV(rows: Row[], headers: { key: string; label: string }[], filename: string) {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const head = headers.map((h) => esc(h.label)).join(",");
  const body = rows.map((r) => headers.map((h) => esc(r[h.key])).join(",")).join("\n");
  // BOM for Excel Arabic compatibility
  const blob = new Blob(["\uFEFF" + head + "\n" + body], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, filename + ".csv");
}

export function downloadXLSX(rows: Row[], headers: { key: string; label: string }[], filename: string, sheetName = "Report") {
  const data = [
    headers.map((h) => h.label),
    ...rows.map((r) => headers.map((h) => r[h.key] ?? "")),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename + ".xlsx");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export { DAY_NAMES_AR, compactAcademicLevelLabel, fmtTime, hoursBetween } from "@/lib/reports/formatters";

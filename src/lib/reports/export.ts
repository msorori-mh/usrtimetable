// CSV + XLSX export helpers for reports.
// M-18: SheetJS (~400KB) is loaded lazily inside downloadXLSX so report routes
// do not pull it into their initial bundle.
import { csvField } from "./spreadsheet-safe";

export type Row = Record<string, unknown>;

export function downloadCSV(
  rows: Row[],
  headers: { key: string; label: string }[],
  filename: string,
) {
  // M-2: formula-looking text cells are neutralized; numbers stay numbers.
  const esc = (v: unknown) => csvField(v);
  const head = headers.map((h) => esc(h.label)).join(",");
  const body = rows.map((r) => headers.map((h) => esc(r[h.key])).join(",")).join("\n");
  // BOM for Excel Arabic compatibility
  const blob = new Blob(["\uFEFF" + head + "\n" + body], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, filename + ".csv");
}

/**
 * Lazily loads SheetJS and writes the workbook. Resolves to false (after an
 * Arabic toast) when the module or the write fails, so fire-and-forget
 * `onClick={() => downloadXLSX(...)}` call sites never leak a rejection.
 */
export async function downloadXLSX(
  rows: Row[],
  headers: { key: string; label: string }[],
  filename: string,
  sheetName = "Report",
): Promise<boolean> {
  try {
    const XLSX = await import("xlsx");
    const data = [
      headers.map((h) => h.label),
      ...rows.map((r) => headers.map((h) => r[h.key] ?? "")),
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
    XLSX.writeFile(wb, filename + ".xlsx");
    return true;
  } catch (error) {
    const { toast } = await import("sonner");
    toast.error(
      error instanceof Error && error.message
        ? `تعذر إنشاء ملف Excel: ${error.message}`
        : "تعذر إنشاء ملف Excel.",
    );
    return false;
  }
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

export {
  DAY_NAMES_AR,
  compactAcademicLevelLabel,
  fmtTime,
  hoursBetween,
} from "@/lib/reports/formatters";

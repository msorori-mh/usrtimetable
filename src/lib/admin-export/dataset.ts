/**
 * ADMIN-EXPORT-01 — shared, framework-free export contract for admin lists.
 *
 * A dataset describes WHAT to export (ordered columns + the full set of rows
 * that match the current filters, never just the visible page) plus the filter
 * criteria that produced it. Rendering to CSV/XLSX lives in ./download.ts so
 * these builders stay pure and unit-testable.
 */

export type AdminExportCell = string | number;

export type AdminExportColumn<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number | boolean | null | undefined;
};

export type AdminExportFilter = { label: string; value: string };

export type AdminExportDataset<T> = {
  /** ASCII file name base, e.g. "rooms". */
  fileBase: string;
  /** Arabic report title shown in the criteria sheet. */
  title: string;
  /** Data sheet name (trimmed to 31 chars by the writer). */
  sheetName: string;
  columns: AdminExportColumn<T>[];
  /** ALL rows matching the current filters (not the current page). */
  rows: T[];
  filters: AdminExportFilter[];
  collegeName?: string | null;
  /** Optional extra note about the scope of the export. */
  scopeNote?: string | null;
};

export const ADMIN_EXPORT_ROW_LIMIT = 50000;
export const ADMIN_EXPORT_EMPTY_AR = "لا توجد سجلات مطابقة للتصدير.";
export const ADMIN_EXPORT_LIMIT_AR =
  "عدد السجلات المطابقة كبير جدًا للتصدير مرة واحدة. ضيّق الفلاتر ثم أعد المحاولة.";
export const ADMIN_EXPORT_NO_FILTERS_AR = "بدون فلاتر (كل السجلات المتاحة في نطاقك)";
export const ADMIN_EXPORT_CRITERIA_SHEET_AR = "معايير التصفية";
export const ADMIN_EXPORT_YES_AR = "نعم";
export const ADMIN_EXPORT_NO_AR = "لا";
export const ADMIN_EXPORT_DASH = "—";

/** Arabic-friendly cell value: booleans become نعم/لا, blanks become —. */
export function formatAdminExportValue(
  value: string | number | boolean | null | undefined,
): AdminExportCell {
  if (value === true) return ADMIN_EXPORT_YES_AR;
  if (value === false) return ADMIN_EXPORT_NO_AR;
  if (value === null || value === undefined) return ADMIN_EXPORT_DASH;
  if (typeof value === "number") return Number.isFinite(value) ? value : ADMIN_EXPORT_DASH;
  const text = String(value).trim();
  return text === "" ? ADMIN_EXPORT_DASH : text;
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** Stable, human readable file name: base-YYYYMMDD-HHmm (no ids, no spaces). */
export function adminExportFilename(fileBase: string, now: Date = new Date()): string {
  const safe =
    fileBase
      .trim()
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "export";
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(
    now.getHours(),
  )}${two(now.getMinutes())}`;
  return `${safe}-${stamp}`;
}

/** Throws an Arabic, actionable error when the dataset cannot be exported. */
export function assertAdminExportable<T>(dataset: AdminExportDataset<T>): void {
  if (dataset.columns.length === 0 || dataset.rows.length === 0) {
    throw new Error(ADMIN_EXPORT_EMPTY_AR);
  }
  if (dataset.rows.length > ADMIN_EXPORT_ROW_LIMIT) {
    throw new Error(ADMIN_EXPORT_LIMIT_AR);
  }
}

export type AdminExportTable = {
  headers: string[];
  body: AdminExportCell[][];
  rowCount: number;
};

/** Header labels + row values, in declared column order. */
export function buildAdminExportTable<T>(dataset: AdminExportDataset<T>): AdminExportTable {
  assertAdminExportable(dataset);
  return {
    headers: dataset.columns.map((c) => c.label),
    body: dataset.rows.map((row) => dataset.columns.map((c) => formatAdminExportValue(c.value(row)))),
    rowCount: dataset.rows.length,
  };
}

/** Two-column criteria sheet: report identity, scope, row count, filters. */
export function buildAdminExportMetadata<T>(
  dataset: AdminExportDataset<T>,
  now: Date = new Date(),
): AdminExportCell[][] {
  const rows: AdminExportCell[][] = [
    ["البيان", "القيمة"],
    ["التقرير", dataset.title],
    ["الكلية", formatAdminExportValue(dataset.collegeName)],
    ["عدد السجلات المصدَّرة", dataset.rows.length],
    ["تاريخ التصدير", now.toLocaleString("ar-EG")],
  ];
  if (dataset.scopeNote) rows.push(["نطاق التصدير", dataset.scopeNote]);
  rows.push([ADMIN_EXPORT_CRITERIA_SHEET_AR, ""]);
  if (dataset.filters.length === 0) {
    rows.push([ADMIN_EXPORT_NO_FILTERS_AR, ""]);
  } else {
    for (const f of dataset.filters) rows.push([f.label, formatAdminExportValue(f.value)]);
  }
  return rows;
}

function csvCell(value: AdminExportCell): string {
  const text = String(value).replace(/"/g, '""');
  return /[",\n\r;]/.test(text) ? `"${text}"` : text;
}

function csvLines(matrix: AdminExportCell[][]): string {
  return matrix.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** UTF-8 BOM + data rows, then the same criteria block appended below. */
export function buildAdminExportCsv<T>(
  dataset: AdminExportDataset<T>,
  now: Date = new Date(),
): string {
  const table = buildAdminExportTable(dataset);
  const data = csvLines([table.headers, ...table.body]);
  const meta = csvLines(buildAdminExportMetadata(dataset, now));
  return `\uFEFF${data}\r\n\r\n${meta}\r\n`;
}

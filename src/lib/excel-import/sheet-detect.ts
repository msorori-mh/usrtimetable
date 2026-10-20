/**
 * M-13: pure header-row / sheet detection for template imports.
 *
 * Previously only the first sheet was read and row 1 was assumed to be the
 * header; header names had to match byte-for-byte; and because SheetJS renames
 * duplicate headers to "X_1" the duplicate-header check could never fire.
 * Here the raw header row is read from a `header: 1` matrix, matched with the
 * project's Arabic-aware key, and duplicates are preserved for validation.
 */
import { headerMatchKey } from "./header-aliases";
import type { ColumnDef } from "./types";

/** Generated helper sheets — never data. */
export const TEMPLATE_REFERENCE_SHEETS: ReadonlySet<string> = new Set([
  "تعليمات",
  "Metadata",
  "أنواع_القاعات",
]);

const HEADER_SCAN_ROWS = 30;

export interface SheetMatrixInput {
  name: string;
  matrix: unknown[][];
}

function columnKeyIndex(columns: readonly ColumnDef[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const c of columns)
    for (const h of [c.header, ...(c.headerAliases ?? [])]) {
      const k = headerMatchKey(h);
      if (k && !out.has(k)) out.set(k, c.key);
    }
  return out;
}

/** Distinct template columns recognised in one row. */
export function headerRowScore(row: readonly unknown[], columns: readonly ColumnDef[]): number {
  const index = columnKeyIndex(columns);
  const hit = new Set<string>();
  for (const cell of row) {
    const key = index.get(headerMatchKey(cell));
    if (key) hit.add(key);
  }
  return hit.size;
}

/**
 * Chooses the sheet and header row carrying the template headers: the
 * template's own sheet name wins when it contains a header row; otherwise the
 * best-scoring row across sheets (ties: earliest sheet, earliest row). Falls
 * back to the first sheet / first row (historical behaviour) when nothing matches.
 */
export function pickTemplateSheet(
  sheets: readonly SheetMatrixInput[],
  columns: readonly ColumnDef[],
  preferredSheetName?: string,
): { name: string; matrix: unknown[][]; headerIndex: number } {
  if (!sheets.length) throw new Error("الملف لا يحتوي ورقة بيانات");
  const minScore = Math.min(2, Math.max(1, columns.length));
  let best: { name: string; matrix: unknown[][]; headerIndex: number; score: number } | null = null;
  const scored = sheets.map((sheet) => {
    let top = { headerIndex: 0, score: 0 };
    sheet.matrix.slice(0, HEADER_SCAN_ROWS).forEach((row, i) => {
      const score = headerRowScore(row ?? [], columns);
      if (score > top.score) top = { headerIndex: i, score };
    });
    return { ...sheet, ...top };
  });
  const preferred = preferredSheetName
    ? scored.find((s) => headerMatchKey(s.name) === headerMatchKey(preferredSheetName))
    : undefined;
  if (preferred && preferred.score >= minScore) return preferred;
  for (const s of scored) if (s.score >= minScore && (!best || s.score > best.score)) best = s;
  if (best) return best;
  return { name: scored[0].name, matrix: scored[0].matrix, headerIndex: 0 };
}

/**
 * Converts a `header: 1` matrix into header + row objects. Headers keep their
 * raw (trimmed) text — including duplicates — so the validator can report
 * duplicate and unknown headers. Blank columns and fully blank rows are skipped;
 * Excel row numbers are preserved.
 */
export function matrixToImportRows(
  matrix: readonly unknown[][],
  headerIndex: number,
  sheetName: string,
): {
  headers: string[];
  rows: Record<string, unknown>[];
  rowNumbers: number[];
  sheetName: string;
  headerRowNumber: number;
} {
  const headerRow = matrix[headerIndex] ?? [];
  const columns = headerRow.flatMap((h, index) => {
    const header = String(h ?? "").trim();
    return header ? [{ index, header }] : [];
  });
  const rows: Record<string, unknown>[] = [];
  const rowNumbers: number[] = [];
  for (let i = headerIndex + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    if (!columns.some((c) => String(row[c.index] ?? "").trim())) continue;
    const record: Record<string, unknown> = {};
    for (const c of columns) if (!(c.header in record)) record[c.header] = row[c.index] ?? "";
    rows.push(record);
    rowNumbers.push(i + 1);
  }
  return {
    headers: columns.map((c) => c.header),
    rows,
    rowNumbers,
    sheetName,
    headerRowNumber: headerIndex + 1,
  };
}

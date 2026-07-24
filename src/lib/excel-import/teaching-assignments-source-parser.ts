/**
 * Parser for academic source teaching-assignment workbooks (all sheets, carry-forward).
 */
import {
  SOURCE_COLUMN_KEYS,
  SOURCE_WORKBOOK_SKIP_SHEETS,
  isSourceWorkbookHeaderRow,
  isTotalOrSummaryRow,
  type SourceWorkbookColumn,
} from "./teaching-assignments-source-schema";

export interface ParsedSourceRow {
  sheetName: string;
  rowNumber: number;
  instructorName: string;
  courseName: string;
  levelNumber: number | null;
  programRaw: string;
  totalHours: number | null;
  notes: string | null;
  ignored: boolean;
  ignoreReason?: string;
}

export interface ParsedSourceSheet {
  sheetName: string;
  rows: ParsedSourceRow[];
  ignoredRowCount: number;
  dataRowCount: number;
}

export interface ParsedSourceWorkbook {
  sheets: ParsedSourceSheet[];
  totalRowsRead: number;
  totalDataRows: number;
  totalIgnoredRows: number;
}

export type SheetMatrix = ReadonlyArray<ReadonlyArray<string | number | null | undefined>>;

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function parseLevel(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseHours(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function mapHeaders(headerCells: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headerCells.forEach((h, i) => {
    const t = h.trim();
    if (t) map.set(t, i);
  });
  return map;
}

function getCol(row: string[], colMap: Map<string, number>, header: SourceWorkbookColumn): string {
  const idx = colMap.get(header);
  if (idx === undefined) return "";
  return cellStr(row[idx]);
}

export function parseSourceSheetMatrix(sheetName: string, matrix: SheetMatrix): ParsedSourceSheet {
  let headerColMap: Map<string, number> | null = null;
  let headerRowIndex = -1;
  for (let i = 0; i < matrix.length; i++) {
    const cells = matrix[i].map((c) => cellStr(c));
    if (isSourceWorkbookHeaderRow(cells)) {
      headerColMap = mapHeaders(cells);
      headerRowIndex = i;
      break;
    }
  }
  if (!headerColMap || headerRowIndex < 0) {
    return { sheetName, rows: [], ignoredRowCount: 0, dataRowCount: 0 };
  }

  let lastInstructor = "";
  let lastCourse = "";
  let lastLevel: number | null = null;
  const rows: ParsedSourceRow[] = [];
  let ignoredRowCount = 0;

  for (let i = headerRowIndex + 1; i < matrix.length; i++) {
    const rawRow = matrix[i].map((c) => cellStr(c));
    if (isSourceWorkbookHeaderRow(rawRow)) {
      ignoredRowCount++;
      continue;
    }
    const rowNumber = i + 1;
    const rawValues: Record<string, unknown> = {};
    for (const [h, idx] of headerColMap) {
      rawValues[h] = rawRow[idx] ?? "";
    }
    if (isTotalOrSummaryRow(rawValues)) {
      ignoredRowCount++;
      continue;
    }

    const instructorRaw = getCol(rawRow, headerColMap, SOURCE_COLUMN_KEYS.instructorName);
    let courseName = getCol(rawRow, headerColMap, SOURCE_COLUMN_KEYS.courseName);
    const levelRaw = getCol(rawRow, headerColMap, SOURCE_COLUMN_KEYS.level);
    const programRaw = getCol(rawRow, headerColMap, SOURCE_COLUMN_KEYS.program);
    const hoursRaw = getCol(rawRow, headerColMap, SOURCE_COLUMN_KEYS.totalHours);
    const notes = getCol(rawRow, headerColMap, SOURCE_COLUMN_KEYS.notes) || null;

    const emptyRow =
      !instructorRaw && !courseName && !levelRaw && !programRaw && !hoursRaw && !notes;
    if (emptyRow) {
      ignoredRowCount++;
      continue;
    }

    let instructorName = instructorRaw;
    if (!instructorName) instructorName = lastInstructor;
    else lastInstructor = instructorName;

    if (!courseName) courseName = lastCourse;
    else lastCourse = courseName;

    let levelNumber = parseLevel(levelRaw);
    if (levelNumber === null && lastLevel !== null) levelNumber = lastLevel;
    else if (levelNumber !== null) lastLevel = levelNumber;

    const totalHours = parseHours(hoursRaw);

    const ignored = !programRaw && !courseName && totalHours === null;
    rows.push({
      sheetName,
      rowNumber,
      instructorName,
      courseName,
      levelNumber,
      programRaw,
      totalHours,
      notes,
      ignored,
      ignoreReason: ignored ? "empty_meaningful_fields" : undefined,
    });
    if (ignored) ignoredRowCount++;
  }

  const dataRows = rows.filter((r) => !r.ignored);
  return {
    sheetName,
    rows,
    ignoredRowCount,
    dataRowCount: dataRows.length,
  };
}

export function parseSourceWorkbookFromSheets(
  sheets: ReadonlyArray<{ name: string; matrix: SheetMatrix }>,
): ParsedSourceWorkbook {
  const parsedSheets: ParsedSourceSheet[] = [];
  let totalRowsRead = 0;
  let totalDataRows = 0;
  let totalIgnoredRows = 0;

  for (const { name, matrix } of sheets) {
    if (SOURCE_WORKBOOK_SKIP_SHEETS.has(name)) continue;
    totalRowsRead += matrix.length;
    const sheet = parseSourceSheetMatrix(name, matrix);
    if (sheet.rows.length === 0 && sheet.dataRowCount === 0) continue;
    parsedSheets.push(sheet);
    totalDataRows += sheet.dataRowCount;
    totalIgnoredRows += sheet.ignoredRowCount;
  }

  return {
    sheets: parsedSheets,
    totalRowsRead,
    totalDataRows,
    totalIgnoredRows,
  };
}

export async function parseSourceWorkbookFile(file: File): Promise<ParsedSourceWorkbook> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetInputs: { name: string; matrix: SheetMatrix }[] = [];
  for (const name of wb.SheetNames) {
    if (SOURCE_WORKBOOK_SKIP_SHEETS.has(name)) continue;
    const ws = wb.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
    }) as SheetMatrix;
    sheetInputs.push({ name, matrix });
  }
  return parseSourceWorkbookFromSheets(sheetInputs);
}

export async function readWorkbookSheetHeaders(file: File): Promise<string[][]> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const out: string[][] = [];
  for (const name of wb.SheetNames) {
    if (SOURCE_WORKBOOK_SKIP_SHEETS.has(name)) continue;
    const ws = wb.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
    }) as string[][];
    for (const row of matrix.slice(0, 15)) {
      const cells = row.map((c) => String(c ?? "").trim()).filter(Boolean);
      if (cells.length >= 3) out.push(cells);
    }
  }
  return out;
}

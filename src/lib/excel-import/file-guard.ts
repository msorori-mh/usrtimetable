/**
 * L-4: single guard for every user-supplied workbook / JSON import file.
 *
 *  - size cap (10 MB) checked before the file is read into memory;
 *  - XLSX only for workbooks, verified by the ZIP magic bytes (PK\x03\x04),
 *    so a renamed .xls/.xlsm/HTML/CSV is rejected before SheetJS parses it;
 *  - macro-enabled content (vbaProject.bin) is rejected;
 *  - sheet ranges are capped so a forged `!ref` cannot make sheet_to_json
 *    iterate millions of empty cells.
 *
 * The XLSX module is injectable so the guard is unit-testable without SheetJS.
 */
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_SHEET_ROWS = 20_000;
export const MAX_IMPORT_SHEET_COLUMNS = 200;

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFileError";
  }
}

type FileLike = {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text?(): Promise<string>;
};

export function assertImportFileSize(
  file: { size: number },
  maxBytes = MAX_IMPORT_FILE_BYTES,
): void {
  if (!Number.isFinite(file.size) || file.size <= 0)
    throw new ImportFileError("الملف فارغ أو غير قابل للقراءة.");
  if (file.size > maxBytes)
    throw new ImportFileError(
      `حجم الملف يتجاوز الحد المسموح (${Math.round(maxBytes / (1024 * 1024))} ميجابايت).`,
    );
}

export function hasZipMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/** Reads an .xlsx upload after size, extension and ZIP-signature checks. */
export async function readGuardedXlsxBytes(
  file: FileLike,
  maxBytes = MAX_IMPORT_FILE_BYTES,
): Promise<Uint8Array> {
  if (!/\.xlsx$/i.test(file.name))
    throw new ImportFileError("استخدم ملف XLSX (احفظ الملف بصيغة Excel Workbook ‎.xlsx).");
  assertImportFileSize(file, maxBytes);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > maxBytes) assertImportFileSize({ size: bytes.byteLength }, maxBytes);
  if (!hasZipMagic(bytes)) throw new ImportFileError("محتوى الملف ليس XLSX صالحًا.");
  return bytes;
}

/** Reads a JSON upload after the size check; parse errors become an Arabic message. */
export async function readGuardedJson(
  file: FileLike,
  maxBytes = MAX_IMPORT_FILE_BYTES,
): Promise<unknown> {
  if (!/\.json$/i.test(file.name)) throw new ImportFileError("استخدم ملف JSON.");
  assertImportFileSize(file, maxBytes);
  const text = file.text ? await file.text() : new TextDecoder().decode(await file.arrayBuffer());
  try {
    return JSON.parse(text);
  } catch {
    throw new ImportFileError("ملف JSON غير صالح.");
  }
}

/** Minimal SheetJS surface the guard relies on. */
export interface XlsxLike {
  read(
    data: Uint8Array,
    opts: Record<string, unknown>,
  ): {
    SheetNames: string[];
    Sheets: Record<string, Record<string, unknown>>;
    vbaraw?: unknown;
  };
}

const CELL_ADDRESS = /^([A-Z]{1,3})(\d{1,7})$/;

function decodeCol(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function encodeCol(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Zero-based bounding box of the cells actually present in a (sparse) SheetJS sheet. */
export function populatedExtent(
  sheet: Record<string, unknown>,
): { minRow: number; maxRow: number; minCol: number; maxCol: number } | null {
  let minRow = Infinity;
  let maxRow = -1;
  let minCol = Infinity;
  let maxCol = -1;
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    const m = CELL_ADDRESS.exec(address);
    if (!m) continue;
    const c = decodeCol(m[1]);
    const r = Number(m[2]) - 1;
    if (r < minRow) minRow = r;
    if (r > maxRow) maxRow = r;
    if (c < minCol) minCol = c;
    if (c > maxCol) maxCol = c;
  }
  return maxRow < 0 ? null : { minRow, maxRow, minCol, maxCol };
}

export interface GuardedWorkbookOptions {
  /** Extra SheetJS read options (e.g. cellFormula). `type` and `bookVBA` are fixed. */
  read?: Record<string, unknown>;
  maxBytes?: number;
  maxRows?: number;
  maxColumns?: number;
  /** Sheets that are never parsed into rows and therefore not range-checked. */
  skipSheets?: ReadonlySet<string> | readonly string[];
  loadXlsx?: () => Promise<XlsxLike>;
}

/**
 * Reads an uploaded workbook through every L-4 check. Returns the SheetJS
 * workbook and module so callers keep their existing sheet_to_json logic.
 */
export async function readGuardedWorkbook<X extends XlsxLike = XlsxLike>(
  file: FileLike,
  options: GuardedWorkbookOptions = {},
): Promise<{ XLSX: X; workbook: ReturnType<X["read"]>; bytes: Uint8Array }> {
  const bytes = await readGuardedXlsxBytes(file, options.maxBytes);
  const XLSX = (await (
    options.loadXlsx ?? (() => import("xlsx") as unknown as Promise<XlsxLike>)
  )()) as X;
  let workbook: ReturnType<X["read"]>;
  try {
    workbook = XLSX.read(bytes, {
      ...(options.read ?? {}),
      type: "array",
      bookVBA: true,
    }) as ReturnType<X["read"]>;
  } catch {
    throw new ImportFileError("تعذر قراءة ملف XLSX؛ تأكد أنه غير تالف وغير محمي بكلمة مرور.");
  }
  if (workbook.vbaraw) throw new ImportFileError("الملفات التي تحتوي وحدات ماكرو غير مقبولة.");
  const skip = new Set(options.skipSheets ?? []);
  const maxRows = options.maxRows ?? MAX_IMPORT_SHEET_ROWS;
  const maxColumns = options.maxColumns ?? MAX_IMPORT_SHEET_COLUMNS;
  for (const name of workbook.SheetNames) {
    if (skip.has(name)) continue;
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const extent = populatedExtent(sheet);
    if (!extent) continue;
    if (extent.maxRow + 1 > maxRows || extent.maxCol + 1 > maxColumns)
      throw new ImportFileError(
        `الورقة «${name}» أكبر من الحد المسموح (${maxRows} صف و${maxColumns} عمود).`,
      );
    // A formatted-but-empty `!ref` (e.g. A1:XFD1048576) would make sheet_to_json walk
    // millions of empty cells. Keep the original start (row numbers stay exact) and
    // clamp only the end to the last populated cell.
    const start = typeof sheet["!ref"] === "string" ? String(sheet["!ref"]).split(":")[0] : "A1";
    const startMatch = CELL_ADDRESS.exec(start);
    const startCol = startMatch ? decodeCol(startMatch[1]) : 0;
    const startRow = startMatch ? Number(startMatch[2]) - 1 : 0;
    sheet["!ref"] =
      `${encodeCol(Math.min(startCol, extent.minCol))}${Math.min(startRow, extent.minRow) + 1}:` +
      `${encodeCol(extent.maxCol)}${extent.maxRow + 1}`;
  }
  return { XLSX, workbook, bytes };
}

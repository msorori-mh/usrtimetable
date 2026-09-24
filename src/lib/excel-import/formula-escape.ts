/**
 * Escape spreadsheet formula injection when exporting user-controlled cell values.
 * Prefixes values that Excel/LibreOffice may treat as formulas.
 */
const FORMULA_PREFIX_RE = /^[=+\-@]/;

export function escapeSpreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (FORMULA_PREFIX_RE.test(s)) return `'${s}`;
  return s;
}

export function escapeSpreadsheetRow(values: unknown[]): string[] {
  return values.map((v) => escapeSpreadsheetCell(v));
}

export function looksLikeFormulaInjection(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return FORMULA_PREFIX_RE.test(String(value));
}

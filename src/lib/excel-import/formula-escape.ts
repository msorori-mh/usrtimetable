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

/**
 * A3.5 / gap G1: inbound formula-injection sanitation for uploaded import
 * files (previously only the export side was escaped).
 *
 * A leading '=' or '@' is always treated as a formula. A leading '+'/'-' is
 * treated as a formula only when NOT followed by a digit or '.', so phone
 * numbers ("+9665…") and negative numbers pass through untouched. Matching
 * values are neutralized with the same `'` prefix used on the export side.
 */
const INBOUND_FORMULA_RE = /^[=@]|^[+\-](?![\d.])/;

export function looksLikeInboundFormula(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  return INBOUND_FORMULA_RE.test(value);
}

export function sanitizeImportCellValue(value: unknown): unknown {
  if (!looksLikeInboundFormula(value)) return value;
  return `'${value as string}`;
}

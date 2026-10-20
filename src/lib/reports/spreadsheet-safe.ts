/**
 * M-2: CSV formula-injection guard shared by every CSV writer.
 *
 * A text cell that Excel / LibreOffice / Google Sheets would evaluate as a
 * formula (leading = + - @, optionally after whitespace/BOM, or a leading tab /
 * CR / LF) is prefixed with an apostrophe. Only *string* values are touched:
 * real numbers (including negatives) stay numeric.
 */
const FORMULA_TRIGGER = /^[\s\uFEFF]*[=+\-@]|^[\t\r\n]/u;

export function neutralizeFormulaText<T>(value: T): T | string {
  return typeof value === "string" && FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

/** One CSV field: neutralized, then quoted when it contains a delimiter/quote/newline. */
export function csvField(value: unknown, delimiters: RegExp = /[",\n\r]/): string {
  if (value === null || value === undefined) return "";
  const text = String(neutralizeFormulaText(value)).replace(/"/g, '""');
  return delimiters.test(text) ? `"${text}"` : text;
}

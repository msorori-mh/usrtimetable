/**
 * Presentation-only free-text filter for report rows.
 *
 * It never changes how a value is computed, nor the row keys, nor the export
 * headers — it only decides which already-computed rows are visible.
 */
const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u06D6-\u06ED]/g;

export function normalizeSearchText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

export function rowMatchesSearch(row: Record<string, unknown>, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;
  return Object.values(row).some((value) => normalizeSearchText(value).includes(q));
}

export function filterRowsBySearch<T extends Record<string, unknown>>(
  rows: T[],
  query: string,
): T[] {
  const q = normalizeSearchText(query);
  if (!q) return rows;
  return rows.filter((row) => rowMatchesSearch(row, q));
}

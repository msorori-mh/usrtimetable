import type { ColumnDef } from "./types";
import { normalizedMatchKey } from "./arabic-normalize";

/**
 * M-13: header comparison key — Arabic letter variants, diacritics/tanween
 * ("أسبوعياً" = "أسبوعيا"), invisible marks, case, and "_" vs spaces are
 * ignored. Exact otherwise (never fuzzy).
 */
export function headerMatchKey(header: unknown): string {
  return normalizedMatchKey(String(header ?? ""))
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalImportHeader(columns: readonly ColumnDef[], header: string): string {
  const trimmed = header.trim();
  const key = headerMatchKey(trimmed);
  const column =
    columns.find(
      (candidate) =>
        candidate.header === trimmed || candidate.headerAliases?.some((alias) => alias === trimmed),
    ) ??
    columns.find(
      (candidate) =>
        headerMatchKey(candidate.header) === key ||
        candidate.headerAliases?.some((alias) => headerMatchKey(alias) === key),
    );
  return column?.header ?? trimmed;
}

export function canonicalizeImportShape(
  columns: readonly ColumnDef[],
  headers: string[],
  rows: Record<string, unknown>[],
): { headers: string[]; rows: Record<string, unknown>[] } {
  return {
    headers: headers.map((header) => canonicalImportHeader(columns, header)),
    rows: rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([header, value]) => [
          canonicalImportHeader(columns, header),
          value,
        ]),
      ),
    ),
  };
}

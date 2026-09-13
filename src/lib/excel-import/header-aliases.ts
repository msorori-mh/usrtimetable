import type { ColumnDef } from "./types";

export function canonicalImportHeader(columns: readonly ColumnDef[], header: string): string {
  const trimmed = header.trim();
  const column = columns.find(
    (candidate) =>
      candidate.header === trimmed || candidate.headerAliases?.some((alias) => alias === trimmed),
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

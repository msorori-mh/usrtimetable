export interface DepartmentLookupRow {
  id: string;
  code: string;
  name: string;
}

export interface ProgramLookupRow {
  id: string;
  code: string;
  name: string;
  department_id: string;
}

export function normalizeStructureName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ|[\u064B-\u065F]|\u0670/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function matchDepartment(
  value: unknown,
  rows: DepartmentLookupRow[],
): { kind: "matched"; row: DepartmentLookupRow } | { kind: "missing" | "ambiguous" } {
  const raw = String(value ?? "").trim();
  if (!raw) return { kind: "missing" };
  const codeMatches = rows.filter((row) => row.code.trim().toLowerCase() === raw.toLowerCase());
  if (codeMatches.length === 1) return { kind: "matched", row: codeMatches[0] };
  if (codeMatches.length > 1) return { kind: "ambiguous" };
  const key = normalizeStructureName(raw);
  const nameMatches = rows.filter((row) => normalizeStructureName(row.name) === key);
  if (nameMatches.length === 1) return { kind: "matched", row: nameMatches[0] };
  return { kind: nameMatches.length > 1 ? "ambiguous" : "missing" };
}

export function matchExistingStructureRow<T extends DepartmentLookupRow | ProgramLookupRow>(
  code: unknown,
  name: unknown,
  rows: T[],
): T | null {
  const normalizedCode = String(code ?? "").trim().toLowerCase();
  if (normalizedCode) {
    const byCode = rows.filter((row) => row.code.trim().toLowerCase() === normalizedCode);
    if (byCode.length === 1) return byCode[0];
  }
  const normalizedName = normalizeStructureName(name);
  if (!normalizedName) return null;
  const byName = rows.filter((row) => normalizeStructureName(row.name) === normalizedName);
  return byName.length === 1 ? byName[0] : null;
}
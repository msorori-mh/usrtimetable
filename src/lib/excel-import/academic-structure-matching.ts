/**
 * Pure matching helpers for the founding academic structure imports
 * (departments / academic_programs). No DB access — callers pass rows that are
 * already scoped to the active college, so a row can never resolve to another
 * college's department or program.
 */

export interface DepartmentRow {
  id: string;
  code: string | null;
  name: string;
}

export interface ProgramRow {
  id: string;
  code: string | null;
  name: string;
  department_id: string | null;
}

export type StructureMatch =
  | { status: "matched"; id: string }
  | { status: "none" }
  | { status: "ambiguous" };

/** Normalized Arabic/Latin name used for fallback matching (never for storage). */
export function normalizeStructureName(value: unknown): string {
  return String(value ?? "")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[\s\u200f\u200e_-]+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeCode(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function matchRows<T extends { id: string; code: string | null; name: string }>(
  rows: T[],
  input: { code?: unknown; name?: unknown },
): StructureMatch {
  const code = normalizeCode(input.code);
  if (code) {
    const byCode = rows.filter((r) => normalizeCode(r.code) === code);
    if (byCode.length === 1) return { status: "matched", id: byCode[0].id };
    if (byCode.length > 1) return { status: "ambiguous" };
  }
  const name = normalizeStructureName(input.name);
  if (!name) return { status: "none" };
  const byName = rows.filter((r) => normalizeStructureName(r.name) === name);
  if (byName.length === 1) return { status: "matched", id: byName[0].id };
  if (byName.length > 1) return { status: "ambiguous" };
  return { status: "none" };
}

/** Resolve a department inside the active college: code first, then normalized name. */
export function matchDepartment(
  rows: DepartmentRow[],
  input: { code?: unknown; name?: unknown },
): StructureMatch {
  return matchRows(rows, input);
}

/**
 * Resolve an existing program inside the active college: code first, then the
 * normalized name limited to the resolved department (so two departments may
 * hold programs with the same display name).
 */
export function matchProgram(
  rows: ProgramRow[],
  input: { code?: unknown; name?: unknown; departmentId?: string | null },
): StructureMatch {
  const code = normalizeCode(input.code);
  if (code) {
    const byCode = rows.filter((r) => normalizeCode(r.code) === code);
    if (byCode.length === 1) return { status: "matched", id: byCode[0].id };
    if (byCode.length > 1) return { status: "ambiguous" };
  }
  const scoped = input.departmentId
    ? rows.filter((r) => r.department_id === input.departmentId)
    : rows;
  return matchRows(scoped, { name: input.name });
}

/** The program row behind a resolved match, used to block silent re-parenting. */
export function programById(rows: ProgramRow[], id: string): ProgramRow | undefined {
  return rows.find((r) => r.id === id);
}

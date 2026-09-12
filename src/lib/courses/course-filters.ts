/**
 * Pure client-side filtering helpers for the courses catalog page.
 * Only fields that exist on the `courses` row are used: code, name, credit_hours,
 * theory_hours, practical_hours. No schema assumptions are added.
 */

export interface CourseFilterRow {
  id: string;
  code: string;
  name: string;
  /** Optional English name — only used when the row actually carries one. */
  name_en?: string | null;
  department_id: string;
  credit_hours: number;
  theory_hours: number;
  practical_hours: number;
}

export const ALL_FILTER = "__all__";

/** Course composition derived from the stored theory/practical hours. */
export type CourseComposition = "theory_only" | "theory_practical" | "practical_only";

export const COURSE_COMPOSITION_LABELS_AR: Record<CourseComposition, string> = {
  theory_only: "نظري فقط",
  theory_practical: "نظري + عملي",
  practical_only: "عملي فقط",
};

export function courseComposition(row: {
  theory_hours: number;
  practical_hours: number;
}): CourseComposition {
  const theory = Number(row.theory_hours) || 0;
  const practical = Number(row.practical_hours) || 0;
  if (practical > 0 && theory > 0) return "theory_practical";
  if (practical > 0) return "practical_only";
  return "theory_only";
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function courseMatchesSearch(row: CourseFilterRow, rawSearch: string): boolean {
  const term = normalize(rawSearch);
  if (!term) return true;
  return [row.code, row.name, row.name_en].some((field) => normalize(field).includes(term));
}

export interface CourseFilterState {
  search: string;
  deptFilter: string;
  progFilter: string;
  planFilter: string;
  composition: string;
  creditHours: string;
}

export const EMPTY_COURSE_FILTERS: CourseFilterState = {
  search: "",
  deptFilter: ALL_FILTER,
  progFilter: ALL_FILTER,
  planFilter: ALL_FILTER,
  composition: ALL_FILTER,
  creditHours: ALL_FILTER,
};

export function hasActiveCourseFilters(state: CourseFilterState): boolean {
  return (
    state.search.trim().length > 0 ||
    state.deptFilter !== ALL_FILTER ||
    state.progFilter !== ALL_FILTER ||
    state.planFilter !== ALL_FILTER ||
    state.composition !== ALL_FILTER ||
    state.creditHours !== ALL_FILTER
  );
}

/** Programs available for the selected department (program filter follows department). */
export function programsForDepartment<T extends { department_id: string | null }>(
  programs: T[],
  deptFilter: string,
): T[] {
  if (deptFilter === ALL_FILTER) return programs;
  return programs.filter((p) => p.department_id === deptFilter);
}

/** Distinct credit-hour values present in the data, ascending. */
export function creditHourOptions(rows: Pick<CourseFilterRow, "credit_hours">[]): number[] {
  return [...new Set(rows.map((r) => Number(r.credit_hours) || 0))].sort((a, b) => a - b);
}

/** All filters combine with AND. */
export function filterCourses<T extends CourseFilterRow>(
  rows: T[],
  state: CourseFilterState,
  links: { programCourseIds?: Set<string> | null; planCourseIds?: Set<string> | null } = {},
): T[] {
  return rows.filter((row) => {
    if (!courseMatchesSearch(row, state.search)) return false;
    if (state.deptFilter !== ALL_FILTER && row.department_id !== state.deptFilter) return false;
    if (links.programCourseIds && !links.programCourseIds.has(row.id)) return false;
    if (links.planCourseIds && !links.planCourseIds.has(row.id)) return false;
    if (state.composition !== ALL_FILTER && courseComposition(row) !== state.composition)
      return false;
    if (
      state.creditHours !== ALL_FILTER &&
      (Number(row.credit_hours) || 0) !== Number(state.creditHours)
    )
      return false;
    return true;
  });
}

export function courseResultsLabelAr(shown: number, total: number): string {
  return `عرض ${shown} من ${total} مقرر`;
}

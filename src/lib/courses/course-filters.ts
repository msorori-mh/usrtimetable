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

/**
 * Composition derived from the plan components of a course inside one study plan.
 * `theory`/`tutorial`/`project` count as theory-side delivery; `practical` as practical.
 */
export function compositionFromComponents(
  componentTypes: readonly string[],
): CourseComposition | null {
  const types = componentTypes.map((t) => String(t ?? "").trim().toLowerCase());
  const practical = types.includes("practical");
  const theory = types.some((t) => t === "theory" || t === "tutorial" || t === "project");
  if (!practical && !theory) return null;
  if (practical && theory) return "theory_practical";
  if (practical) return "practical_only";
  return "theory_only";
}

export interface CourseFilterLinks {
  /** Course ids allowed by the selected program (null = no program selected). */
  programCourseIds?: Set<string> | null;
  /** Course ids allowed by the selected study plan (null = no plan selected). */
  planCourseIds?: Set<string> | null;
  /**
   * Composition per course id inside the selected plan. Used only when a plan is
   * selected; missing entries fall back to the course's own stored hours.
   */
  compositionByCourseId?: Map<string, CourseComposition> | null;
}

/** All filters combine with AND. */
export function filterCourses<T extends CourseFilterRow>(
  rows: T[],
  state: CourseFilterState,
  links: CourseFilterLinks = {},
): T[] {
  return rows.filter((row) => {
    if (!courseMatchesSearch(row, state.search)) return false;
    if (state.deptFilter !== ALL_FILTER && row.department_id !== state.deptFilter) return false;
    if (links.programCourseIds && !links.programCourseIds.has(row.id)) return false;
    if (links.planCourseIds && !links.planCourseIds.has(row.id)) return false;
    if (state.composition !== ALL_FILTER) {
      const composition = links.compositionByCourseId?.get(row.id) ?? courseComposition(row);
      if (composition !== state.composition) return false;
    }
    if (
      state.creditHours !== ALL_FILTER &&
      (Number(row.credit_hours) || 0) !== Number(state.creditHours)
    )
      return false;
    return true;
  });
}

/**
 * Course ids belonging to a program. Production data may have no `course_programs`
 * rows at all, so plan membership (plan_courses → study_plans.program_id) is the
 * authoritative fallback and both sources are unioned.
 */
export function courseIdsForProgram(input: {
  programId: string;
  coursePrograms: readonly { course_id: string; program_id: string }[];
  planCourses: readonly { course_id: string; study_plan_id: string }[];
  plans: readonly { id: string; program_id: string }[];
}): Set<string> {
  const planIds = new Set(
    input.plans.filter((p) => p.program_id === input.programId).map((p) => p.id),
  );
  const out = new Set<string>();
  for (const r of input.coursePrograms) {
    if (r.program_id === input.programId) out.add(r.course_id);
  }
  for (const r of input.planCourses) {
    if (planIds.has(r.study_plan_id)) out.add(r.course_id);
  }
  return out;
}


export function courseResultsLabelAr(shown: number, total: number): string {
  return `عرض ${shown} من ${total} مقرر`;
}

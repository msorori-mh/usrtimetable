/** Database course classifications, shared by both study-plan import templates. */
export const COURSE_NATURE_VALUES = ["department", "college", "university"];

/** Preserve invalid input for validation; faculty is the legacy template spelling. */
export function normalizeCourseNature(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim().toLowerCase();
  if (!value) return null;
  return value === "faculty" ? "college" : value;
}

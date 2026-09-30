import { normalizeSearchText } from "@/lib/reports/search";

export type CourseSearchRow = {
  course_code: string | null;
  course_name: string | null;
};

/** Presentation-only search limited to the course name/code. */
export function filterTeachingAssignmentRowsByCourse<T extends CourseSearchRow>(
  rows: readonly T[],
  query: string,
): T[] {
  const needle = normalizeSearchText(query);
  if (!needle) return [...rows];
  return rows.filter((row) =>
    normalizeSearchText(`${row.course_code ?? ""} ${row.course_name ?? ""}`).includes(needle),
  );
}

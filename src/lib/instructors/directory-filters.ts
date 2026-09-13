/**
 * INSTRUCTOR-DIRECTORY-SEARCH-SORT-01
 *
 * Pure search / filter / sort for the «المحاضرون» page. Presentation only: it
 * never mutates rows and only decides which rows are visible and in what order.
 * Every field used here exists on `instructors` (or is derived from the already
 * loaded department list) — no invented columns.
 */
import { normalizeSearchText } from "@/lib/reports/search";

export interface DirectoryInstructor {
  id: string;
  full_name: string;
  full_name_ar?: string | null;
  full_name_en?: string | null;
  employee_number?: string | null;
  email?: string | null;
  department_id?: string | null;
  academic_rank?: string | null;
  instructor_type_id?: string | null;
  is_active?: boolean | null;
  max_weekly_hours?: number | null;
}

export type InstructorSortKey = "name" | "employee_number" | "department" | "quota";
export type SortDirection = "asc" | "desc";

export interface DirectoryFilters {
  search: string;
  departmentId: string; // "all" | id | "none"
  status: string; // "all" | "active" | "inactive"
  rank: string; // "all" | rank value
  typeId: string; // "all" | id | "none"
  sortKey: InstructorSortKey;
  sortDirection: SortDirection;
}

export const DEFAULT_DIRECTORY_FILTERS: DirectoryFilters = {
  search: "",
  departmentId: "all",
  status: "all",
  rank: "all",
  typeId: "all",
  sortKey: "name",
  sortDirection: "asc",
};

export const INSTRUCTOR_SORT_LABEL_AR: Record<InstructorSortKey, string> = {
  name: "الاسم",
  employee_number: "رقم الموظف",
  department: "القسم",
  quota: "النصاب المعتمد",
};

export function hasActiveDirectoryFilters(f: DirectoryFilters): boolean {
  return (
    f.search.trim() !== "" ||
    f.departmentId !== "all" ||
    f.status !== "all" ||
    f.rank !== "all" ||
    f.typeId !== "all"
  );
}

/** Searchable text of one member: names (ar/en), employee number, email, department. */
export function instructorSearchHaystack(
  row: DirectoryInstructor,
  departmentName?: string | null,
): string {
  return [
    row.full_name,
    row.full_name_ar,
    row.full_name_en,
    row.employee_number,
    row.email,
    departmentName,
  ]
    .map((v) => normalizeSearchText(v))
    .filter(Boolean)
    .join(" ");
}

export function matchesInstructorSearch(
  row: DirectoryInstructor,
  query: string,
  departmentName?: string | null,
): boolean {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  if (terms.length === 0) return true;
  const hay = instructorSearchHaystack(row, departmentName);
  return terms.every((t) => hay.includes(t));
}

const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });

export function filterAndSortInstructors<T extends DirectoryInstructor>(
  rows: T[],
  filters: DirectoryFilters,
  departmentName: (id: string | null | undefined) => string,
): T[] {
  const visible = rows.filter((row) => {
    if (filters.departmentId === "none" && row.department_id) return false;
    if (filters.departmentId !== "all" && filters.departmentId !== "none") {
      if (row.department_id !== filters.departmentId) return false;
    }
    if (filters.status === "active" && row.is_active === false) return false;
    if (filters.status === "inactive" && row.is_active !== false) return false;
    if (filters.rank !== "all" && (row.academic_rank ?? "") !== filters.rank) return false;
    if (filters.typeId === "none" && row.instructor_type_id) return false;
    if (filters.typeId !== "all" && filters.typeId !== "none") {
      if (row.instructor_type_id !== filters.typeId) return false;
    }
    return matchesInstructorSearch(row, filters.search, departmentName(row.department_id));
  });

  const dir = filters.sortDirection === "desc" ? -1 : 1;
  // Stable: index breaks every tie, so equal keys keep their incoming order.
  return visible
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      // Rows with no value for the sort key stay last in both directions.
      const am = isMissingSortValue(a.row, filters.sortKey);
      const bm = isMissingSortValue(b.row, filters.sortKey);
      if (am !== bm) return am ? 1 : -1;
      const cmp = compare(a.row, b.row, filters.sortKey, departmentName);
      return cmp !== 0 ? cmp * dir : a.index - b.index;
    })
    .map((entry) => entry.row);
}

function isMissingSortValue(row: DirectoryInstructor, key: InstructorSortKey): boolean {
  if (key === "quota") return typeof row.max_weekly_hours !== "number";
  if (key === "employee_number") return !(row.employee_number ?? "").trim();
  return false;
}


function compare<T extends DirectoryInstructor>(
  a: T,
  b: T,
  key: InstructorSortKey,
  departmentName: (id: string | null | undefined) => string,
): number {
  if (key === "quota") {
    const av = typeof a.max_weekly_hours === "number" ? a.max_weekly_hours : null;
    const bv = typeof b.max_weekly_hours === "number" ? b.max_weekly_hours : null;
    if (av === bv) return 0;
    // Members without an approved quota sort last in both directions.
    if (av === null) return 1;
    if (bv === null) return -1;
    return av - bv;
  }
  if (key === "employee_number") {
    const av = (a.employee_number ?? "").trim();
    const bv = (b.employee_number ?? "").trim();
    if (av === bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    return collator.compare(av, bv);
  }
  if (key === "department") {
    return collator.compare(departmentName(a.department_id), departmentName(b.department_id));
  }
  return collator.compare(a.full_name_ar || a.full_name, b.full_name_ar || b.full_name);
}

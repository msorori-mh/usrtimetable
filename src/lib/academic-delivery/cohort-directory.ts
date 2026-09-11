import { ACADEMIC_STUDY_SYSTEM_LABELS } from "../study-systems";

export const COHORT_SYSTEM_LABELS: Record<string, string> = {
  ...ACADEMIC_STUDY_SYSTEM_LABELS,
};
export const COHORT_COUNT_LABELS: Record<string, string> = {
  estimated: "تقديري",
  confirmed: "مؤكد",
  locked: "مقفل",
};
export type CohortListRow = {
  id: string;
  code: string | null;
  program_id: string;
  level_id: string;
  term_id: string;
  study_system: string;
  entry_year: number;
  expected_students: number;
  count_status: string;
  active: boolean;
  programName: string;
  levelName: string;
  levelNumber: number | null;
  termName: string;
};
export type CohortFilters = {
  search: string;
  program: string;
  level: string;
  system: string;
  term: string;
  activity: string;
};
export const EMPTY_COHORT_FILTERS: CohortFilters = {
  search: "",
  program: "all",
  level: "all",
  system: "all",
  term: "all",
  activity: "all",
};
export const COHORT_PAGE_SIZE = 8;
const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });
function searchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/[\u064B-\u065F\u0670ـ]/g, "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
}
export function filterCohortDirectory(
  rows: CohortListRow[],
  filters: CohortFilters,
): CohortListRow[] {
  const words = searchText(filters.search).split(/\s+/).filter(Boolean);
  return rows
    .filter((row) => {
      if (filters.program !== "all" && row.program_id !== filters.program) return false;
      if (filters.level !== "all" && String(row.levelNumber) !== filters.level) return false;
      if (filters.system !== "all" && row.study_system !== filters.system) return false;
      if (filters.term !== "all" && row.term_id !== filters.term) return false;
      if (filters.activity !== "all" && row.active !== (filters.activity === "active"))
        return false;
      const text = searchText(
        [
          row.code,
          row.programName,
          row.levelName,
          row.termName,
          row.entry_year,
          COHORT_SYSTEM_LABELS[row.study_system] ?? row.study_system,
        ].join(" "),
      );
      return words.every((word) => text.includes(word));
    })
    .sort(
      (a, b) =>
        collator.compare(a.programName, b.programName) ||
        (a.levelNumber ?? Infinity) - (b.levelNumber ?? Infinity) ||
        collator.compare(
          a.study_system === "regular" ? "0" : a.study_system,
          b.study_system === "regular" ? "0" : b.study_system,
        ) ||
        b.entry_year - a.entry_year ||
        collator.compare(a.termName, b.termName) ||
        a.id.localeCompare(b.id),
    );
}
/** Level numbers are offered only for cohorts in the selected program. */
export function cohortLevelOptions(rows: CohortListRow[], program: string): number[] {
  return [
    ...new Set(
      rows
        .filter((r) => program === "all" || r.program_id === program)
        .map((r) => r.levelNumber)
        .filter((n): n is number => n != null),
    ),
  ].sort((a, b) => a - b);
}
export function cohortDirectoryPage(rows: CohortListRow[], requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / COHORT_PAGE_SIZE));
  const page = Math.max(
    1,
    Math.min(Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1, totalPages),
  );
  return {
    page,
    totalPages,
    rows: rows.slice((page - 1) * COHORT_PAGE_SIZE, page * COHORT_PAGE_SIZE),
  };
}
/** A hidden/stale selection cannot drive the details panel or its actions. */
export function visibleCohortSelection(
  rows: CohortListRow[],
  selectedId: string | null,
): string | null {
  return rows.find((r) => r.id === selectedId)?.id ?? rows[0]?.id ?? null;
}

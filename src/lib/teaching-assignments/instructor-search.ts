// TA-SEARCH-01 — pure search helper for the instructor combobox in the
// "إسناد مجموعة محاضرات ومعامل" dialog.
//
// Matches by displayed Arabic/English name or employee number,
// case-insensitive, with leading/trailing whitespace ignored.
// Selection value stays instructor_id — free text is never a valid value.

export interface InstructorSearchCandidate {
  instructor_id: string;
  full_name?: string | null;
  full_name_en?: string | null;
  employee_number?: string | null;
}

export function normalizeInstructorSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase();
}

export function instructorSearchHaystack(candidate: InstructorSearchCandidate): string {
  return [candidate.full_name, candidate.full_name_en, candidate.employee_number]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .join(" ")
    .toLocaleLowerCase();
}

export function instructorMatchesQuery(
  candidate: InstructorSearchCandidate,
  query: string,
): boolean {
  const q = normalizeInstructorSearchQuery(query);
  if (q === "") return true;
  return instructorSearchHaystack(candidate).includes(q);
}

export function filterInstructorCandidates<T extends InstructorSearchCandidate>(
  candidates: readonly T[],
  query: string,
): T[] {
  return candidates.filter((c) => instructorMatchesQuery(c, query));
}

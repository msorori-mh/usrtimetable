// CROSS-COLLEGE-INSTRUCTOR-01 — pure helpers for the cross-college instructor
// picker in the teaching assignment dialog.
//
// Identity rule: an instructor is registered ONCE in their home college. The
// picker only references that canonical instructor_id; it never creates,
// copies, or edits an instructor record. Only these public fields may reach the
// picker — private profile fields (email, phone, salary/HR data, notes,
// affiliation departments) are never requested nor rendered.

export interface AssignmentCandidate {
  instructor_id: string;
  full_name: string | null;
  academic_rank: string | null;
  home_college_id: string;
  college_name: string | null;
  is_home_college: boolean;
  /** Only present for instructors of the delivery group's own college. */
  employee_number: string | null;
  already_assigned: boolean;
}

export interface CandidateCollegeOption {
  college_id: string;
  college_name: string;
  is_home_college: boolean;
}

/** Fields the picker is allowed to consume. Anything else is dropped. */
export const ALLOWED_CANDIDATE_FIELDS = [
  "instructor_id",
  "full_name",
  "academic_rank",
  "home_college_id",
  "college_name",
  "is_home_college",
  "employee_number",
  "already_assigned",
] as const;

function str(value: unknown): string | null {
  return value == null || value === "" ? null : String(value);
}

export function parseAssignmentCandidates(payload: unknown): AssignmentCandidate[] {
  const root = (payload ?? {}) as { candidates?: unknown };
  const rows = Array.isArray(root.candidates) ? root.candidates : [];
  return rows
    .map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const id = str(r["instructor_id"]);
      if (!id) return null;
      return {
        instructor_id: id,
        full_name: str(r["full_name"]),
        academic_rank: str(r["academic_rank"]),
        home_college_id: str(r["home_college_id"]) ?? "",
        college_name: str(r["college_name"]),
        is_home_college: r["is_home_college"] === true,
        employee_number: str(r["employee_number"]),
        already_assigned: r["already_assigned"] === true,
      } satisfies AssignmentCandidate;
    })
    .filter((c): c is AssignmentCandidate => c !== null);
}

/** Source-college options derived from the candidates actually available. */
export function candidateCollegeOptions(
  candidates: readonly AssignmentCandidate[],
): CandidateCollegeOption[] {
  const byId = new Map<string, CandidateCollegeOption>();
  for (const c of candidates) {
    if (!c.home_college_id || byId.has(c.home_college_id)) continue;
    byId.set(c.home_college_id, {
      college_id: c.home_college_id,
      college_name: c.college_name ?? "كلية غير مسماة",
      is_home_college: c.is_home_college,
    });
  }
  return [...byId.values()].sort((a, b) => {
    if (a.is_home_college !== b.is_home_college) return a.is_home_college ? -1 : 1;
    return a.college_name.localeCompare(b.college_name, "ar");
  });
}

/** Assignable candidates of one source college (already-assigned ones removed). */
export function filterCandidatesByCollege(
  candidates: readonly AssignmentCandidate[],
  collegeId: string,
): AssignmentCandidate[] {
  return candidates.filter(
    (c) => !c.already_assigned && (!collegeId || c.home_college_id === collegeId),
  );
}

export function defaultSourceCollegeId(
  candidates: readonly AssignmentCandidate[],
  deliveryGroupCollegeId: string | null,
): string {
  if (deliveryGroupCollegeId && candidates.some((c) => c.home_college_id === deliveryGroupCollegeId))
    return deliveryGroupCollegeId;
  return candidateCollegeOptions(candidates)[0]?.college_id ?? "";
}

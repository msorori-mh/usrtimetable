import type { FacultyRosterRecord } from "./faculty-workflow";
import { normalizeSearchText } from "../reports/search.ts";

export type UniversityRosterHit = {
  row: FacultyRosterRecord;
  collegeId: string;
  collegeName: string;
  scope: "home" | "pending";
};

export function canSearchUniversityRoster(isSuperAdmin: boolean, search: string): boolean {
  return isSuperAdmin && normalizeSearchText(search).length >= 2;
}

export function collegesInUniversity<T extends { university_id: string; name: string }>(
  colleges: readonly T[],
  universityId: string | null | undefined,
): T[] {
  if (!universityId) return [];
  return colleges.filter(
    (college) => college.university_id === universityId && !/TEST_ONLY/i.test(college.name),
  );
}

/** A resolved identity appears once, even if it also has old records in other colleges. */
export function distinctUniversityRosterHits(hits: UniversityRosterHit[]): UniversityRosterHit[] {
  const seen = new Set<string>();
  const result: UniversityRosterHit[] = [];
  for (const hit of [
    ...hits.filter((item) => item.scope === "home"),
    ...hits.filter((item) => item.scope === "pending"),
  ]) {
    const identity = hit.row.identity_id || hit.row.id;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(hit);
  }
  return result;
}

import type { FacultyRequest } from "./faculty-workflow";

export type RequestStatusFilter = "all" | FacultyRequest["status"];
export type RequestDirection = "all" | "incoming" | "outgoing";

function searchable(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .toLocaleLowerCase("ar")
    .trim();
}

/** Incoming means the selected college is asked to approve its own lecturer. */
export function requestDirection(request: FacultyRequest, collegeId: string) {
  return request.home_college_id === collegeId ? "incoming" : "outgoing";
}

export function filterFacultyRequests(
  requests: readonly FacultyRequest[],
  filters: {
    collegeId: string;
    status: RequestStatusFilter;
    direction: RequestDirection;
    search: string;
  },
) {
  const words = searchable(filters.search).split(/\s+/).filter(Boolean);
  return requests
    .filter((r) => {
      if (filters.status !== "all" && r.status !== filters.status) return false;
      if (
        filters.direction !== "all" &&
        requestDirection(r, filters.collegeId) !== filters.direction
      )
        return false;
      const haystack = searchable(
        [
          r.name,
          r.university_number,
          r.home_college,
          r.college,
          r.group,
          r.term,
          r.id,
          r.notes,
          r.decision_note,
        ].join(" "),
      );
      return words.every((word) => haystack.includes(word));
    })
    .sort((a, b) => {
      const priority = Number(b.status === "pending") - Number(a.status === "pending");
      return priority || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);
    });
}

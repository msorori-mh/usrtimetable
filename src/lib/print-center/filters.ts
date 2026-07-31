import { matchesStudySystem } from "@/lib/reports/filters";
import type { ReportStudySystem } from "@/lib/reports/types";
import type { PrintCenterFilters, PrintSessionLike, PrintStudySystem } from "./types";

/** Reject sessions whose college_id does not match the active college. */
export function sessionMatchesCollege(session: PrintSessionLike, collegeId: string): boolean {
  if (!collegeId) return false;
  if (session.college_id == null || session.college_id === "") {
    // Rows without college_id are treated as in-scope only when already fetched
    // under college equality; unit tests should set college_id explicitly.
    return true;
  }
  return session.college_id === collegeId;
}

/** Cross-college guard used by filters and tests. */
export function rejectMismatchedCollege(
  sessions: PrintSessionLike[],
  collegeId: string,
): PrintSessionLike[] {
  return sessions.filter((s) => sessionMatchesCollege(s, collegeId));
}

function studyFilter(sys: PrintStudySystem | null | undefined): ReportStudySystem {
  return (sys ?? "all") as ReportStudySystem;
}

/**
 * Student report requires program + level + study system (not "all").
 * Returns false when required filters are missing.
 */
export function studentFiltersComplete(filters: PrintCenterFilters): boolean {
  if (filters.reportType !== "student") return true;
  const sys = filters.studySystem;
  return !!filters.programId && !!filters.levelId && !!sys && sys !== "all";
}

/** Department report requires a department id. */
export function departmentFiltersComplete(filters: PrintCenterFilters): boolean {
  if (filters.reportType !== "department") return true;
  return !!filters.departmentId;
}

/** Level report requires a level id. */
export function levelFiltersComplete(filters: PrintCenterFilters): boolean {
  if (filters.reportType !== "level") return true;
  return !!filters.levelId;
}

/** Program report requires a program id. */
export function programFiltersComplete(filters: PrintCenterFilters): boolean {
  if (filters.reportType !== "program") return true;
  return !!filters.programId;
}

/** Pure filter: college scope + report-type dimensions. Never mutates input. */
export function filterPrintSessions(
  sessions: PrintSessionLike[],
  filters: PrintCenterFilters,
): PrintSessionLike[] {
  const scoped = rejectMismatchedCollege(sessions, filters.collegeId);

  if (filters.reportType === "student" && !studentFiltersComplete(filters)) {
    return [];
  }
  if (filters.reportType === "department" && !departmentFiltersComplete(filters)) {
    return [];
  }
  if (filters.reportType === "program" && !programFiltersComplete(filters)) {
    return [];
  }
  if (filters.reportType === "level" && !levelFiltersComplete(filters)) {
    return [];
  }

  return scoped.filter((s) => {
    const offering = s.course_offerings;
    const course = offering?.courses;

    if (filters.departmentId) {
      if (course?.department_id !== filters.departmentId) return false;
    }
    if (filters.programId) {
      if (offering?.program_id !== filters.programId) return false;
    }
    if (filters.levelId) {
      if (offering?.level_id !== filters.levelId) return false;
    }
    if (filters.instructorId) {
      if (s.instructor_id !== filters.instructorId) return false;
    }
    if (filters.roomId) {
      if (s.room_id !== filters.roomId) return false;
    }
    if (filters.cohortId) {
      if (s.cohort_id !== filters.cohortId) return false;
    }
    if (filters.deliveryGroupId) {
      if (s.delivery_group_id !== filters.deliveryGroupId) return false;
    }
    if (filters.studySystem && filters.studySystem !== "all") {
      if (!matchesStudySystem(s.study_system, studyFilter(filters.studySystem))) return false;
    }

    // Report-type defaults (when dimension ids not set):
    // department / program / instructor / room / level still apply above when set.
    return true;
  });
}

/** Stable sort: day → start → course code → id (no drop/dup; identity-preserving). */
export function sortPrintSessions(sessions: PrintSessionLike[]): PrintSessionLike[] {
  return [...sessions].sort((a, b) => {
    if (a.day_of_week !== b.day_of_week) return a.day_of_week - b.day_of_week;
    const at = a.start_time ?? "";
    const bt = b.start_time ?? "";
    if (at !== bt) return at.localeCompare(bt);
    const ac = a.course_offerings?.courses?.code ?? "";
    const bc = b.course_offerings?.courses?.code ?? "";
    if (ac !== bc) return ac.localeCompare(bc);
    return a.id.localeCompare(b.id);
  });
}

/** Deduplicate by session id while preserving first occurrence order after sort. */
export function dedupePrintSessions(sessions: PrintSessionLike[]): PrintSessionLike[] {
  const seen = new Set<string>();
  const out: PrintSessionLike[] = [];
  for (const s of sessions) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/**
 * Identity-safe pipeline for unfiltered college-scoped loads:
 * reject other colleges → dedupe → sort. Count must equal unique in-scope ids.
 */
export function preparePrintSessions(
  sessions: PrintSessionLike[],
  collegeId: string,
): PrintSessionLike[] {
  return sortPrintSessions(dedupePrintSessions(rejectMismatchedCollege(sessions, collegeId)));
}

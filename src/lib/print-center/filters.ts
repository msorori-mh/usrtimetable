import { matchesStudySystem } from "@/lib/reports/filters";
import type { ReportStudySystem } from "@/lib/reports/types";
import type {
  PrintCenterFilters,
  PrintReportType,
  PrintSessionLike,
  PrintStudySystem,
} from "./types";

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

/** Dimensions that intentionally apply for each print report type. */
export type PrintFilterDimension =
  | "programId"
  | "levelId"
  | "departmentId"
  | "instructorId"
  | "roomId"
  | "studySystem"
  | "cohortId"
  | "deliveryGroupId";

const REPORT_TYPE_DIMENSIONS: Record<PrintReportType, ReadonlySet<PrintFilterDimension>> = {
  student: new Set(["programId", "levelId", "studySystem", "cohortId", "deliveryGroupId"]),
  department: new Set(["departmentId", "programId", "levelId", "studySystem"]),
  program: new Set(["programId", "levelId", "studySystem"]),
  level: new Set(["levelId", "studySystem"]),
  instructor: new Set(["instructorId", "studySystem"]),
  room: new Set(["roomId", "studySystem"]),
};

export function dimensionsForReportType(
  reportType: PrintReportType,
): ReadonlySet<PrintFilterDimension> {
  return REPORT_TYPE_DIMENSIONS[reportType];
}

/**
 * Drop leftover filter dimensions that are not intentional for the report type
 * (e.g. programId left over after switching student → instructor).
 */
export function sanitizePrintFilters(filters: PrintCenterFilters): PrintCenterFilters {
  const allowed = dimensionsForReportType(filters.reportType);
  return {
    reportType: filters.reportType,
    collegeId: filters.collegeId,
    programId: allowed.has("programId") ? filters.programId : null,
    levelId: allowed.has("levelId") ? filters.levelId : null,
    departmentId: allowed.has("departmentId") ? filters.departmentId : null,
    instructorId: allowed.has("instructorId") ? filters.instructorId : null,
    roomId: allowed.has("roomId") ? filters.roomId : null,
    studySystem: allowed.has("studySystem") ? filters.studySystem : "all",
    cohortId: allowed.has("cohortId") ? filters.cohortId : null,
    deliveryGroupId: allowed.has("deliveryGroupId") ? filters.deliveryGroupId : null,
  };
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
  const effective = sanitizePrintFilters(filters);
  const scoped = rejectMismatchedCollege(sessions, effective.collegeId);

  if (effective.reportType === "student" && !studentFiltersComplete(effective)) {
    return [];
  }
  if (effective.reportType === "department" && !departmentFiltersComplete(effective)) {
    return [];
  }
  if (effective.reportType === "program" && !programFiltersComplete(effective)) {
    return [];
  }
  if (effective.reportType === "level" && !levelFiltersComplete(effective)) {
    return [];
  }

  return scoped.filter((s) => {
    const offering = s.course_offerings;
    const course = offering?.courses;

    if (effective.departmentId) {
      if (course?.department_id !== effective.departmentId) return false;
    }
    if (effective.programId) {
      if (offering?.program_id !== effective.programId) return false;
    }
    if (effective.levelId) {
      if (offering?.level_id !== effective.levelId) return false;
    }
    if (effective.instructorId) {
      if (s.instructor_id !== effective.instructorId) return false;
    }
    if (effective.roomId) {
      if (s.room_id !== effective.roomId) return false;
    }
    if (effective.cohortId) {
      if (s.cohort_id !== effective.cohortId) return false;
    }
    if (effective.deliveryGroupId) {
      if (s.delivery_group_id !== effective.deliveryGroupId) return false;
    }
    if (effective.studySystem && effective.studySystem !== "all") {
      if (!matchesStudySystem(s.study_system, studyFilter(effective.studySystem))) return false;
    }

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

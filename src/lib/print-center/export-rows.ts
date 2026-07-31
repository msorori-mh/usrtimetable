import { DAY_NAMES_AR, fmtTime } from "@/lib/reports/formatters";
import { STUDY_SYSTEM_LABELS } from "@/lib/reports/filters";
import type { ReportStudySystem } from "@/lib/reports/types";
import type { PrintExportRow, PrintPageGroup, PrintSessionLike } from "./types";

export type CohortDgLabels = {
  cohorts: Map<string, string>;
  deliveryGroups: Map<string, string>;
};

function componentLabel(sessionType: string | null | undefined): string {
  if (sessionType === "lab" || sessionType === "practical") return "عملي";
  if (sessionType === "tutorial") return "تمارين";
  return "نظري";
}

function groupLabel(s: PrintSessionLike, labels?: CohortDgLabels): string {
  const parts: string[] = [];
  if (s.cohort_id) {
    parts.push(labels?.cohorts.get(s.cohort_id) ?? s.cohort_id);
  }
  if (s.delivery_group_id) {
    parts.push(labels?.deliveryGroups.get(s.delivery_group_id) ?? s.delivery_group_id);
  }
  return parts.join(" / ");
}

function roomText(s: PrintSessionLike): string {
  if (!s.rooms) return "";
  return `${s.rooms.code ?? ""} ${s.rooms.name ?? ""}`.trim();
}

function studyLabel(sys: string | null | undefined): string {
  if (!sys) return "";
  if (sys === "both") return "مشترك";
  return STUDY_SYSTEM_LABELS[sys as ReportStudySystem] ?? sys;
}

/** Build one export/print table row from a session. */
export function sessionToExportRow(
  s: PrintSessionLike,
  labels?: CohortDgLabels,
  pageTitle?: string,
): PrintExportRow {
  return {
    day: DAY_NAMES_AR[s.day_of_week] ?? "",
    time: `${fmtTime(s.start_time)} - ${fmtTime(s.end_time)}`,
    course_code: s.course_offerings?.courses?.code ?? "",
    course_name: s.course_offerings?.courses?.name ?? "",
    component: componentLabel(s.session_type),
    instructor: s.instructors?.full_name ?? "",
    room: roomText(s),
    group: groupLabel(s, labels),
    program: s.course_offerings?.academic_programs?.name ?? "",
    level: s.course_offerings?.academic_levels?.name ?? "",
    study_system: studyLabel(s.study_system),
    department: s.course_offerings?.courses?.departments?.name ?? "",
    page: pageTitle,
  };
}

/** Flatten page groups into export rows (filters must already be applied). */
export function buildExportRows(
  pages: PrintPageGroup[],
  labels?: CohortDgLabels,
): PrintExportRow[] {
  const rows: PrintExportRow[] = [];
  for (const page of pages) {
    for (const s of page.sessions) {
      rows.push(sessionToExportRow(s, labels, page.title));
    }
  }
  return rows;
}

/** Count unique session ids across pages (program report may duplicate "both" onto two pages). */
export function countUniqueSessions(pages: PrintPageGroup[]): number {
  const ids = new Set<string>();
  for (const p of pages) for (const s of p.sessions) ids.add(s.id);
  return ids.size;
}

/** Max updated_at across sessions for footer. */
export function latestSessionUpdate(sessions: PrintSessionLike[]): string | null {
  let max: string | null = null;
  for (const s of sessions) {
    if (!s.updated_at) continue;
    if (!max || s.updated_at > max) max = s.updated_at;
  }
  return max;
}

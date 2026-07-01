import type { SVStatus } from "@/lib/schedule-versions/lifecycle";
import type { ReportFilters, ReportStatusMode, ReportStudySystem } from "@/lib/reports/types";

export const PUBLISHED_STATUSES: SVStatus[] = ["published"];
export const WORKING_STATUSES: SVStatus[] = ["draft", "review", "approved"];
export const SPECIFIC_VERSION_STATUSES: SVStatus[] = ["draft", "review", "approved", "published"];

export const STATUS_MODE_LABELS: Record<ReportStatusMode, string> = {
  published_only: "منشور فقط",
  working: "نسخ العمل (مسودة/مراجعة/معتمد)",
  specific_version: "نسخة محددة",
};

export const STUDY_SYSTEM_LABELS: Record<ReportStudySystem, string> = {
  regular: "النظام العام",
  parallel: "النظام الموازي",
  all: "الكل",
};

/** Statuses included in version lists for a given mode. */
export function statusesForMode(mode: ReportStatusMode): SVStatus[] {
  switch (mode) {
    case "published_only":
      return PUBLISHED_STATUSES;
    case "working":
      return WORKING_STATUSES;
    case "specific_version":
      return SPECIFIC_VERSION_STATUSES;
  }
}

/** Human-readable summary of active report filters. */
export function buildFilterSummary(filters: ReportFilters, labels?: {
  termName?: string;
  versionName?: string;
}): string {
  const parts = [
    STATUS_MODE_LABELS[filters.statusMode],
    STUDY_SYSTEM_LABELS[filters.studySystem],
  ];
  if (labels?.termName) parts.unshift(`الفصل: ${labels.termName}`);
  if (labels?.versionName) parts.push(`النسخة: ${labels.versionName}`);
  return parts.join(" · ");
}

/** Apply study_system filter to a schedule_sessions query. Sessions tagged "both" match either system. */
export function applyStudySystemFilter<T extends { in: (column: string, values: string[]) => T }>(
  query: T,
  studySystem: ReportStudySystem,
): T {
  if (studySystem === "all") return query;
  if (studySystem === "regular") return query.in("study_system", ["regular", "both"]);
  return query.in("study_system", ["parallel", "both"]);
}

/** Filter in-memory session rows by study system (for client-side post-processing). */
export function matchesStudySystem(
  sessionStudySystem: string | null | undefined,
  filter: ReportStudySystem,
): boolean {
  if (filter === "all") return true;
  const sys = sessionStudySystem ?? "regular";
  if (filter === "regular") return sys === "regular" || sys === "both";
  return sys === "parallel" || sys === "both";
}

/** Whether a version status is visible under the current status mode. */
export function versionMatchesStatusMode(status: SVStatus, mode: ReportStatusMode): boolean {
  return statusesForMode(mode).includes(status);
}

/** Reports must query a single version — never aggregate across versions unless explicitly allowed. */
export function assertSingleVersion(versionId: string | null): asserts versionId is string {
  if (!versionId) {
    throw new Error("يجب اختيار نسخة جدول واحدة لهذا التقرير.");
  }
}

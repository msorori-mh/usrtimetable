import type { QueryClient, QueryKey } from "@tanstack/react-query";

/** Reads whose result can change after an assignment or draft replacement.
 * Keys intentionally span filter variants and colleges: a faculty member may
 * teach across colleges, and university reports aggregate those assignments.
 * Invalidation rereads each report's own version; it never replaces published
 * session identities with operational assignments.
 */
const ASSIGNMENT_READ_MODEL_ROOTS = new Set([
  "teaching-assignment-workspace-v2",
  "teaching-assignment-workload-preview",
  "teaching-assignment-row-days",
  "teaching-assignment-working-versions",
  "teaching-assignment-candidates",
  "faculty-teaching-requests",
  "delivery-group-assignments-all",
  "delivery-groups",
  "report-versions",
  "schedule_versions_list",
  "sv-detail",
  "sv-eligibility",
  "sv-for-auto",
  "sv-delivery-coverage",
  "auto-schedule-readiness",
  "timetable-v2-work-items",
  "sessions-for-version",
  "university-instructor-schedule-directory",
  "instructor-teaching-colleges",
  "university-instructor-schedule",
  "reports-instructor-workload-sessions",
  "reports-instructor-workload-instructors",
  "report-instructor-directory",
  "faculty-university-report",
  "plt-version-sessions",
  "plt-delivery-group-catalog",
  "current-timetable-print",
  "current-timetable-coverage",
  "print-center-version",
  "print-center-sessions",
  "print-center-delivery-coverage",
  "report-unscheduled-v2",
  "reports-conflicts",
  "reports-room-timetable-sessions",
  "reports-section-timetable-sessions",
  "reports-department-schedule-sessions",
  "pt-sess",
  "rooms-report-sessions",
  "report-room-utilization-v2",
  "rooms-comparison",
  "rooms-decisions",
  "reports-quality-analytics-versions",
  "reports-quality-analytics-sessions",
  "academic-affairs-data",
  "university-leadership",
  "leadership-metric-details",
  "university-executive-overview",
  "dashboard-core-readiness",
  "dashboard-schedule-summary",
  "data-readiness",
  "reports-data-readiness",
]);

export function isTeachingAssignmentReadModelQuery(query: { queryKey: QueryKey }): boolean {
  const [root, detail] = query.queryKey;
  if (root === "schedule-builder") {
    // Keep room/settings/reference lookups cached; only these reads depend on
    // assignments, placements, or a changed version concurrency timestamp.
    return detail === "sessions" || detail === "versions" || detail === "v2-work-items";
  }
  if (root === "instructors")
    return detail === "university-roster" || query.queryKey[2] === "home-roster";
  return typeof root === "string" && ASSIGNMENT_READ_MODEL_ROOTS.has(root);
}

export function invalidateTeachingAssignmentReadModels(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ predicate: isTeachingAssignmentReadModelQuery });
}

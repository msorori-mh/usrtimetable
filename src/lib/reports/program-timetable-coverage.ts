/**
 * Delivery-group coverage for the program/level timetable report.
 *
 * Root cause this module fixes: the report used to derive its
 * «مجموعة المحاضرات/المعامل» options and totals from `schedule_sessions` only,
 * so any delivery group that was never placed in the selected schedule version
 * disappeared silently and the report looked complete. Coverage is computed
 * here from the authoritative delivery-group catalogue (active, non-obsolete)
 * and sessions only tell us which of those groups were actually placed.
 *
 * Read-only: nothing here creates or mutates scheduling data.
 */

export type CoverageComponentType =
  | "theory"
  | "practical"
  | "tutorial"
  | "project"
  | "summer_training"
  | (string & {});

export const COMPONENT_TYPE_LABELS_AR: Record<string, string> = {
  theory: "نظري",
  practical: "عملي",
  tutorial: "تمرين",
  project: "مشروع",
  summer_training: "تدريب صيفي",
};

export function componentTypeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  return COMPONENT_TYPE_LABELS_AR[type] ?? type;
}

/** One active, non-obsolete delivery group in the report scope. */
export interface DeliveryGroupCatalogRow {
  id: string;
  cohortId: string;
  groupCode: string | null;
  groupNumber: number | null;
  componentType: CoverageComponentType | null;
  courseCode: string | null;
  courseName: string | null;
  expectedStudents: number | null;
  /** Required weekly hours: teaching assignment hours, else component contact hours. */
  requiredHours: number;
  instructorName: string | null;
}

/** Minimal session shape needed to decide whether a group was placed. */
export interface CoverageSessionLike {
  delivery_group_id?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

export interface DeliveryGroupCoverageRow extends DeliveryGroupCatalogRow {
  scheduled: boolean;
  sessionCount: number;
  scheduledHours: number;
  /** Display label used by the filter, the coverage card and exports. */
  label: string;
  cohortLabel: string | null;
}

export interface CoverageSummary {
  totalGroups: number;
  scheduledGroups: number;
  unscheduledGroups: number;
  partialGroups?: number;
  requiredHours: number;
  scheduledHours: number;
  unscheduledHours: number;
}

export const UNSCHEDULED_BADGE_AR = "غير مجدول";

function hours(start?: string | null, end?: string | null): number {
  if (!start || !end) return 0;
  const toMinutes = (t: string) => {
    const [h, m] = t.split(":");
    return Number(h) * 60 + Number(m ?? 0);
  };
  const diff = toMinutes(end) - toMinutes(start);
  return diff > 0 ? diff / 60 : 0;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

export function deliveryGroupLabel(
  group: DeliveryGroupCatalogRow,
  cohortLabel?: string | null,
): string {
  return [
    group.groupCode ?? (group.groupNumber ? `G${group.groupNumber}` : "مجموعة"),
    group.courseName,
    group.courseCode,
    componentTypeLabel(group.componentType),
    cohortLabel,
  ]
    .filter(Boolean)
    .join(" — ");
}

/**
 * Builds the honest coverage view: every catalogue group is kept, whether or not
 * the selected schedule version placed it.
 */
export function buildDeliveryGroupCoverage(input: {
  groups: readonly DeliveryGroupCatalogRow[];
  sessions: readonly CoverageSessionLike[];
  /** Optional cohort labels, shown when the report is not scoped to one cohort. */
  cohortLabels?: ReadonlyMap<string, string>;
}): {
  rows: DeliveryGroupCoverageRow[];
  scheduled: DeliveryGroupCoverageRow[];
  unscheduled: DeliveryGroupCoverageRow[];
  incomplete: DeliveryGroupCoverageRow[];
  summary: CoverageSummary;
} {
  const placed = new Map<string, { count: number; hours: number }>();
  for (const s of input.sessions) {
    if (!s.delivery_group_id) continue;
    const acc = placed.get(s.delivery_group_id) ?? { count: 0, hours: 0 };
    acc.count += 1;
    acc.hours += hours(s.start_time, s.end_time);
    placed.set(s.delivery_group_id, acc);
  }

  const rows: DeliveryGroupCoverageRow[] = input.groups
    .map((g) => {
      const hit = placed.get(g.id);
      const cohortLabel = input.cohortLabels?.get(g.cohortId) ?? null;
      return {
        ...g,
        cohortLabel,
        scheduled: !!hit && hit.count > 0,
        sessionCount: hit?.count ?? 0,
        scheduledHours: round2(hit?.hours ?? 0),
        label: deliveryGroupLabel(g, cohortLabel),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "ar", { numeric: true }));

  const scheduled = rows.filter((r) => r.scheduled);
  const unscheduled = rows.filter((r) => !r.scheduled);
  const sum = (list: DeliveryGroupCoverageRow[], pick: (r: DeliveryGroupCoverageRow) => number) =>
    round2(list.reduce((acc, r) => acc + pick(r), 0));

  return {
    rows,
    scheduled,
    unscheduled,
    incomplete: rows.filter((r) => r.scheduledHours + 0.01 < r.requiredHours),
    summary: {
      totalGroups: rows.length,
      scheduledGroups: scheduled.length,
      unscheduledGroups: unscheduled.length,
      partialGroups: scheduled.filter((r) => r.scheduledHours + 0.01 < r.requiredHours).length,
      requiredHours: sum(rows, (r) => r.requiredHours),
      scheduledHours: sum(rows, (r) => r.scheduledHours),
      unscheduledHours: sum(rows, (r) => Math.max(0, r.requiredHours - r.scheduledHours)),
    },
  };
}

/** Filter option label — an unscheduled group stays visible and is marked. */
export function coverageFilterOption(row: DeliveryGroupCoverageRow): {
  id: string;
  name: string;
} {
  return { id: row.id, name: row.scheduled ? row.label : `${row.label} — ${UNSCHEDULED_BADGE_AR}` };
}

export const COVERAGE_EXPORT_HEADERS: { key: string; label: string }[] = [
  { key: "status", label: "الحالة" },
  { key: "course", label: "المقرر" },
  { key: "component", label: "المكوّن" },
  { key: "delivery_group", label: "مجموعة المحاضرات/المعامل" },
  { key: "cohort", label: "الدفعة الدراسية" },
  { key: "students", label: "الطلاب" },
  { key: "required_hours", label: "الساعات المطلوبة" },
  { key: "scheduled_hours", label: "الساعات المجدولة" },
  { key: "instructor", label: "المحاضر" },
];

/** Export rows for the unscheduled groups, appended so no export looks complete. */
export function coverageExportRows(
  rows: readonly DeliveryGroupCoverageRow[],
): Record<string, string | number>[] {
  return rows.map((r) => ({
    status: r.scheduled ? "مجدول" : UNSCHEDULED_BADGE_AR,
    course: [r.courseCode, r.courseName].filter(Boolean).join(" ") || "—",
    component: componentTypeLabel(r.componentType),
    delivery_group: r.groupCode ?? (r.groupNumber ? `G${r.groupNumber}` : "—"),
    cohort: r.cohortLabel ?? "",
    students: r.expectedStudents ?? "",
    required_hours: r.requiredHours,
    scheduled_hours: r.scheduledHours,
    instructor: r.instructorName ?? "",
  }));
}

export function coverageSummaryText(s: CoverageSummary): string {
  return [
    `المجموعات المجدولة ${s.scheduledGroups}/${s.totalGroups}`,
    `الساعات المجدولة ${s.scheduledHours} من ${s.requiredHours}`,
    s.unscheduledGroups > 0
      ? `غير المجدول: ${s.unscheduledGroups} مجموعة / ${s.unscheduledHours} ساعة`
      : s.unscheduledHours > 0
        ? `تغطية جزئية: ${s.unscheduledHours} ساعة متبقية`
        : "لا توجد مجموعات غير مجدولة",
  ].join(" · ");
}

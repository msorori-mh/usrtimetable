import { supabase } from "@/integrations/supabase/client";
import type { SVStatus } from "@/lib/schedule-versions/lifecycle";

/**
 * Read-only view over the database delivery-coverage guards.
 *
 * The database remains the final authority: `transition_schedule_version`
 * rejects review/approved/published with `PUBLISH_BLOCKER:INCOMPLETE_DELIVERY_COVERAGE`
 * and a trigger blocks completing an auto-schedule run while coverage is short.
 * This module only surfaces the same numbers in the UI so users see the gap
 * before they hit the guard. Nothing here writes scheduling data.
 */

export interface DeliveryCoverage {
  totalGroups: number;
  assignedExactlyOnce: number;
  unassignedGroups: number;
  multiAssignedGroups: number;
  groupsWithSessions: number;
  groupsWithoutSessions: number;
  exactHoursGroups: number;
  shortHoursGroups: number;
  overHoursGroups: number;
  requiredHours: number;
  scheduledHours: number;
  missingHours: number;
  extraHours: number;
  complete: boolean;
}

export interface DeliveryGapRow {
  delivery_group_id: string;
  program_name: string | null;
  program_code: string | null;
  study_system: string | null;
  level_name: string | null;
  level_number: number | null;
  cohort_code: string | null;
  course_code: string | null;
  course_name: string | null;
  component_type: string | null;
  group_code: string | null;
  group_number: number | null;
  expected_students: number | null;
  instructor_names: string | null;
  required_hours: number | null;
  scheduled_hours: number | null;
  missing_hours: number | null;
  scheduling_state: string | null;
  active_assignment_count: number | null;
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/** Normalizes the RPC payload; missing fields degrade to 0 / not-complete. */
export function parseDeliveryCoverage(payload: unknown): DeliveryCoverage {
  const r = (payload ?? {}) as Record<string, unknown>;
  return {
    totalGroups: num(r.total_groups),
    assignedExactlyOnce: num(r.assigned_exactly_once),
    unassignedGroups: num(r.unassigned_groups),
    multiAssignedGroups: num(r.multi_assigned_groups),
    groupsWithSessions: num(r.groups_with_sessions),
    groupsWithoutSessions: num(r.groups_without_sessions),
    exactHoursGroups: num(r.exact_hours_groups),
    shortHoursGroups: num(r.short_hours_groups),
    overHoursGroups: num(r.over_hours_groups),
    requiredHours: num(r.required_hours),
    scheduledHours: num(r.scheduled_hours),
    missingHours: num(r.missing_hours),
    extraHours: num(r.extra_hours),
    complete: r.complete === true,
  };
}

export async function fetchDeliveryCoverage(params: {
  collegeId: string;
  scheduleVersionId: string;
}): Promise<DeliveryCoverage> {
  const { data, error } = await supabase.rpc("schedule_version_delivery_coverage", {
    p_college_id: params.collegeId,
    p_schedule_version_id: params.scheduleVersionId,
  });
  if (error) throw error;
  return parseDeliveryCoverage(data);
}

export async function fetchDeliveryGaps(params: {
  collegeId: string;
  scheduleVersionId: string;
}): Promise<DeliveryGapRow[]> {
  const { data, error } = await supabase.rpc("list_schedule_version_delivery_gaps", {
    p_college_id: params.collegeId,
    p_schedule_version_id: params.scheduleVersionId,
  });
  if (error) throw error;
  return (data ?? []) as DeliveryGapRow[];
}

/** Statuses the database guard refuses while coverage is incomplete. */
export const COVERAGE_GATED_STATUSES: readonly SVStatus[] = ["review", "approved", "published"];

/** Human reason shown next to a disabled transition button (empty when allowed). */
export function coverageBlockers(
  target: SVStatus,
  coverage: DeliveryCoverage | null | undefined,
): string[] {
  if (!COVERAGE_GATED_STATUSES.includes(target)) return [];
  if (!coverage || coverage.complete) return [];
  const parts = [
    `المجموعات غير المجدولة: ${coverage.groupsWithoutSessions}`,
    `الساعات الناقصة: ${coverage.missingHours}`,
  ];
  if (coverage.unassignedGroups > 0) parts.push(`مجموعات بدون إسناد: ${coverage.unassignedGroups}`);
  if (coverage.shortHoursGroups > 0) parts.push(`مجموعات بساعات ناقصة: ${coverage.shortHoursGroups}`);
  return [`تغطية النسخة غير مكتملة — ${parts.join(" • ")}. أكمل الجدول قبل هذا الإجراء.`];
}

/** True when the run finished but the version is still short of full coverage. */
export function isPartialRunOutcome(params: {
  unplaced: number;
  coverage: DeliveryCoverage | null | undefined;
}): boolean {
  return params.unplaced > 0 || (params.coverage ? !params.coverage.complete : false);
}

/** Message for the auto-scheduler screen — never a plain success when partial. */
export function autoRunOutcomeMessage(params: {
  placed: number;
  totalRequired: number;
  unplaced: number;
  coverage: DeliveryCoverage | null | undefined;
}): { partial: boolean; text: string } {
  const partial = isPartialRunOutcome({ unplaced: params.unplaced, coverage: params.coverage });
  const cov = params.coverage;
  const covText = cov
    ? ` — المجموعات المجدولة ${cov.groupsWithSessions}/${cov.totalGroups} — الساعات ${cov.scheduledHours}/${cov.requiredHours} — الناقص ${cov.groupsWithoutSessions} مجموعة / ${cov.missingHours} ساعة`
    : "";
  if (!partial) {
    return {
      partial: false,
      text: `تمت الجدولة بالكامل — وُضع ${params.placed}/${params.totalRequired}${covText}`,
    };
  }
  return {
    partial: true,
    text: `تم إنشاء مسودة جزئية — وُضع ${params.placed}/${params.totalRequired}، تعذّر ${params.unplaced}${covText}. راجع «عرض النواقص».`,
  };
}

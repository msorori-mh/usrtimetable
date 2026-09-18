/**
 * INSTRUCTOR-QUOTA-RESOLUTION-01
 *
 * Single source of truth for «النصاب المعتمد» of one faculty member.
 *
 * Root cause this module fixes: the workload report read the approved load ONLY
 * from `faculty_workload_policies.required_load_hours` (matched by academic rank
 * inside `compute_instructor_standard_workload`). That table is empty in
 * production, so every member fell into "policy_missing" and the whole report
 * showed no quota — even though each `instructors` row carries a real approved
 * weekly load in `max_weekly_hours` (plus `administrative_release_hours`).
 *
 * Resolution order (read-only, no data is invented):
 *   1. the member’s own approved weekly hours          → source "instructor"
 *   2. active rank policy hours, when a policy exists  → source "policy"
 *   3. otherwise                                         → source "missing"
 *
 * Zero is a REAL approved value (source stays "policy"/"instructor"); only a
 * null/non-finite value is «غير محدد». Missing quota never becomes 0, never
 * produces overload/deficit, and is excluded from totals.
 */

import { effectiveInstructorWeeklyHours } from "@/lib/instructors/effective-hours";

export type QuotaSource = "policy" | "instructor" | "missing";

export interface QuotaInput {
  /** hours from the active rank policy, when one exists */
  policyRequiredHours?: number | null;
  /** the member's own approved weekly load (`instructors.max_weekly_hours`) */
  maxWeeklyHours?: number | null;
  /** administrative release (`instructors.administrative_release_hours`) */
  adminReleaseHours?: number | null;
}

export interface ResolvedQuota {
  /** approved base quota before the administrative release; null when undefined */
  baseHours: number | null;
  /** administrative release actually applied (0 when absent) */
  releaseHours: number;
  /** net approved quota = base − release, floored at 0; null when undefined */
  netHours: number | null;
  source: QuotaSource;
}

export interface QuotaBalance extends ResolvedQuota {
  assignedHours: number;
  /** null when there is no approved quota — never 0 as a substitute */
  overloadHours: number | null;
  deficitHours: number | null;
  status: "overload" | "deficit" | "balanced" | "missing";
}

const isRealNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function resolveInstructorQuota(input: QuotaInput): ResolvedQuota {
  const release = isRealNumber(input.adminReleaseHours)
    ? Math.max(0, round2(input.adminReleaseHours))
    : 0;
  const policy = isRealNumber(input.policyRequiredHours) ? round2(input.policyRequiredHours) : null;
  const own = isRealNumber(input.maxWeeklyHours) ? round2(input.maxWeeklyHours) : null;
  const base = own ?? policy;
  const source: QuotaSource = own !== null ? "instructor" : policy !== null ? "policy" : "missing";
  return {
    baseHours: base,
    releaseHours: release,
    netHours: effectiveInstructorWeeklyHours(base, release),
    source,
  };
}

export function computeQuotaBalance(input: QuotaInput & { assignedHours: number }): QuotaBalance {
  const quota = resolveInstructorQuota(input);
  const assigned = isRealNumber(input.assignedHours) ? round2(Math.max(0, input.assignedHours)) : 0;
  if (quota.netHours === null) {
    return {
      ...quota,
      assignedHours: assigned,
      overloadHours: null,
      deficitHours: null,
      status: "missing",
    };
  }
  const overload = round2(Math.max(0, assigned - quota.netHours));
  const deficit = round2(Math.max(0, quota.netHours - assigned));
  return {
    ...quota,
    assignedHours: assigned,
    overloadHours: overload,
    deficitHours: deficit,
    status: overload > 0 ? "overload" : deficit > 0 ? "deficit" : "balanced",
  };
}

export const QUOTA_STATUS_LABEL_AR: Record<QuotaBalance["status"], string> = {
  overload: "ساعات زائدة",
  deficit: "نقص في النصاب",
  balanced: "مكتمل النصاب",
  missing: "الساعات الزائدة بانتظار استكمال بيانات النصاب",
};

export const QUOTA_SOURCE_LABEL_AR: Record<QuotaSource, string> = {
  policy: "سياسة النصاب للرتبة",
  instructor: "بطاقة عضو هيئة التدريس",
  missing: "غير محدد",
};

/** Display token for a value that has no approved quota — never "0". */
export const QUOTA_UNDEFINED_AR = "غير محدد";

/** Totals must ignore members without an approved quota so they stay truthful. */
export function summarizeQuotaBalances(balances: QuotaBalance[]) {
  const counted = balances.filter((b) => b.status !== "missing");
  const sum = (pick: (b: QuotaBalance) => number) =>
    round2(counted.reduce((s, b) => s + pick(b), 0));
  return {
    countedMembers: counted.length,
    missingMembers: balances.length - counted.length,
    assignedHours: sum((b) => b.assignedHours),
    netQuotaHours: sum((b) => b.netHours ?? 0),
    overloadHours: sum((b) => b.overloadHours ?? 0),
    deficitHours: sum((b) => b.deficitHours ?? 0),
    overloadedMembers: counted.filter((b) => (b.overloadHours ?? 0) > 0).length,
    deficitMembers: counted.filter((b) => (b.deficitHours ?? 0) > 0).length,
  };
}


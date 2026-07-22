/**
 * A3.5: Faculty workload policies — client-side validation + display labels.
 * Mirrors the RPC-side checks (the RPC remains the source of truth).
 */
import type {
  WorkloadAssignedHoursRow,
  WorkloadStatus,
  WorkloadStudySystem,
  WorkloadWarningCode,
} from "./types";

export const WORKLOAD_STUDY_SYSTEMS: readonly WorkloadStudySystem[] = [
  "regular",
  "parallel",
  "evening",
  "distance",
  "other",
];

export type WorkloadRuleIssue =
  | "RANK_CODE_INVALID"
  | "REQUIRED_LOAD_INVALID"
  | "STUDY_SYSTEM_INVALID"
  | "NEGATIVE_HOURS"
  | "MAX_BELOW_MIN";

export function validateWorkloadPolicyValues(input: {
  rankCode: string;
  requiredLoadHours: number;
  studySystem?: string | null;
  minLoadHours?: number | null;
  maxLoadHours?: number | null;
}): WorkloadRuleIssue[] {
  const issues: WorkloadRuleIssue[] = [];
  if (!/^[a-z][a-z0-9_]*$/.test(input.rankCode)) issues.push("RANK_CODE_INVALID");
  if (!Number.isFinite(input.requiredLoadHours) || input.requiredLoadHours <= 0) {
    issues.push("REQUIRED_LOAD_INVALID");
  }
  if (
    input.studySystem != null &&
    input.studySystem !== "" &&
    !WORKLOAD_STUDY_SYSTEMS.includes(input.studySystem as WorkloadStudySystem)
  ) {
    issues.push("STUDY_SYSTEM_INVALID");
  }
  const min = input.minLoadHours ?? null;
  const max = input.maxLoadHours ?? null;
  if (
    (min !== null && (!Number.isFinite(min) || min < 0)) ||
    (max !== null && (!Number.isFinite(max) || max < 0))
  ) {
    issues.push("NEGATIVE_HOURS");
  }
  if (min !== null && max !== null && max < min) issues.push("MAX_BELOW_MIN");
  return issues;
}

export const WORKLOAD_RULE_MESSAGES: Record<WorkloadRuleIssue, string> = {
  RANK_CODE_INVALID: "رمز الدرجة يجب أن يكون snake_case بحروف إنجليزية صغيرة.",
  REQUIRED_LOAD_INVALID: "النصاب المطلوب يجب أن يكون أكبر من صفر.",
  STUDY_SYSTEM_INVALID: "نظام الدراسة غير ضمن القيم المسموحة.",
  NEGATIVE_HOURS: "حدود النصاب يجب ألا تكون سالبة.",
  MAX_BELOW_MIN: "الحد الأعلى يجب ألا يقل عن الحد الأدنى.",
};

/** remaining = required − assigned (null when no policy is resolved). */
export function remainingHours(row: WorkloadAssignedHoursRow): number | null {
  if (row.required_load_hours === null || row.required_load_hours === undefined) return null;
  return Math.round((row.required_load_hours - row.standard_assigned_hours) * 100) / 100;
}

export function workloadStatusLabel(status: WorkloadStatus): string {
  switch (status) {
    case "ok":
      return "ضمن النصاب";
    case "deficit":
      return "أقل من النصاب";
    case "overload":
      return "تجاوز النصاب (تحذير)";
    case "over_max":
      return "تجاوز الحد الأعلى";
    case "below_min":
      return "دون الحد الأدنى";
    case "unassigned":
      return "بدون إسناد";
    case "policy_missing":
      return "لا توجد سياسة";
  }
}

export function studySystemLabel(system: WorkloadStudySystem | null | undefined): string {
  switch (system) {
    case "regular":
      return "انتظام";
    case "parallel":
      return "انتساب";
    case "evening":
      return "مسائي";
    case "distance":
      return "عن بعد";
    case "other":
      return "أخرى";
    default:
      return "الكل";
  }
}

export function warningCodeLabel(code: WorkloadWarningCode): string {
  switch (code) {
    case "WORKLOAD_OVER_MAX":
      return "تجاوز الحد الأعلى للنصاب";
    case "WORKLOAD_OVERLOAD":
      return "تجاوز النصاب المطلوب";
    case "WORKLOAD_BELOW_MIN":
      return "دون الحد الأدنى للنصاب";
    case "WORKLOAD_DEFICIT":
      return "عجز عن النصاب المطلوب";
    case "WORKLOAD_UNASSIGNED":
      return "بدون إسناد تدريسي";
    case "POLICY_MISSING":
      return "لا توجد سياسة مطابقة";
  }
}

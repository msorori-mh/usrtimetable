/**
 * Enrollment count trust policy.
 * Numeric store remains course_offerings.expected_students.
 * Trust is enrollment_count_status — test/unverified data must not auto-split or hard-block capacity.
 */

export const ENROLLMENT_COUNT_STATUSES = ["confirmed", "estimated", "unverified", "test"] as const;

export type EnrollmentCountStatus = (typeof ENROLLMENT_COUNT_STATUSES)[number];

export const DEFAULT_ENROLLMENT_COUNT_STATUS: EnrollmentCountStatus = "unverified";

export const UNVERIFIED_ENROLLMENT_BADGE_AR = "عدد الطلاب غير معتمد";
export const TEST_ENROLLMENT_BADGE_AR = "بيانات تجريبية";
export const ESTIMATED_ENROLLMENT_BADGE_AR = "عدد تقديري";
export const CONFIRMED_ENROLLMENT_BADGE_AR = "عدد مؤكد";

export const ENROLLMENT_STATUS_LABEL_AR: Record<EnrollmentCountStatus, string> = {
  confirmed: "مؤكد",
  estimated: "تقديري",
  unverified: "غير معتمد",
  test: "تجريبي",
};

/** Schedule Builder trust warnings (centralized). */
export const ENROLLMENT_TRUST_WARNING_AR: Record<EnrollmentCountStatus, string> = {
  confirmed: "عدد الطلاب مؤكد ويُستخدم في فحص السعة الإلزامي (+5).",
  estimated: "عدد الطلاب تقديري؛ لن يمنع الحفظ بسبب السعة وحدها.",
  unverified: "عدد الطلاب غير معتمد؛ فحص السعة إرشادي فقط.",
  test: "هذه بيانات تجريبية ولا يعتمد عليها في قرارات السعة.",
};

export type CapacityFitKind = "suitable" | "within_exception" | "needs_split" | "unknown";

export function capacityFitForConfirmed(params: {
  enrollmentCount: number;
  roomCapacity: number | null | undefined;
  capacityExceptionLimit?: number;
}): {
  kind: CapacityFitKind;
  labelAr: string;
  overBy: number | null;
} {
  const cap = params.roomCapacity;
  const n = Math.max(0, params.enrollmentCount);
  const limit = params.capacityExceptionLimit ?? 5;
  if (cap == null || !Number.isFinite(cap) || cap <= 0) {
    return { kind: "unknown", labelAr: "سعة القاعة غير معروفة", overBy: null };
  }
  if (n <= cap) {
    return { kind: "suitable", labelAr: "مناسب", overBy: 0 };
  }
  if (n <= cap + limit) {
    return {
      kind: "within_exception",
      labelAr: `ضمن استثناء +${limit}`,
      overBy: n - cap,
    };
  }
  return {
    kind: "needs_split",
    labelAr: "يحتاج تقسيمًا",
    overBy: n - (cap + limit),
  };
}

export function enrollmentStatusBadgeVariant(
  status: EnrollmentCountStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "confirmed") return "default";
  if (status === "estimated") return "secondary";
  if (status === "test") return "destructive";
  return "outline";
}

export function normalizeEnrollmentCountStatus(
  value: string | null | undefined,
): EnrollmentCountStatus {
  if (
    value === "confirmed" ||
    value === "estimated" ||
    value === "unverified" ||
    value === "test"
  ) {
    return value;
  }
  return DEFAULT_ENROLLMENT_COUNT_STATUS;
}

/** Hard capacity (+5) applies only to confirmed enrollment. */
export function isHardCapacityStatus(status: EnrollmentCountStatus): boolean {
  return status === "confirmed";
}

/** Soft capacity warning (never blocks save alone). */
export function isSoftCapacityStatus(status: EnrollmentCountStatus): boolean {
  return status === "estimated" || status === "unverified" || status === "test";
}

export function showUnverifiedEnrollmentBadge(status: EnrollmentCountStatus): boolean {
  return status === "unverified" || status === "test";
}

/**
 * Capacity evaluation for a session placement.
 * - confirmed over capacity+5 → hard block
 * - estimated/unverified/test over capacity+5 → soft warning
 * - otherwise ok
 */
export function evaluateCapacityAgainstRoom(params: {
  enrollmentCount: number;
  enrollmentStatus: EnrollmentCountStatus | string | null | undefined;
  roomCapacity: number;
  capacityExceptionLimit?: number;
}): {
  outcome: "ok" | "hard_block" | "soft_warning";
  code: "room_capacity" | "room_capacity_unverified" | null;
  status: EnrollmentCountStatus;
} {
  const status = normalizeEnrollmentCountStatus(params.enrollmentStatus);
  const limit = params.capacityExceptionLimit ?? 5;
  const count = Math.max(0, params.enrollmentCount);
  if (count <= 0 || count <= params.roomCapacity + limit) {
    return { outcome: "ok", code: null, status };
  }
  if (isHardCapacityStatus(status)) {
    return { outcome: "hard_block", code: "room_capacity", status };
  }
  return { outcome: "soft_warning", code: "room_capacity_unverified", status };
}

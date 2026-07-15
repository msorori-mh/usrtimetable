/**
 * Enrollment count trust policy.
 * Numeric store remains course_offerings.expected_students.
 * Trust is enrollment_count_status — test/unverified data must not auto-split or hard-block capacity.
 */

export const ENROLLMENT_COUNT_STATUSES = ["confirmed", "estimated", "unverified", "test"] as const;

export type EnrollmentCountStatus = (typeof ENROLLMENT_COUNT_STATUSES)[number];

export const DEFAULT_ENROLLMENT_COUNT_STATUS: EnrollmentCountStatus = "unverified";

export const UNVERIFIED_ENROLLMENT_BADGE_AR = "عدد الطلاب غير معتمد";

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

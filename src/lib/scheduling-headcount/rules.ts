export type HeadcountValidationIssue =
  | "NEGATIVE_COUNT"
  | "OVER_ELIGIBLE_REQUIRES_REASON"
  | "MISSING_OVERRIDE_TARGET";

export interface HeadcountValues {
  registeredStudentCount: number;
  eligibleStudentCount: number;
  expectedAttendanceCount: number;
  reserveMargin: number;
  schedulingHeadcount: number;
  examEligibleCount: number;
  notes?: string | null;
  allowOverEligible?: boolean;
}

export function hasNonEmptyReason(notes: string | null | undefined): boolean {
  return Boolean(notes?.trim());
}

export function validateHeadcountValues(values: HeadcountValues): HeadcountValidationIssue[] {
  const counts = [
    values.registeredStudentCount,
    values.eligibleStudentCount,
    values.expectedAttendanceCount,
    values.reserveMargin,
    values.schedulingHeadcount,
    values.examEligibleCount,
  ];
  if (counts.some((value) => !Number.isInteger(value) || value < 0)) return ["NEGATIVE_COUNT"];

  const exceedsEligible =
    values.schedulingHeadcount > values.eligibleStudentCount ||
    values.expectedAttendanceCount > values.eligibleStudentCount;
  if (exceedsEligible && (!values.allowOverEligible || !hasNonEmptyReason(values.notes))) {
    return ["OVER_ELIGIBLE_REQUIRES_REASON"];
  }
  return [];
}

export function validateOverrideTarget(
  courseOfferingId: string | null | undefined,
  planCourseComponentId: string | null | undefined,
): HeadcountValidationIssue[] {
  return courseOfferingId || planCourseComponentId ? [] : ["MISSING_OVERRIDE_TARGET"];
}

export function differsMateriallyFromEligible(
  schedulingHeadcount: number,
  eligibleStudentCount: number,
): boolean {
  if (eligibleStudentCount <= 0) return schedulingHeadcount > 0;
  return Math.abs(schedulingHeadcount - eligibleStudentCount) / eligibleStudentCount > 0.2;
}

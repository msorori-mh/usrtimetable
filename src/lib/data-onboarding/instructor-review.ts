export const INSTRUCTOR_REVIEW_LABELS = {
  missing_specialization: "محاضرون بدون تخصص",
  missing_department: "محاضرون بدون قسم",
} as const;

export type InstructorReview = keyof typeof INSTRUCTOR_REVIEW_LABELS;
export type InstructorReviewSearch = { review?: InstructorReview };

export function parseInstructorReviewSearch(
  search: Record<string, unknown>,
): InstructorReviewSearch {
  return search.review === "missing_specialization" || search.review === "missing_department"
    ? { review: search.review }
    : {};
}

export function instructorReviewForMetric(label: string): InstructorReview | undefined {
  return label === INSTRUCTOR_REVIEW_LABELS.missing_specialization
    ? "missing_specialization"
    : label === INSTRUCTOR_REVIEW_LABELS.missing_department
      ? "missing_department"
      : undefined;
}

/** Shared by readiness counts and the repair list so they describe the same records. */
export function isMissingInstructorSpecialization(row: { specialization: string | null }): boolean {
  return !row.specialization?.trim();
}

export function isMissingInstructorDepartment(row: { department_id: string | null }): boolean {
  return !row.department_id;
}

export function instructorNeedsReview(
  row: { specialization: string | null; department_id: string | null },
  review: InstructorReview,
): boolean {
  return review === "missing_specialization"
    ? isMissingInstructorSpecialization(row)
    : isMissingInstructorDepartment(row);
}

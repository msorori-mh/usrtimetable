/**
 * Compatibility boundary for records that may still carry a Legacy section_id.
 * New academic-delivery callers must provide cohort/delivery-group context.
 */
export type StudySystem = "regular" | "parallel";

export type AcademicDeliveryContext =
  | {
      mode: "academic_cohort";
      cohortId: string;
      deliveryGroupId: string | null;
      legacySectionId: string | null;
    }
  | {
      mode: "legacy_section";
      sectionId: string;
    };

export type ResolveAcademicDeliveryContextInput = {
  cohortId?: string | null;
  deliveryGroupId?: string | null;
  sectionId?: string | null;
  cohortStudySystem?: StudySystem | null;
  recordStudySystem?: StudySystem | null;
  allowLegacySectionFallback?: boolean;
};

export function resolveAcademicDeliveryContext(
  input: ResolveAcademicDeliveryContextInput,
): AcademicDeliveryContext {
  const cohortId = input.cohortId || null;
  const deliveryGroupId = input.deliveryGroupId || null;
  const sectionId = input.sectionId || null;

  if (deliveryGroupId && !cohortId) {
    throw new Error("DELIVERY_GROUP_REQUIRES_ACADEMIC_COHORT");
  }

  if (
    cohortId &&
    input.cohortStudySystem &&
    input.recordStudySystem &&
    input.cohortStudySystem !== input.recordStudySystem
  ) {
    throw new Error("ACADEMIC_COHORT_STUDY_SYSTEM_MISMATCH");
  }

  if (cohortId) {
    return {
      mode: "academic_cohort",
      cohortId,
      deliveryGroupId,
      // Retained only so Legacy persistence/report adapters can round-trip old rows.
      // It never becomes the authority when academic_cohort is present.
      legacySectionId: sectionId,
    };
  }

  if (sectionId && input.allowLegacySectionFallback === true) {
    return { mode: "legacy_section", sectionId };
  }

  if (sectionId) {
    throw new Error("LEGACY_SECTION_FALLBACK_NOT_AUTHORIZED");
  }

  throw new Error("ACADEMIC_COHORT_CONTEXT_REQUIRED");
}

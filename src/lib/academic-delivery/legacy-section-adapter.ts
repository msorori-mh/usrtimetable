/**
 * Compatibility boundary for records that may still carry a Legacy section_id.
 * New academic-delivery callers must provide cohort/delivery-group context.
 */
export type StudySystem = "regular" | "parallel" | "both";

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
  deliveryGroupCohortId?: string | null;
  deliveryGroupStudySystem?: StudySystem | null;
  /**
   * Compatibility policy only. This is not an authorization check; callers must
   * complete their authenticated college/capability check before opting in.
   */
  legacySectionFallbackPolicy?: "legacy_compatibility_required";
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

  if (cohortId) {
    if (!input.cohortStudySystem || !input.recordStudySystem) {
      throw new Error("ACADEMIC_COHORT_STUDY_SYSTEM_REQUIRED");
    }
    if (input.cohortStudySystem === "both" || input.recordStudySystem === "both") {
      throw new Error("ACADEMIC_COHORT_STUDY_SYSTEM_AMBIGUOUS");
    }
    if (input.cohortStudySystem !== input.recordStudySystem) {
      throw new Error("ACADEMIC_COHORT_STUDY_SYSTEM_MISMATCH");
    }
    if (deliveryGroupId) {
      if (!input.deliveryGroupCohortId || !input.deliveryGroupStudySystem) {
        throw new Error("DELIVERY_GROUP_CONTEXT_REQUIRED");
      }
      if (input.deliveryGroupCohortId !== cohortId) {
        throw new Error("DELIVERY_GROUP_COHORT_MISMATCH");
      }
      if (
        input.deliveryGroupStudySystem === "both" ||
        input.deliveryGroupStudySystem !== input.cohortStudySystem
      ) {
        throw new Error("DELIVERY_GROUP_STUDY_SYSTEM_MISMATCH");
      }
    }
    return {
      mode: "academic_cohort",
      cohortId,
      deliveryGroupId,
      // Retained only so Legacy persistence/report adapters can round-trip old rows.
      // It never becomes the authority when academic_cohort is present.
      legacySectionId: sectionId,
    };
  }

  if (sectionId && input.legacySectionFallbackPolicy === "legacy_compatibility_required") {
    return { mode: "legacy_section", sectionId };
  }

  if (sectionId) {
    throw new Error("LEGACY_SECTION_FALLBACK_POLICY_NOT_ENABLED");
  }

  throw new Error("ACADEMIC_COHORT_CONTEXT_REQUIRED");
}

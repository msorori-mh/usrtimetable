import { resolveAcademicDeliveryContext } from "../../src/lib/academic-delivery/legacy-section-adapter.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    assert(error instanceof Error && error.message === code, code);
    return;
  }
  throw new Error(`expected ${code}`);
}

const cohort = resolveAcademicDeliveryContext({
  cohortId: "cohort-1",
  deliveryGroupId: "group-1",
  sectionId: "legacy-section-1",
  cohortStudySystem: "regular",
  recordStudySystem: "regular",
});
assert(cohort.mode === "academic_cohort", "cohort path is authoritative");
assert(cohort.deliveryGroupId === "group-1", "delivery group retained");
assert(cohort.legacySectionId === "legacy-section-1", "legacy id may round-trip only");

expectError(
  () => resolveAcademicDeliveryContext({ deliveryGroupId: "group-1" }),
  "DELIVERY_GROUP_REQUIRES_ACADEMIC_COHORT",
);
expectError(
  () => resolveAcademicDeliveryContext({ sectionId: "section-1" }),
  "LEGACY_SECTION_FALLBACK_NOT_AUTHORIZED",
);
expectError(
  () =>
    resolveAcademicDeliveryContext({
      cohortId: "cohort-1",
      cohortStudySystem: "regular",
      recordStudySystem: "parallel",
    }),
  "ACADEMIC_COHORT_STUDY_SYSTEM_MISMATCH",
);

const legacy = resolveAcademicDeliveryContext({
  sectionId: "section-1",
  allowLegacySectionFallback: true,
});
assert(legacy.mode === "legacy_section", "explicit Legacy fallback remains available");

console.log("academic-cohort-legacy-section-adapter.harness.ts: PASS");

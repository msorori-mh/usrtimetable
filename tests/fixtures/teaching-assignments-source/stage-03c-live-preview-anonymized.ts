/**
 * Anonymized reproduction of the live preview shape recorded for Stage 03C.
 * Counts are evidence from the read-only preview; examples preserve only
 * formatting/scoping patterns and contain no names or live academic records.
 */
export const stage03cLivePreviewDistribution = {
  sourceRows: 131,
  expandedRows: 265,
  ready: 0,
  courseNotFound: 186,
  ambiguousComponent: 36,
  ambiguousInstructor: 17,
  unknownProgram: 2,
  missingDeliveryGroups: 24,
} as const;

export const stage03cAnonymousMatchingCases = {
  courseCodes: ["CS101", "cs 101", "CS-١٠١", "ＣＳ ۱۰۱"],
  courseNames: ["مقدمة في البرمجة", "مقدمة، في البرمجة", "مقدمة-في-البرمجة", "مقدمة  في  البرمجة"],
  instructorNames: ["محاضر اختباري", "محاضر،اختباري", "د. محاضر اختباري"],
} as const;

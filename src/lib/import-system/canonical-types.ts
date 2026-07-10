import type { CanonicalImportDataType } from "./contracts";

/** Same order as canonical-types-final-list.csv */
export const CANONICAL_IMPORT_DATA_TYPES: readonly CanonicalImportDataType[] = [
  "academic_terms",
  "departments",
  "academic_programs",
  "study_plan_rows",
  "course_programs",
  "instructors",
  "rooms",
  "instructor_availability",
  "room_availability",
  "time_slot_templates",
  "daily_breaks",
  "course_offerings",
  "sections",
  "teaching_assignments",
  "section_groups",
] as const;

const CANONICAL_TYPE_SET = new Set<string>(CANONICAL_IMPORT_DATA_TYPES);

export function isCanonicalImportDataType(value: string): value is CanonicalImportDataType {
  return CANONICAL_TYPE_SET.has(value);
}

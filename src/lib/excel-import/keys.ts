export function normalizeImportKeyPart(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase("en-US");
}

export function sectionIsolationKey(values: Record<string, unknown>): string {
  return [
    values.term_code,
    values.course_code,
    values.section_number,
    values.study_system ?? "regular",
  ]
    .map(normalizeImportKeyPart)
    .join("|");
}

export function deliveryGroupIsolationKey(values: Record<string, unknown>): string {
  return [
    values.cohort_code,
    values.course_code,
    values.component_type,
    values.delivery_group_code,
    values.employee_number,
  ]
    .map(normalizeImportKeyPart)
    .join("|");
}

/**
 * Phase 9.3 — delivery group generator summary types + pure parser (no Supabase import).
 */

export type DeliveryGroupGeneratorWarning = {
  code: string;
  delivery_group_id?: string;
  group_number?: number;
  component_id?: string;
  message?: string;
  [key: string]: unknown;
};

export type DeliveryGroupGeneratorSkipped = {
  code: string;
  component_id?: string;
  component_type?: string;
  course_offering_id?: string;
  [key: string]: unknown;
};

export type DeliveryGroupGeneratorValidationError = {
  code: string;
  component_id?: string;
  component_type?: string;
  message?: string;
  [key: string]: unknown;
};

export type DeliveryGroupGeneratorSummary = {
  cohorts_processed: number;
  cohort_id: string;
  college_id: string;
  student_count: number;
  components_processed: number;
  groups_created: number;
  groups_updated: number;
  groups_unchanged: number;
  groups_obsolete: number;
  skipped_components: DeliveryGroupGeneratorSkipped[];
  warnings: DeliveryGroupGeneratorWarning[];
  validation_errors: DeliveryGroupGeneratorValidationError[];
};

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function parseDeliveryGroupGeneratorSummary(raw: unknown): DeliveryGroupGeneratorSummary {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    cohorts_processed: Number(o.cohorts_processed ?? 0),
    cohort_id: String(o.cohort_id ?? ""),
    college_id: String(o.college_id ?? ""),
    student_count: Number(o.student_count ?? 0),
    components_processed: Number(o.components_processed ?? 0),
    groups_created: Number(o.groups_created ?? 0),
    groups_updated: Number(o.groups_updated ?? 0),
    groups_unchanged: Number(o.groups_unchanged ?? 0),
    groups_obsolete: Number(o.groups_obsolete ?? 0),
    skipped_components: asArray<DeliveryGroupGeneratorSkipped>(o.skipped_components),
    warnings: asArray<DeliveryGroupGeneratorWarning>(o.warnings),
    validation_errors: asArray<DeliveryGroupGeneratorValidationError>(o.validation_errors),
  };
}

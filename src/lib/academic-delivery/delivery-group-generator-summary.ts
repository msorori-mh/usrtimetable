import { parseCohortCurriculumSummary, type CohortCurriculumSummary } from "./cohort-curriculum-summary";

/**
 * Phase 9.3 — delivery group generator summary types + pure parser (no Supabase import).
 */

export type DeliveryGroupGeneratorStatus =
  | "SUCCESS"
  | "NO_CHANGES"
  | "VALIDATION_FAILED"
  | "PARTIAL";

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
  status: DeliveryGroupGeneratorStatus;
  curriculum?: CohortCurriculumSummary;
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

/** Derive status when RPC omits it (older fixtures) or for pure harness. */
export function deriveGeneratorStatus(input: {
  validation_errors: unknown[];
  groups_created: number;
  groups_updated: number;
  groups_obsolete: number;
  status?: string | null;
}): DeliveryGroupGeneratorStatus {
  if (
    input.status === "SUCCESS" ||
    input.status === "NO_CHANGES" ||
    input.status === "VALIDATION_FAILED" ||
    input.status === "PARTIAL"
  ) {
    return input.status;
  }
  if ((input.validation_errors?.length ?? 0) > 0) return "VALIDATION_FAILED";
  if (input.groups_created === 0 && input.groups_updated === 0 && input.groups_obsolete === 0) {
    return "NO_CHANGES";
  }
  return "SUCCESS";
}

export function isGeneratorSuccessStatus(status: DeliveryGroupGeneratorStatus): boolean {
  return status === "SUCCESS" || status === "NO_CHANGES";
}

export function parseDeliveryGroupGeneratorSummary(raw: unknown): DeliveryGroupGeneratorSummary {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const validation_errors = asArray<DeliveryGroupGeneratorValidationError>(o.validation_errors);
  if (o.components_processed === 0 && (o.status === "SUCCESS" || o.status === "NO_CHANGES")) {
    throw new Error("COHORT_TIMETABLED_COMPONENTS_EMPTY");
  }
  const groups_created = Number(o.groups_created ?? 0);
  const groups_updated = Number(o.groups_updated ?? 0);
  const groups_obsolete = Number(o.groups_obsolete ?? 0);
  const status = deriveGeneratorStatus({
    validation_errors,
    groups_created,
    groups_updated,
    groups_obsolete,
    status: typeof o.status === "string" ? o.status : null,
  });
  return {
    curriculum: o.curriculum ? parseCohortCurriculumSummary(o.curriculum, String(o.cohort_id)) : undefined,
    status,
    cohorts_processed: Number(o.cohorts_processed ?? 0),
    cohort_id: String(o.cohort_id ?? ""),
    college_id: String(o.college_id ?? ""),
    student_count: Number(o.student_count ?? 0),
    components_processed: Number(o.components_processed ?? 0),
    groups_created,
    groups_updated,
    groups_unchanged: Number(o.groups_unchanged ?? 0),
    groups_obsolete,
    skipped_components: asArray<DeliveryGroupGeneratorSkipped>(o.skipped_components),
    warnings: asArray<DeliveryGroupGeneratorWarning>(o.warnings),
    validation_errors,
  };
}

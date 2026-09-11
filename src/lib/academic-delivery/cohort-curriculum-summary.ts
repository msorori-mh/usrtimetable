export type CohortCurriculumSummary = {
  operation: "generate_cohort_curriculum";
  result: "success";
  cohort_id: string;
  study_plan_id: string;
  study_plan_code?: string;
  semester: number;
  term_type: string;
  inserted_offerings: number;
  skipped_existing: number;
  skipped_summer_only: number;
  skipped_unselected_elective: number;
  required_candidates: number;
  elective_candidates: number;
  warnings: Record<string, unknown>[];
  created_sections: 0;
  created_delivery_groups: 0;
  created_sessions: 0;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("COHORT_CURRICULUM_INVALID_RESPONSE");
  }
  return value as Record<string, unknown>;
}

function count(value: unknown, field: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error(`COHORT_CURRICULUM_INVALID_${field.toUpperCase()}`);
  }
  return Number(value);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCohortCurriculumSummary(
  value: unknown,
  expectedCohortId?: string,
): CohortCurriculumSummary {
  const row = record(value);
  if (row.operation !== "generate_cohort_curriculum" || row.result !== "success") {
    throw new Error("COHORT_CURRICULUM_UNEXPECTED_RESULT");
  }
  if (
    typeof row.cohort_id !== "string" ||
    !UUID.test(row.cohort_id) ||
    typeof row.study_plan_id !== "string" ||
    !UUID.test(row.study_plan_id)
  ) {
    throw new Error("COHORT_CURRICULUM_MISSING_CONTEXT");
  }
  if (expectedCohortId && row.cohort_id !== expectedCohortId) {
    throw new Error("COHORT_CURRICULUM_COHORT_MISMATCH");
  }
  if (row.term_type !== "first" && row.term_type !== "second") {
    throw new Error("COHORT_CURRICULUM_INVALID_TERM_TYPE");
  }
  if (
    row.created_sections !== 0 ||
    row.created_delivery_groups !== 0 ||
    row.created_sessions !== 0
  ) {
    throw new Error("COHORT_CURRICULUM_OPERATIONAL_SIDE_EFFECT_REPORTED");
  }
  if (count(row.inserted_offerings, "inserted_offerings") + count(row.skipped_existing, "skipped_existing") === 0) {
    throw new Error("COHORT_CURRICULUM_EMPTY");
  }
  return {
    operation: "generate_cohort_curriculum",
    result: "success",
    cohort_id: row.cohort_id,
    study_plan_id: row.study_plan_id,
    study_plan_code: typeof row.study_plan_code === "string" ? row.study_plan_code : undefined,
    semester: count(row.semester, "semester"),
    term_type: row.term_type,
    inserted_offerings: count(row.inserted_offerings, "inserted_offerings"),
    skipped_existing: count(row.skipped_existing, "skipped_existing"),
    skipped_summer_only: count(row.skipped_summer_only, "skipped_summer_only"),
    skipped_unselected_elective: count(
      row.skipped_unselected_elective,
      "skipped_unselected_elective",
    ),
    required_candidates: count(row.required_candidates, "required_candidates"),
    elective_candidates: count(row.elective_candidates, "elective_candidates"),
    warnings: Array.isArray(row.warnings) ? row.warnings.map(record) : [],
    created_sections: 0,
    created_delivery_groups: 0,
    created_sessions: 0,
  };
}


import type { SharedLectureLink } from "@/lib/academic-delivery/shared-lectures";

type CohortContext = {
  id: string;
  program_id: string;
  study_system: string;
};

type ProgramContext = {
  id: string;
  name: string | null;
};

type AssignmentRowContext = {
  delivery_group_id: string;
  cohort_id: string;
  program_id: string;
  study_system: string;
};

const STUDY_SYSTEM_LABELS: Record<string, string> = {
  regular: "عام",
  parallel: "موازي",
  both: "عام، موازي",
};

function unique(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value)),
  ];
}

/** Resolves display context from the row's cohort and every linked shared-lecture cohort. */
export function assignmentRowAcademicContext(input: {
  row: AssignmentRowContext;
  cohorts: readonly CohortContext[];
  programs: readonly ProgramContext[];
  sharedLectures: readonly SharedLectureLink[];
}): { programLabel: string; studySystemLabel: string } {
  const cohortById = new Map(input.cohorts.map((cohort) => [cohort.id, cohort]));
  const programById = new Map(input.programs.map((program) => [program.id, program.name]));
  const participatingCohortIds = [
    input.row.cohort_id,
    ...input.sharedLectures
      .filter((link) => link.anchor_group_id === input.row.delivery_group_id)
      .map((link) => link.cohort_id),
  ];
  const participatingCohorts = unique(participatingCohortIds)
    .map((cohortId) => cohortById.get(cohortId))
    .filter((cohort): cohort is CohortContext => !!cohort);

  const programNames = unique([
    ...participatingCohorts.map((cohort) => programById.get(cohort.program_id)),
    programById.get(input.row.program_id),
  ]);
  const systems = unique([
    ...participatingCohorts.map((cohort) => cohort.study_system),
    input.row.study_system,
  ]);

  return {
    programLabel: programNames.join("، ") || "—",
    studySystemLabel:
      systems.length > 1
        ? unique(
            systems.flatMap((system) =>
              system === "both" ? ["عام", "موازي"] : [STUDY_SYSTEM_LABELS[system] ?? system],
            ),
          ).join("، ")
        : (STUDY_SYSTEM_LABELS[systems[0] ?? ""] ?? systems[0] ?? "—"),
  };
}

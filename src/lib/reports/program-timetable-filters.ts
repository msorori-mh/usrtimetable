import { matchesStudySystem, STUDY_SYSTEM_LABELS } from "./filters";
import { sessionTypeLabel } from "./session-mappers";
import type { ReportFilters, ReportStudySystem } from "./types";
import type { PrintSessionLike } from "@/lib/print-center/types";
import {
  buildTimetableLevelOptions,
  type TimetableLevelRow,
  type TimetableProgramRow,
} from "@/lib/schedule-builder/timetable-editor-filters";

export interface ProgramReportSelection {
  departmentId: string;
  programId: string;
  levelValue: string;
  cohortId: string;
  deliveryGroupId: string;
}

export const ALL_PROGRAM_REPORT_FILTERS: ProgramReportSelection = {
  departmentId: "all",
  programId: "all",
  levelValue: "all",
  cohortId: "all",
  deliveryGroupId: "all",
};

export interface ProgramReportScope {
  collegeId: string | null;
  termId: string | null;
  versionId: string | null;
  studySystem: ReportStudySystem;
}

export interface ProgramReportReferences {
  departments: { id: string; name: string }[];
  programs: TimetableProgramRow[];
  levels: TimetableLevelRow[];
  cohorts: {
    id: string;
    code: string | null;
    program_id: string;
    level_id: string;
    term_id: string;
    study_system: string;
    entry_year: number;
  }[];
}

export function changeProgramReportFilter(
  current: ProgramReportSelection,
  field: keyof ProgramReportSelection,
  value: string,
): ProgramReportSelection {
  const order: (keyof ProgramReportSelection)[] = [
    "departmentId",
    "programId",
    "levelValue",
    "cohortId",
    "deliveryGroupId",
  ];
  const next = { ...current, [field]: value };
  for (const child of order.slice(order.indexOf(field) + 1)) next[child] = "all";
  return next;
}

export function reconcileProgramReportScope(
  selection: ProgramReportSelection,
  previous: ProgramReportScope,
  current: ProgramReportScope,
): ProgramReportSelection {
  if (previous.collegeId && previous.collegeId !== current.collegeId)
    return { ...ALL_PROGRAM_REPORT_FILTERS };
  if (
    previous.termId !== current.termId ||
    previous.versionId !== current.versionId ||
    previous.studySystem !== current.studySystem
  ) {
    return { ...selection, cohortId: "all", deliveryGroupId: "all" };
  }
  return selection;
}

/** Every option and result follows the same academic hierarchy; labels never act as IDs. */
export function deriveProgramTimetable<T extends PrintSessionLike>(input: {
  references: ProgramReportReferences;
  sessions: T[];
  selection: ProgramReportSelection;
  scope: ProgramReportScope;
  deliveryGroupLabels: ReadonlyMap<string, string>;
}) {
  const { references: refs, scope } = input;
  const selected = { ...input.selection };
  const keep = (id: string, ids: string[]) => (id === "all" || ids.includes(id) ? id : "all");
  selected.departmentId = keep(
    selected.departmentId,
    refs.departments.map((d) => d.id),
  );
  const programs = refs.programs.filter(
    (p) => selected.departmentId === "all" || p.department_id === selected.departmentId,
  );
  selected.programId = keep(
    selected.programId,
    programs.map((p) => p.id),
  );
  const programIds = new Set(
    programs
      .filter((p) => selected.programId === "all" || p.id === selected.programId)
      .map((p) => p.id),
  );
  const levels = buildTimetableLevelOptions({
    levels: refs.levels,
    programs,
    departmentId: selected.departmentId,
    programId: selected.programId,
  });
  selected.levelValue = keep(
    selected.levelValue,
    levels.map((l) => l.value),
  );
  const levelsById = new Map(refs.levels.map((l) => [l.id, l]));
  const programsById = new Map(programs.map((p) => [p.id, p]));
  const matchesAcademicScope = (programId?: string | null, levelId?: string | null) => {
    if (!programId || !programIds.has(programId)) return false;
    if (selected.levelValue === "all") return true;
    const level = levelId ? levelsById.get(levelId) : undefined;
    return level?.program_id === programId && String(level.level_number) === selected.levelValue;
  };
  const cohorts = refs.cohorts
    .filter(
      (c) =>
        c.term_id === scope.termId &&
        matchesStudySystem(c.study_system, scope.studySystem) &&
        matchesAcademicScope(c.program_id, c.level_id),
    )
    .map((c) => ({
      ...c,
      name: [
        programsById.get(c.program_id)?.name,
        `المستوى ${levelsById.get(c.level_id)?.level_number ?? "—"}`,
        STUDY_SYSTEM_LABELS[c.study_system as ReportStudySystem] ?? c.study_system,
        `دفعة ${c.entry_year}`,
        c.code,
      ]
        .filter(Boolean)
        .join(" — "),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar", { numeric: true }));
  selected.cohortId = keep(
    selected.cohortId,
    cohorts.map((c) => c.id),
  );
  const cohortsById = new Map(
    cohorts
      .filter((c) => selected.cohortId === "all" || c.id === selected.cohortId)
      .map((c) => [c.id, c]),
  );
  const academicSessions = input.sessions.filter(
    (s) =>
      (!s.college_id || s.college_id === scope.collegeId) &&
      matchesStudySystem(s.study_system, scope.studySystem) &&
      matchesAcademicScope(s.course_offerings?.program_id, s.course_offerings?.level_id) &&
      (selected.cohortId === "all" || s.cohort_id === selected.cohortId),
  );
  const groupsById = new Map<string, { id: string; name: string }>();
  for (const s of academicSessions) {
    if (!s.delivery_group_id || !s.cohort_id || !cohortsById.has(s.cohort_id)) continue;
    const course = s.course_offerings?.courses;
    groupsById.set(s.delivery_group_id, {
      id: s.delivery_group_id,
      name: [
        input.deliveryGroupLabels.get(s.delivery_group_id) ?? "مجموعة",
        course?.name,
        course?.code,
        sessionTypeLabel(s.session_type ?? "lecture"),
        selected.cohortId === "all" ? cohortsById.get(s.cohort_id)?.name : null,
      ]
        .filter(Boolean)
        .join(" — "),
    });
  }
  const deliveryGroups = [...groupsById.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "ar", { numeric: true }),
  );
  // Selectable groups include catalogue groups that the version never placed,
  // so an unscheduled group can be inspected instead of silently vanishing.
  selected.deliveryGroupId = keep(selected.deliveryGroupId, [
    ...deliveryGroups.map((g) => g.id),
    ...(input.selectableDeliveryGroupIds ?? []),
  ]);
  const sessions = academicSessions.filter(
    (s) => selected.deliveryGroupId === "all" || s.delivery_group_id === selected.deliveryGroupId,
  );
  return {
    selected,
    programs,
    levels,
    cohorts,
    deliveryGroups,
    sessions,
    /** Scope-filtered sessions BEFORE the delivery-group filter (coverage input). */
    academicSessions,
    /** Cohort ids currently in scope (all cohorts, or the selected one). */
    scopedCohortIds: [...cohortsById.keys()],
  };
}

}

export function programReportSearchParams(
  scope: ProgramReportScope,
  selection: ProgramReportSelection,
): URLSearchParams {
  const params = new URLSearchParams();
  if (scope.termId) params.set("term", scope.termId);
  if (scope.versionId) params.set("version", scope.versionId);
  params.set("study", scope.studySystem);
  for (const [key, value] of Object.entries(selection)) if (value !== "all") params.set(key, value);
  return params;
}

export function parseProgramReportSearch(params: URLSearchParams): {
  context: Partial<ReportFilters>;
  selection: ProgramReportSelection;
} {
  const study = params.get("study");
  const selection = { ...ALL_PROGRAM_REPORT_FILTERS };
  for (const key of Object.keys(selection) as (keyof ProgramReportSelection)[])
    selection[key] = params.get(key) || "all";
  return {
    context: {
      termId: params.get("term"),
      versionId: params.get("version"),
      statusMode: "specific_version",
      studySystem: study === "regular" || study === "parallel" ? study : "all",
    },
    selection,
  };
}

/**
 * Timetable editor filter + sidebar helpers (pure).
 * Level options dedupe by level_number; unscheduled from New Flow work items only.
 */

import type { ScheduleBuilderV2WorkItem } from "@/lib/schedule-builder/v2-assignment-integration";

export const UNSPECIFIED_DEPARTMENT_AR = "قسم غير محدد";

export type TimetableLevelRow = {
  id: string;
  name: string;
  program_id: string;
  level_number: number;
};

export type TimetableProgramRow = {
  id: string;
  name: string;
  department_id: string | null;
};

export type TimetableDepartmentRow = {
  id: string;
  name: string | null;
};

export type TimetableLevelOption = {
  /** Stable filter key: level_number as string (not academic_level_id, not display text). */
  value: string;
  label: string;
  levelNumber: number;
};

export type TimetableSidebarItem = {
  key: string;
  teaching_assignment_id: string;
  course_offering_id: string;
  program_id: string | null;
  level_id: string | null;
  level_number: number | null;
  study_system: string | null;
  instructor_id: string;
  instructor_name: string;
  course_code: string;
  course_name: string;
  expected_students: number;
  department_id: string | null;
  department_label: string;
  program_label: string;
  level_label: string;
  is_legacy: false;
};

export function levelOptionLabel(levelNumber: number): string {
  return `المستوى ${levelNumber}`;
}

/**
 * Build unique level filter options for the timetable editor.
 * Dedupes by level_number (not display text), scoped by department/program.
 * Study system must not create duplicates (levels have no study_system identity).
 */
export function buildTimetableLevelOptions(input: {
  levels: TimetableLevelRow[];
  programs: TimetableProgramRow[];
  departmentId?: string;
  programId?: string;
}): TimetableLevelOption[] {
  const deptId = input.departmentId && input.departmentId !== "all" ? input.departmentId : null;
  const progId = input.programId && input.programId !== "all" ? input.programId : null;

  const programIdsInDept = deptId
    ? new Set(input.programs.filter((p) => p.department_id === deptId).map((p) => p.id))
    : null;

  const byNumber = new Map<number, TimetableLevelOption>();
  for (const level of input.levels) {
    if (progId && level.program_id !== progId) continue;
    if (programIdsInDept && !programIdsInDept.has(level.program_id)) continue;
    if (!Number.isFinite(level.level_number)) continue;
    if (byNumber.has(level.level_number)) continue;
    byNumber.set(level.level_number, {
      value: String(level.level_number),
      label: levelOptionLabel(level.level_number),
      levelNumber: level.level_number,
    });
  }

  return [...byNumber.values()].sort((a, b) => a.levelNumber - b.levelNumber);
}

/** Keep current level filter if still present after options rebuild; else reset to all. */
export function preserveTimetableLevelFilter(
  current: string,
  options: TimetableLevelOption[],
): string {
  if (current === "all") return "all";
  if (options.some((o) => o.value === current)) return current;
  return "all";
}

export function sessionMatchesTimetableLevelFilter(input: {
  filterValue: string;
  levelId: string | null | undefined;
  levels: TimetableLevelRow[];
}): boolean {
  if (input.filterValue === "all") return true;
  const wanted = Number(input.filterValue);
  if (!Number.isFinite(wanted)) return false;
  if (!input.levelId) return false;
  const row = input.levels.find((l) => l.id === input.levelId);
  return (row?.level_number ?? null) === wanted;
}

export function isNewFlowWorkItemUnscheduled(item: {
  remaining_schedule_hours: number;
  scheduling_status: string;
}): boolean {
  if (item.scheduling_status === "scheduled" || item.scheduling_status === "over_scheduled") {
    return false;
  }
  return (
    item.remaining_schedule_hours > 0.01 ||
    item.scheduling_status === "unscheduled" ||
    item.scheduling_status === "partially_scheduled"
  );
}

export function resolveDepartmentLabel(input: {
  departmentId: string | null | undefined;
  departments: TimetableDepartmentRow[];
  context?: Record<string, unknown>;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}): string {
  const log =
    input.log ??
    ((message: string, meta?: Record<string, unknown>) => {
      console.warn(message, meta ?? {});
    });

  if (!input.departmentId) {
    log("timetable_sidebar_missing_department_id", input.context);
    return UNSPECIFIED_DEPARTMENT_AR;
  }
  const dept = input.departments.find((d) => d.id === input.departmentId);
  const name = (dept?.name ?? "").trim();
  if (!dept || !name || name === "-" || name === "—") {
    log("timetable_sidebar_invalid_department_name", {
      ...input.context,
      departmentId: input.departmentId,
      rawName: dept?.name ?? null,
    });
    return UNSPECIFIED_DEPARTMENT_AR;
  }
  return name;
}

export function filterUnscheduledNewFlowWorkItems(input: {
  rows: ScheduleBuilderV2WorkItem[];
  programs: TimetableProgramRow[];
  levels: TimetableLevelRow[];
  departments: TimetableDepartmentRow[];
  filters: {
    departmentId?: string;
    programId?: string;
    levelValue?: string;
    studySystem?: string;
    instructorId?: string;
  };
  log?: (message: string, meta?: Record<string, unknown>) => void;
}): TimetableSidebarItem[] {
  const f = input.filters;
  const deptId = f.departmentId && f.departmentId !== "all" ? f.departmentId : null;
  const progId = f.programId && f.programId !== "all" ? f.programId : null;
  const levelValue = f.levelValue && f.levelValue !== "all" ? f.levelValue : null;
  const study = f.studySystem && f.studySystem !== "all" ? f.studySystem : null;
  const instrId = f.instructorId && f.instructorId !== "all" ? f.instructorId : null;

  const out: TimetableSidebarItem[] = [];
  for (const row of input.rows) {
    // New Flow RPC only — never include Legacy rows.
    if (!isNewFlowWorkItemUnscheduled(row)) continue;
    if (progId && row.program_id !== progId) continue;
    if (study && row.study_system !== study) continue;
    if (instrId && row.instructor_id !== instrId) continue;

    const program = row.program_id
      ? input.programs.find((p) => p.id === row.program_id)
      : undefined;
    const departmentId = program?.department_id ?? null;
    if (deptId && departmentId !== deptId) continue;

    const level = row.level_id ? input.levels.find((l) => l.id === row.level_id) : undefined;
    if (levelValue) {
      const wanted = Number(levelValue);
      if ((level?.level_number ?? null) !== wanted) continue;
    }

    const department_label = resolveDepartmentLabel({
      departmentId,
      departments: input.departments,
      context: {
        teaching_assignment_id: row.teaching_assignment_id,
        program_id: row.program_id,
        course_offering_id: row.course_offering_id,
      },
      log: input.log,
    });

    out.push({
      key: `${row.teaching_assignment_id}:${row.delivery_group_id}`,
      teaching_assignment_id: row.teaching_assignment_id,
      course_offering_id: row.course_offering_id,
      program_id: row.program_id,
      level_id: row.level_id,
      level_number: level?.level_number ?? null,
      study_system: row.study_system,
      instructor_id: row.instructor_id,
      instructor_name: row.instructor_name || "—",
      course_code: row.course_code || "—",
      course_name: row.course_name || "مقرر غير متاح",
      expected_students: row.expected_students ?? 0,
      department_id: departmentId,
      department_label,
      program_label: program?.name?.trim() || "برنامج غير محدد",
      level_label: level
        ? levelOptionLabel(level.level_number)
        : row.level_id
          ? "مستوى غير محدد"
          : "مستوى غير محدد",
      is_legacy: false,
    });
  }
  return out;
}

export function groupTimetableSidebarItems(items: TimetableSidebarItem[]) {
  const map = new Map<string, Map<string, Map<string, TimetableSidebarItem[]>>>();
  for (const raw of items) {
    const item =
      raw.department_label === "-" || raw.department_label === "—"
        ? { ...raw, department_label: UNSPECIFIED_DEPARTMENT_AR }
        : raw;
    if (!map.has(item.department_label)) map.set(item.department_label, new Map());
    const pm = map.get(item.department_label)!;
    if (!pm.has(item.program_label)) pm.set(item.program_label, new Map());
    const lm = pm.get(item.program_label)!;
    if (!lm.has(item.level_label)) lm.set(item.level_label, []);
    lm.get(item.level_label)!.push(item);
  }
  return map;
}

/** Legacy offering rows must never feed the New Flow unscheduled counter. */
export function isLegacyCourseOffering(offering: { plan_course_id?: string | null }): boolean {
  return offering.plan_course_id == null || offering.plan_course_id === "";
}

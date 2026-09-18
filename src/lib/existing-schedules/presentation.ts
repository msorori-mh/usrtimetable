import type { WorkspaceSessionHydratedRow } from "../schedule-builder/session-hydrate";

export interface IntakeMembership {
  source_id: string;
  cohort_id: string;
  delivery_group_id: string;
  study_plan_id: string;
  program_id: string;
  program_name: string;
  level_id: string;
  level_name: string;
  department_id: string;
  department_name: string;
}
export interface IntakeContext {
  programId?: string | null;
  levelId?: string | null;
  departmentId?: string | null;
  cohortId?: string | null;
  deliveryGroupId?: string | null;
}
export function matchesIntakeMembership(
  m: IntakeMembership,
  f: IntakeContext,
): boolean {
  return (
    (!f.programId || m.program_id === f.programId) &&
    (!f.levelId || m.level_id === f.levelId) &&
    (!f.departmentId || m.department_id === f.departmentId) &&
    (!f.cohortId || m.cohort_id === f.cohortId) &&
    (!f.deliveryGroupId || m.delivery_group_id === f.deliveryGroupId)
  );
}
/** Expand only timetable presentation. Workload and editor retain one physical session. */
export function expandIntakeTimetable(
  rows: WorkspaceSessionHydratedRow[],
  f: IntakeContext = {},
): WorkspaceSessionHydratedRow[] {
  return rows.flatMap((row) => {
    if (!row.intake_memberships?.length) return [row];
    return row.intake_memberships
      .filter((m) => matchesIntakeMembership(m, f))
      .map((m) => ({
        ...row,
        id: `${row.id}:${m.delivery_group_id}`,
        cohort_id: m.cohort_id,
        delivery_group_id: m.delivery_group_id,
        course_offerings: {
          ...row.course_offerings,
          program_id: m.program_id,
          level_id: m.level_id,
          academic_programs: { name: m.program_name },
          academic_levels: {
            ...row.course_offerings?.academic_levels,
            name: m.level_name,
          },
          courses: {
            ...row.course_offerings?.courses,
            department_id: m.department_id,
            departments: { name: m.department_name },
          },
        },
      }));
  });
}
export const PENDING_QUOTA_AR = "الساعات الزائدة بانتظار استكمال بيانات النصاب";
export const PENDING_SPLIT_AR = "توزيع ساعات التدريس المشترك بانتظار الاستكمال";

import { expandIntakeTimetable } from "../existing-schedules/presentation";
import type { WorkspaceSessionHydratedRow } from "../schedule-builder/session-hydrate";

export interface PrintCohortScope {
  id: string;
  program_id: string;
  program_name: string;
  level_id: string;
  level_name: string;
  level_number: number | null;
  department_id: string;
  department_name: string;
  study_system: string;
}
export interface PrintGroupMember {
  delivery_group_id: string | null;
  cohort_id: string | null;
}

/** Student-facing copies only: one physical session per participating cohort/group.
 * Never use these copies to count instructor hours or room occupancy.
 */
export function expandStudentPrintMemberships(
  rows: WorkspaceSessionHydratedRow[],
  members: PrintGroupMember[],
  scopes: PrintCohortScope[],
): WorkspaceSessionHydratedRow[] {
  const scopeMap = new Map(scopes.map((c) => [c.id, c]));
  const cohortsByGroup = new Map<string, Set<string>>();
  for (const member of members) {
    if (!member.delivery_group_id || !member.cohort_id) continue;
    const ids = cohortsByGroup.get(member.delivery_group_id) ?? new Set<string>();
    ids.add(member.cohort_id);
    cohortsByGroup.set(member.delivery_group_id, ids);
  }
  return rows
    .filter((row) => !row.replaced_by_split)
    .flatMap((row) => {
      const copies = new Map<string, WorkspaceSessionHydratedRow>();
      for (const base of expandIntakeTimetable([row])) {
        const groupId = base.delivery_group_id;
        const participants = groupId && cohortsByGroup.get(groupId);
        if (!participants?.size) {
          copies.set(`${base.cohort_id ?? ""}:${groupId ?? ""}`, base);
          continue;
        }
        for (const cohortId of participants) {
          const scope = scopeMap.get(cohortId);
          if (!scope)
            throw new Error("تعذر استكمال بيانات دفعة مشاركة في محاضرة مدموجة؛ أعد تحميل التقرير.");
          const key = `${cohortId}:${groupId}`;
          copies.set(key, {
            ...base,
            id: `${row.id}:${key}`,
            cohort_id: cohortId,
            study_system: scope.study_system,
            course_offerings: {
              ...base.course_offerings,
              program_id: scope.program_id,
              level_id: scope.level_id,
              academic_programs: { name: scope.program_name },
              academic_levels: { name: scope.level_name, level_number: scope.level_number },
              courses: {
                ...base.course_offerings?.courses,
                department_id: scope.department_id,
                departments: { name: scope.department_name },
              },
            },
          });
        }
      }
      return [...copies.values()];
    });
}

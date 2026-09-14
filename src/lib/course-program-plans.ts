export interface ProgramPlanLink {
  id: string;
  course_id: string;
  semester: number;
  study_plans: {
    name: string;
    program_id: string;
    is_active: boolean;
    academic_programs: { name: string } | null;
  } | null;
  academic_levels: { level_number: number } | null;
  plan_course_components: { component_type: string; weekly_contact_hours: number }[];
}

export function coursePrograms(rows: ProgramPlanLink[], courseId: string) {
  return rows.filter((r) => r.course_id === courseId && r.study_plans?.is_active);
}

export function programCount(rows: ProgramPlanLink[]) {
  return new Set(rows.map((r) => r.study_plans?.program_id).filter(Boolean)).size;
}

export function hoursConflict(rows: ProgramPlanLink[]) {
  const signatures = rows
    .filter((r) => r.plan_course_components.length)
    .map((r) => {
      const totals: Record<string, number> = {};
      for (const c of r.plan_course_components)
        totals[c.component_type] = (totals[c.component_type] ?? 0) + c.weekly_contact_hours;
      return JSON.stringify(
        Object.entries(totals)
          .filter(([, hours]) => hours !== 0)
          .sort(([a], [b]) => a.localeCompare(b)),
      );
    });
  return new Set(signatures).size > 1;
}

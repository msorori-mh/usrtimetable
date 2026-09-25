import { supabase } from "@/integrations/supabase/client";
import { readAllReportRows } from "@/lib/reports/read-all";
import { fetchVersionStudentMemberships } from "@/lib/academic-delivery/version-student-memberships";
import type { WorkspaceSessionHydratedRow } from "../schedule-builder/session-hydrate";
import { expandStudentPrintMemberships } from "./student-memberships";

/** RLS-preserving, paginated college snapshot; only student print rows are expanded. */
export async function fetchStudentPrintMemberships(
  rows: WorkspaceSessionHydratedRow[],
  collegeId: string,
  versionId: string,
): Promise<WorkspaceSessionHydratedRow[]> {
  if (!rows.length) return [];
  const [members, cohorts, programs, levels, departments] = await Promise.all([
    fetchVersionStudentMemberships(
      versionId,
      rows.map((row) => row.delivery_group_id).filter((id): id is string => !!id),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("academic_cohorts")
        .select("id,program_id,level_id,study_system")
        .eq("college_id", collegeId)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("academic_programs")
        .select("id,name,department_id")
        .eq("college_id", collegeId)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("academic_levels")
        .select("id,name,level_number")
        .eq("college_id", collegeId)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("departments")
        .select("id,name")
        .eq("college_id", collegeId)
        .order("id")
        .range(from, to),
    ),
  ]);
  const scopes = cohorts.flatMap((c) => {
    const program = programs.find((p) => p.id === c.program_id);
    const level = levels.find((l) => l.id === c.level_id);
    const department = departments.find((d) => d.id === program?.department_id);
    if (!program || !level || !department) return [];
    return [
      {
        ...c,
        program_name: program.name,
        level_name: level.name,
        level_number: level.level_number,
        department_id: department.id,
        department_name: department.name,
      },
    ];
  });
  return expandStudentPrintMemberships(rows, members, scopes);
}

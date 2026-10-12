import { supabase } from "@/integrations/supabase/client";
import { parseCoverage, parseFacultyCategories } from "./teaching-coverage";
import { parseSystemHours, type SystemHoursKind } from "./system-hours";
const client = supabase as unknown as {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};
async function read(name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
export async function fetchTeachingCoverage(collegeId: string, termId: string) {
  return parseCoverage(
    await read("get_teaching_coverage_report", { p_college_id: collegeId, p_term_id: termId }),
    collegeId,
    termId,
  );
}
export async function fetchFacultyCategories(collegeId: string) {
  return parseFacultyCategories(
    await read("get_faculty_reporting_categories", { p_college_id: collegeId }),
    collegeId,
  );
}
export async function fetchSystemHours(collegeId: string, termId: string, kind: SystemHoursKind) {
  return parseSystemHours(
    await read("get_system_hours_report", {
      p_college_id: collegeId,
      p_term_id: termId,
      p_kind: kind,
    }),
    { collegeId, termId, kind },
  );
}

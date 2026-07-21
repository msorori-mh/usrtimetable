import { supabase } from "@/integrations/supabase/client";
import { applyStudySystemFilter, assertSingleVersion } from "@/lib/reports/filters";
import type { ReportStudySystem } from "@/lib/reports/types";

/**
 * Legacy — للعرض التاريخي.
 *
 * Historical reads against the Legacy sections model (schedule_sessions.section_id
 * and the sections(...) embed). Quarantined in this module so that active report
 * surfaces never touch Legacy sources; only Legacy-tagged reports may import
 * from here. Do not add new consumers.
 */
export const LEGACY_TIMETABLE_SESSION_SELECT = `
  id, day_of_week, start_time, end_time, session_type, study_system,
  section_id, instructor_id, room_id,
  course_offerings(
    program_id, level_id,
    courses(name, code, department_id, departments(name)),
    academic_programs(name),
    academic_levels(name, level_number)
  ),
  sections(section_number),
  instructors(full_name),
  rooms(code, name)
` as const;

/** Legacy section timetable — single version, single historical section. */
export async function fetchSectionTimetableSessions(params: {
  collegeId: string;
  versionId: string | null;
  studySystem: ReportStudySystem;
  sectionId: string;
}) {
  assertSingleVersion(params.versionId);

  let q = supabase
    .from("schedule_sessions")
    .select(LEGACY_TIMETABLE_SESSION_SELECT)
    .eq("college_id", params.collegeId)
    .eq("schedule_version_id", params.versionId)
    .eq("section_id", params.sectionId)
    .order("day_of_week")
    .order("start_time");

  q = applyStudySystemFilter(q, params.studySystem);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

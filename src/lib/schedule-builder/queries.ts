/**
 * Read-only Schedule Builder workspace queries.
 * College-scoped; no mutations.
 *
 * Sessions are loaded with flat selects + client-side hydration.
 * PostgREST embeds on schedule_sessions are unavailable (PGRST200):
 * only schedule_version_id has a real FK; rooms/instructors/sections/
 * course_offerings are uuid columns without relationships in the schema cache.
 */
import { supabase } from "@/integrations/supabase/client";
import { applyStudySystemFilter } from "@/lib/reports/filters";
import type { SVStatus } from "@/lib/schedule-versions/lifecycle";
import {
  assembleWorkspaceSessionRows,
  type WorkspaceSessionFlatRow,
  type WorkspaceSessionHydratedRow,
} from "@/lib/schedule-builder/session-hydrate";

export type { WorkspaceSessionFlatRow, WorkspaceSessionHydratedRow };
export { assembleWorkspaceSessionRows } from "@/lib/schedule-builder/session-hydrate";

export type WorkspaceStudySystem = "regular" | "parallel";

export interface WorkspaceTerm {
  id: string;
  name: string;
  code: string | null;
  academic_year: string | null;
  is_active: boolean;
}

export interface WorkspaceVersion {
  id: string;
  name: string;
  status: SVStatus;
  academic_term_id: string;
  updated_at: string;
  created_at: string;
}

export interface WorkspaceSchedulingSettings {
  working_days: number[] | null;
  day_start_time: string | null;
  day_end_time: string | null;
}

export async function fetchWorkspaceTerms(collegeId: string): Promise<WorkspaceTerm[]> {
  const { data, error } = await supabase
    .from("academic_terms")
    .select("id, name, code, academic_year, is_active")
    .eq("college_id", collegeId)
    .order("start_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as WorkspaceTerm[];
}

/** All version statuses for the college + term (read-only list). */
export async function fetchWorkspaceVersions(params: {
  collegeId: string;
  termId: string;
}): Promise<WorkspaceVersion[]> {
  const { data, error } = await supabase
    .from("schedule_versions")
    .select("id, name, status, academic_term_id, updated_at, created_at")
    .eq("college_id", params.collegeId)
    .eq("academic_term_id", params.termId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as WorkspaceVersion[];
}

/** Flat session columns only — no PostgREST embeds (avoids PGRST200). */
export const WORKSPACE_SESSION_FLAT_SELECT = `
  id, day_of_week, start_time, end_time, session_type, study_system,
  section_id, section_subgroup_id, instructor_id, room_id, updated_at, is_locked,
  replaced_by_split, expected_students, course_offering_id
` as const;

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

async function fetchRowsByIds<T extends { id: string }>(
  table:
    | "course_offerings"
    | "courses"
    | "departments"
    | "academic_programs"
    | "academic_levels"
    | "sections"
    | "section_subgroups"
    | "instructors"
    | "rooms",
  ids: string[],
  select: string,
): Promise<T[]> {
  if (ids.length === 0) return [];
  const out: T[] = [];
  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase.from(table).select(select).in("id", chunk);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as T[]));
  }
  return out;
}

async function hydrateWorkspaceSessions(
  flat: WorkspaceSessionFlatRow[],
): Promise<WorkspaceSessionHydratedRow[]> {
  const offeringIds = uniqueIds(flat.map((s) => s.course_offering_id));
  const sectionIds = uniqueIds(flat.map((s) => s.section_id));
  const subgroupIds = uniqueIds(flat.map((s) => s.section_subgroup_id));
  const instructorIds = uniqueIds(flat.map((s) => s.instructor_id));
  const roomIds = uniqueIds(flat.map((s) => s.room_id));

  const offerings = await fetchRowsByIds<{
    id: string;
    program_id: string | null;
    level_id: string | null;
    course_id: string;
    expected_students: number | null;
    enrollment_count_status: string | null;
  }>(
    "course_offerings",
    offeringIds,
    "id, program_id, level_id, course_id, expected_students, enrollment_count_status",
  );

  const courseIds = uniqueIds(offerings.map((o) => o.course_id));
  const programIds = uniqueIds(offerings.map((o) => o.program_id));
  const levelIds = uniqueIds(offerings.map((o) => o.level_id));

  const [courses, programs, levels, sections, subgroups, instructors, rooms] = await Promise.all([
    fetchRowsByIds<{
      id: string;
      name: string | null;
      code: string | null;
      department_id: string | null;
    }>("courses", courseIds, "id, name, code, department_id"),
    fetchRowsByIds<{ id: string; name: string | null }>(
      "academic_programs",
      programIds,
      "id, name",
    ),
    fetchRowsByIds<{ id: string; name: string | null; level_number: number | null }>(
      "academic_levels",
      levelIds,
      "id, name, level_number",
    ),
    fetchRowsByIds<{ id: string; section_number: string | number | null }>(
      "sections",
      sectionIds,
      "id, section_number",
    ),
    fetchRowsByIds<{
      id: string;
      subgroup_code: string | null;
      ordinal: number | null;
      expected_students: number | null;
    }>("section_subgroups", subgroupIds, "id, subgroup_code, ordinal, expected_students"),
    fetchRowsByIds<{ id: string; full_name: string | null }>(
      "instructors",
      instructorIds,
      "id, full_name",
    ),
    fetchRowsByIds<{ id: string; code: string | null; name: string | null }>(
      "rooms",
      roomIds,
      "id, code, name",
    ),
  ]);

  const departmentIds = uniqueIds(courses.map((c) => c.department_id));
  const departments = await fetchRowsByIds<{ id: string; name: string | null }>(
    "departments",
    departmentIds,
    "id, name",
  );

  const toMap = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));

  return assembleWorkspaceSessionRows(flat, {
    offerings: toMap(offerings),
    courses: toMap(courses),
    departments: toMap(departments),
    programs: toMap(programs),
    levels: toMap(levels),
    sections: toMap(sections),
    subgroups: toMap(subgroups),
    instructors: toMap(instructors),
    rooms: toMap(rooms),
  });
}

export async function fetchWorkspaceSessions(params: {
  collegeId: string;
  versionId: string;
  studySystem: WorkspaceStudySystem;
}): Promise<WorkspaceSessionHydratedRow[]> {
  let q = supabase
    .from("schedule_sessions")
    .select(WORKSPACE_SESSION_FLAT_SELECT)
    .eq("college_id", params.collegeId)
    .eq("schedule_version_id", params.versionId)
    .eq("replaced_by_split", false)
    .order("day_of_week")
    .order("start_time");

  q = applyStudySystemFilter(q, params.studySystem);

  const { data, error } = await q;
  if (error) throw error;
  const flat = (data ?? []) as WorkspaceSessionFlatRow[];
  return hydrateWorkspaceSessions(flat);
}

export interface WorkspaceRoomOption {
  id: string;
  code: string;
  name: string | null;
  /** Live inventory fields — never hardcode hall/lab counts in UI. */
  room_type?: string | null;
  capacity?: number | null;
}

/** College-scoped active rooms for local edit UI (read-only list). */
export async function fetchWorkspaceRooms(collegeId: string): Promise<WorkspaceRoomOption[]> {
  const { data, error } = await supabase
    .from("rooms")
    .select("id, code, name, is_active, room_type, capacity")
    .eq("college_id", collegeId)
    .eq("is_active", true)
    .order("code");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    code: String(r.code ?? ""),
    name: (r.name as string | null) ?? null,
    room_type: (r.room_type as string | null) ?? null,
    capacity: typeof r.capacity === "number" ? r.capacity : Number(r.capacity ?? 0),
  }));
}

export async function fetchWorkspaceSchedulingSettings(
  collegeId: string,
): Promise<WorkspaceSchedulingSettings | null> {
  const { data, error } = await supabase
    .from("scheduling_settings")
    .select("working_days, day_start_time, day_end_time")
    .eq("college_id", collegeId)
    .maybeSingle();
  if (error) throw error;
  return data as WorkspaceSchedulingSettings | null;
}

export interface WorkspaceTimeTemplate {
  start_time: string;
  end_time: string;
  day_of_week: number;
  study_system: string;
}

export async function fetchWorkspaceTimeTemplates(
  collegeId: string,
): Promise<WorkspaceTimeTemplate[]> {
  const { data, error } = await supabase
    .from("time_slot_templates")
    .select("start_time, end_time, day_of_week, study_system")
    .eq("college_id", collegeId)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []) as WorkspaceTimeTemplate[];
}

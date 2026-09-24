import { attachIntakePresentation } from "../existing-schedules/report-data";
import { fetchSharedLectures } from "@/lib/academic-delivery/shared-lectures";
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
  attachCohortTermHeadcounts,
  type WorkspaceCohortTermHeadcountRow,
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
  replaced_by_split, expected_students, course_offering_id,
  cohort_id, delivery_group_id, source_type, teaching_assignment_id, section_group_id
` as const;

/**
 * Report / editor flat select — same PGRST200-safe columns as workspace,
 * plus schedule_version_id for conflict evidence rows.
 */
export const TIMETABLE_SESSION_FLAT_SELECT = `
  id, schedule_version_id, day_of_week, start_time, end_time, session_type, study_system,
  section_id, section_subgroup_id, instructor_id, room_id, updated_at, is_locked,
  replaced_by_split, expected_students, course_offering_id,
  cohort_id, delivery_group_id, source_type, teaching_assignment_id, section_group_id
` as const;

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

async function fetchRowsByIds<T extends { id: string }>(
  table:
    | "academic_cohorts"
    | "course_offerings"
    | "courses"
    | "departments"
    | "academic_programs"
    | "academic_levels"
    | "sections"
    | "section_subgroups"
    | "instructors"
    | "rooms"
    | "delivery_groups",
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

/** Two-phase hydration: flat sessions + batched lookups (no nested courses embed). */
export async function hydrateWorkspaceSessions(
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
    enrollment_count_updated_at: string | null;
  }>(
    "course_offerings",
    offeringIds,
    "id, program_id, level_id, course_id, expected_students, enrollment_count_status, enrollment_count_updated_at",
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
    fetchRowsByIds<{
      id: string;
      name: string | null;
      level_number: number | null;
    }>("academic_levels", levelIds, "id, name, level_number"),
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

  const collegeIds = [
    ...new Set(
      offerings
        .map((o) => (o as { college_id?: string }).college_id)
        .filter((v): v is string => !!v),
    ),
  ];
  const sessionGroups = uniqueIds(flat.map((s) => s.delivery_group_id));
  const groupScopes = await fetchRowsByIds<{ id: string; college_id: string }>(
    "delivery_groups",
    sessionGroups,
    "id,college_id",
  );
  for (const g of groupScopes)
    if (!collegeIds.includes(g.college_id)) collegeIds.push(g.college_id);
  const shared = (await Promise.all(collegeIds.map(fetchSharedLectures))).flat();
  const enriched = flat.map((s) => ({
    ...s,
    shared_cohort_ids: [
      ...new Set([
        ...(s.cohort_id ? [s.cohort_id] : []),
        ...shared.filter((l) => l.anchor_group_id === s.delivery_group_id).map((l) => l.cohort_id),
      ]),
    ],
  }));
  const cohorts = await fetchRowsByIds<{ id: string; program_id: string; level_id: string | null }>(
    "academic_cohorts",
    uniqueIds(enriched.flatMap((s) => s.shared_cohort_ids)),
    "id,program_id,level_id",
  );
  const [memberPrograms, memberLevels] = await Promise.all([
    fetchRowsByIds<{ id: string; name: string | null }>(
      "academic_programs",
      uniqueIds(cohorts.map((c) => c.program_id)),
      "id,name",
    ),
    fetchRowsByIds<{ id: string; name: string | null }>(
      "academic_levels",
      uniqueIds(cohorts.map((c) => c.level_id)),
      "id,name",
    ),
  ]);
  const cohortMap = toMap(cohorts),
    memberProgramMap = toMap(memberPrograms),
    memberLevelMap = toMap(memberLevels);
  const academicScopes = new Map(
    enriched.map((s) => [
      s.id,
      s.shared_cohort_ids.flatMap((id) => {
        const c = cohortMap.get(id);
        return c
          ? [
              {
                program_id: c.program_id,
                level_id: c.level_id,
                program_name: memberProgramMap.get(c.program_id)?.name ?? "—",
                level_name: memberLevelMap.get(c.level_id ?? "")?.name ?? "—",
              },
            ]
          : [];
      }),
    ]),
  );
  const hydrated = assembleWorkspaceSessionRows(enriched, {
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
  return attachIntakePresentation(
    hydrated.map((s) => ({ ...s, academic_memberships: academicScopes.get(s.id) ?? [] })),
  );
}

export async function fetchWorkspaceSessions(params: {
  collegeId: string;
  termId: string;
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
  const hydrated = await hydrateWorkspaceSessions(flat);
  const cohortIds = uniqueIds(hydrated.flatMap((s) => s.shared_cohort_ids ?? [s.cohort_id]));
  const cohortTermHeadcounts = await fetchWorkspaceCohortTermHeadcounts({
    collegeId: params.collegeId,
    termId: params.termId,
    cohortIds,
  });
  return attachCohortTermHeadcounts(hydrated, cohortTermHeadcounts);
}

/** College + term + cohort scoped read; RLS remains the final authorization boundary. */
async function fetchWorkspaceCohortTermHeadcounts(params: {
  collegeId: string;
  termId: string;
  cohortIds: string[];
}): Promise<WorkspaceCohortTermHeadcountRow[]> {
  if (params.cohortIds.length === 0) return [];
  const out: WorkspaceCohortTermHeadcountRow[] = [];
  const chunkSize = 100;
  for (let i = 0; i < params.cohortIds.length; i += chunkSize) {
    const cohortIds = params.cohortIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("scheduling_cohort_term_headcounts")
      .select("cohort_id, scheduling_headcount, approval_status, updated_at")
      .eq("college_id", params.collegeId)
      .eq("term_id", params.termId)
      .in("cohort_id", cohortIds);
    if (error) throw error;
    out.push(...((data ?? []) as WorkspaceCohortTermHeadcountRow[]));
  }
  return out;
}

/**
 * Timetable editor / reports: all study systems for one version (flat + hydrate).
 * Does not filter replaced_by_split so editors see the full version set.
 */
export async function fetchHydratedVersionSessions(params: {
  collegeId: string;
  versionId: string;
  studySystem?: "regular" | "parallel" | "all";
}): Promise<WorkspaceSessionHydratedRow[]> {
  let q = supabase
    .from("schedule_sessions")
    .select(TIMETABLE_SESSION_FLAT_SELECT)
    .eq("college_id", params.collegeId)
    .eq("schedule_version_id", params.versionId)
    .order("day_of_week")
    .order("start_time");

  if (params.studySystem && params.studySystem !== "all") {
    q = applyStudySystemFilter(q, params.studySystem);
  }

  const { data, error } = await q;
  if (error) throw error;
  return hydrateWorkspaceSessions((data ?? []) as WorkspaceSessionFlatRow[]);
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

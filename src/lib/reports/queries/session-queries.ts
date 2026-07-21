import { supabase } from "@/integrations/supabase/client";
import { applyStudySystemFilter, assertSingleVersion } from "@/lib/reports/filters";
import type { ReportStudySystem } from "@/lib/reports/types";

/**
 * Shared New Flow select for timetable-style reports (single version).
 * A1.5: New Flow reports never join Legacy `sections`; session identity is
 * cohort/delivery-group based. Cohort/DG labels are resolved separately via
 * fetchCohortDeliveryGroupLabels (no fragile embeds, same pattern as the
 * conflict read model).
 */
export const TIMETABLE_SESSION_SELECT = `
  id, day_of_week, start_time, end_time, session_type, study_system,
  cohort_id, delivery_group_id, instructor_id, room_id,
  course_offerings(
    program_id, level_id,
    courses(name, code, department_id, departments(name)),
    academic_programs(name),
    academic_levels(name, level_number)
  ),
  instructors(full_name),
  rooms(code, name)
` as const;

/**
 * Legacy historical select (A1.5) — retained EXCLUSIVELY for the Legacy
 * section timetable report. Historical data stays readable and unchanged;
 * do not use for New Flow surfaces.
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

export const INSTRUCTOR_SCHEDULE_SESSION_SELECT = TIMETABLE_SESSION_SELECT;

export interface FetchVersionSessionsParams {
  collegeId: string;
  versionId: string | null;
  studySystem: ReportStudySystem;
  select?: string;
  instructorId?: string;
  sectionId?: string;
  cohortId?: string;
  deliveryGroupId?: string;
  roomId?: string;
}

/**
 * Fetch sessions for exactly one schedule version.
 * Never aggregates across multiple versions — prevents double-counting.
 */
export async function fetchSessionsForVersion<T = Record<string, unknown>>(
  params: FetchVersionSessionsParams,
): Promise<T[]> {
  assertSingleVersion(params.versionId);

  let q = supabase
    .from("schedule_sessions")
    .select(params.select ?? "id, day_of_week, start_time, end_time, study_system")
    .eq("college_id", params.collegeId)
    .eq("schedule_version_id", params.versionId)
    .order("day_of_week")
    .order("start_time");

  q = applyStudySystemFilter(q, params.studySystem);

  if (params.instructorId) q = q.eq("instructor_id", params.instructorId);
  if (params.sectionId) q = q.eq("section_id", params.sectionId);
  if (params.cohortId) q = q.eq("cohort_id", params.cohortId);
  if (params.deliveryGroupId) q = q.eq("delivery_group_id", params.deliveryGroupId);
  if (params.roomId) q = q.eq("room_id", params.roomId);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as T[];
}

export interface TimetableSessionsBaseParams {
  collegeId: string;
  versionId: string | null;
  studySystem: ReportStudySystem;
}

/** Instructor weekly schedule — single version, single instructor. */
export async function fetchInstructorScheduleSessions(
  params: TimetableSessionsBaseParams & { instructorId: string },
) {
  return fetchSessionsForVersion({
    collegeId: params.collegeId,
    versionId: params.versionId,
    studySystem: params.studySystem,
    select: TIMETABLE_SESSION_SELECT,
    instructorId: params.instructorId,
  });
}

/**
 * Legacy section timetable — single version, single Legacy section.
 * A1.5: historical-only surface; reads the preserved Legacy projection
 * (sections join) and is never used by New Flow reports.
 */
export async function fetchSectionTimetableSessions(
  params: TimetableSessionsBaseParams & { sectionId: string },
) {
  return fetchSessionsForVersion({
    collegeId: params.collegeId,
    versionId: params.versionId,
    studySystem: params.studySystem,
    select: LEGACY_TIMETABLE_SESSION_SELECT,
    sectionId: params.sectionId,
  });
}

/** Room timetable — single version, single room. */
export async function fetchRoomTimetableSessions(
  params: TimetableSessionsBaseParams & { roomId: string },
) {
  return fetchSessionsForVersion({
    collegeId: params.collegeId,
    versionId: params.versionId,
    studySystem: params.studySystem,
    select: TIMETABLE_SESSION_SELECT,
    roomId: params.roomId,
  });
}

export interface ProgramLevelFilterParams {
  departmentId?: string | null;
  programId?: string | null;
  levelId?: string | null;
  cohortId?: string | null;
  deliveryGroupId?: string | null;
}

/**
 * Program/Level timetable — single version; optional dept/program/level/cohort/
 * delivery-group filters. Department filter applied client-side (PostgREST
 * nested eq limitation). A1.5: cohort/DG filters replace the Legacy section filter.
 */
export async function fetchProgramLevelTimetableSessions(
  params: TimetableSessionsBaseParams & ProgramLevelFilterParams,
) {
  assertSingleVersion(params.versionId);

  let q = supabase
    .from("schedule_sessions")
    .select(TIMETABLE_SESSION_SELECT)
    .eq("college_id", params.collegeId)
    .eq("schedule_version_id", params.versionId)
    .order("day_of_week")
    .order("start_time");

  q = applyStudySystemFilter(q, params.studySystem);

  if (params.programId) q = q.eq("course_offerings.program_id", params.programId);
  if (params.levelId) q = q.eq("course_offerings.level_id", params.levelId);
  if (params.cohortId) q = q.eq("cohort_id", params.cohortId);
  if (params.deliveryGroupId) q = q.eq("delivery_group_id", params.deliveryGroupId);

  const { data, error } = await q;
  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows = (data ?? []) as any[];
  if (params.departmentId) {
    rows = rows.filter(
      (s) => s.course_offerings?.courses?.department_id === params.departmentId,
    );
  }
  return rows;
}

/** Analytics: all sessions for one version — instructor workload (single version only). */
export const INSTRUCTOR_WORKLOAD_SESSION_SELECT =
  "instructor_id, start_time, end_time, course_offering_id, source_type, study_system" as const;

export interface InstructorWorkloadSession {
  instructor_id: string;
  start_time: string;
  end_time: string;
  course_offering_id: string;
  source_type: string | null;
  study_system?: string;
}

export async function fetchInstructorWorkloadSessions(
  params: TimetableSessionsBaseParams,
): Promise<InstructorWorkloadSession[]> {
  return fetchSessionsForVersion<InstructorWorkloadSession>({
    collegeId: params.collegeId,
    versionId: params.versionId,
    studySystem: params.studySystem,
    select: INSTRUCTOR_WORKLOAD_SESSION_SELECT,
  });
}

/** Analytics: all room-assigned sessions for one version — room utilization (single version only). */
export const ROOM_UTILIZATION_SESSION_SELECT =
  "room_id, start_time, end_time, study_system" as const;

export interface RoomUtilizationSession {
  room_id: string;
  start_time: string;
  end_time: string;
  study_system?: string;
}

export async function fetchRoomUtilizationSessions(
  params: TimetableSessionsBaseParams,
): Promise<RoomUtilizationSession[]> {
  assertSingleVersion(params.versionId);

  let q = supabase
    .from("schedule_sessions")
    .select(ROOM_UTILIZATION_SESSION_SELECT)
    .eq("college_id", params.collegeId)
    .eq("schedule_version_id", params.versionId)
    .not("room_id", "is", null);

  q = applyStudySystemFilter(q, params.studySystem);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as RoomUtilizationSession[];
}

/**
 * Official published timetable — single published version only.
 * A1.5: New Flow projection is cohort/DG based; no Legacy sections join.
 */
export const PUBLISHED_TIMETABLE_SELECT = `
  id, day_of_week, start_time, end_time, session_type, study_system,
  cohort_id, delivery_group_id,
  course_offerings!inner(program_id, level_id, courses!inner(name, code, department_id, departments(name)), academic_programs(name), academic_levels(name)),
  instructors(id, full_name), rooms(id, code, name),
  schedule_versions!inner(name)
` as const;

export async function fetchPublishedTimetableSessions(params: {
  collegeId: string;
  versionId: string | null;
  studySystem: ReportStudySystem;
  programId?: string | null;
  levelId?: string | null;
  cohortId?: string | null;
  deliveryGroupId?: string | null;
  instructorId?: string | null;
  roomId?: string | null;
  departmentId?: string | null;
}) {
  assertSingleVersion(params.versionId);

  let q = supabase
    .from("schedule_sessions")
    .select(PUBLISHED_TIMETABLE_SELECT)
    .eq("college_id", params.collegeId)
    .eq("schedule_version_id", params.versionId)
    .order("day_of_week")
    .order("start_time");

  q = applyStudySystemFilter(q, params.studySystem);
  if (params.programId) q = q.eq("course_offerings.program_id", params.programId);
  if (params.levelId) q = q.eq("course_offerings.level_id", params.levelId);
  if (params.cohortId) q = q.eq("cohort_id", params.cohortId);
  if (params.deliveryGroupId) q = q.eq("delivery_group_id", params.deliveryGroupId);
  if (params.instructorId) q = q.eq("instructor_id", params.instructorId);
  if (params.roomId) q = q.eq("room_id", params.roomId);

  const { data, error } = await q;
  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rows = (data ?? []) as any[];
  if (params.departmentId) {
    rows = rows.filter(
      (s) => s.course_offerings?.courses?.department_id === params.departmentId,
    );
  }
  return rows;
}

/** Resolved New Flow identity labels for timetable report rows. */
export interface CohortDeliveryGroupLabels {
  cohorts: Map<string, string>;
  deliveryGroups: Map<string, string>;
}

/**
 * Resolve cohort/delivery-group display labels for raw timetable sessions.
 * Two batched, tenant-scoped SELECTs keyed by the session FK ids — no
 * PostgREST embeds (mirrors the conflict read model evidence lookup) and
 * therefore safe while Phase 9.x FK/column rollout completes.
 */
export async function fetchCohortDeliveryGroupLabels(
  collegeId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawSessions: any[],
): Promise<CohortDeliveryGroupLabels> {
  const cohortIds = [
    ...new Set(
      rawSessions.map((s) => s?.cohort_id as string | null).filter((v): v is string => !!v),
    ),
  ];
  const deliveryGroupIds = [
    ...new Set(
      rawSessions
        .map((s) => s?.delivery_group_id as string | null)
        .filter((v): v is string => !!v),
    ),
  ];

  const [cohortsRes, deliveryGroupsRes] = await Promise.all([
    cohortIds.length
      ? supabase
          .from("academic_cohorts")
          .select("id, code")
          .eq("college_id", collegeId)
          .in("id", cohortIds)
      : Promise.resolve({ data: [], error: null }),
    deliveryGroupIds.length
      ? supabase
          .from("delivery_groups")
          .select("id, group_code")
          .eq("college_id", collegeId)
          .in("id", deliveryGroupIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (cohortsRes.error) throw cohortsRes.error;
  if (deliveryGroupsRes.error) throw deliveryGroupsRes.error;

  return {
    cohorts: new Map(
      ((cohortsRes.data ?? []) as { id: string; code: string }[]).map((c) => [c.id, c.code]),
    ),
    deliveryGroups: new Map(
      ((deliveryGroupsRes.data ?? []) as { id: string; group_code: string }[]).map((d) => [
        d.id,
        d.group_code,
      ]),
    ),
  };
}

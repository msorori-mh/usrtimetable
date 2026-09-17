import {
  fetchSharedLectures,
  sharedGroupIdsForCohort,
} from "@/lib/academic-delivery/shared-lectures";
import { readAllReportRows } from "@/lib/reports/read-all";
import { supabase } from "@/integrations/supabase/client";
import { applyStudySystemFilter, assertSingleVersion } from "@/lib/reports/filters";
import type { ReportStudySystem } from "@/lib/reports/types";
import {
  hydrateWorkspaceSessions,
  TIMETABLE_SESSION_FLAT_SELECT,
  type WorkspaceSessionFlatRow,
  type WorkspaceSessionHydratedRow,
} from "@/lib/schedule-builder/queries";

/**
 * Shared New Flow select for timetable-style reports (single version).
 * A1.5: New Flow reports never join Legacy `sections`; session identity is
 * cohort/delivery-group based. Cohort/DG labels are resolved separately via
 * fetchCohortDeliveryGroupLabels (no fragile embeds, same pattern as the
 * conflict read model).
 *
 * PGRST200: never nest `courses(...)` under `course_offerings` — PostgREST
 * schema cache has no course_offerings→courses FK. Course labels hydrate
 * via separate batched `courses` lookups after the flat select.
 */
export const TIMETABLE_SESSION_SELECT = `
  id, schedule_version_id, day_of_week, start_time, end_time, session_type, study_system,
  section_id, section_subgroup_id, instructor_id, room_id, updated_at, is_locked,
  replaced_by_split, expected_students, course_offering_id,
  cohort_id, delivery_group_id, source_type, teaching_assignment_id, section_group_id
` as const;

/**
 * Legacy historical select (A1.5) — retained EXCLUSIVELY for the Legacy
 * section timetable report. Flat columns only (+ section_id); section labels
 * hydrate client-side. No nested courses() embed.
 */
export const LEGACY_TIMETABLE_SESSION_SELECT = `
  id, schedule_version_id, day_of_week, start_time, end_time, session_type, study_system,
  section_id, section_subgroup_id, instructor_id, room_id, updated_at, is_locked,
  replaced_by_split, expected_students, course_offering_id,
  cohort_id, delivery_group_id, source_type, teaching_assignment_id, section_group_id
` as const;

export const INSTRUCTOR_SCHEDULE_SESSION_SELECT = TIMETABLE_SESSION_SELECT;

/** True when a select string would trigger the known PGRST200 courses nest. */
export function selectContainsNestedCoursesEmbed(select: string): boolean {
  return /course_offerings\s*\([^)]*courses\s*\(/i.test(select.replace(/\s+/g, " "));
}

async function fetchFlatThenHydrate(params: {
  collegeId: string;
  versionId: string;
  studySystem: ReportStudySystem;
  instructorId?: string;
  sectionId?: string;
  cohortId?: string;
  deliveryGroupId?: string;
  roomId?: string;
  programId?: string;
  levelId?: string;
}): Promise<WorkspaceSessionHydratedRow[]> {
  assertSingleVersion(params.versionId);

  let q = supabase
    .from("schedule_sessions")
    .select(TIMETABLE_SESSION_FLAT_SELECT)
    .eq("college_id", params.collegeId)
    .eq("schedule_version_id", params.versionId)
    .order("day_of_week")
    .order("start_time");

  q = applyStudySystemFilter(q, params.studySystem);

  if (params.instructorId) q = q.eq("instructor_id", params.instructorId);
  if (params.sectionId) q = q.eq("section_id", params.sectionId);
  if (params.cohortId) {
    const anchors = sharedGroupIdsForCohort(
      await fetchSharedLectures(params.collegeId),
      params.cohortId,
    );
    q = anchors.length
      ? q.or(`cohort_id.eq.${params.cohortId},delivery_group_id.in.(${anchors.join(",")})`)
      : q.eq("cohort_id", params.cohortId);
  }
  if (params.deliveryGroupId) {
    const links = await fetchSharedLectures(params.collegeId);
    const anchor = links.find((l) => l.member_group_id === params.deliveryGroupId)?.anchor_group_id;
    q = q.eq("delivery_group_id", anchor ?? params.deliveryGroupId);
  }
  if (params.roomId) q = q.eq("room_id", params.roomId);

  const data = await readAllReportRows((from, to) => q.order("id").range(from, to));

  let rows = await hydrateWorkspaceSessions((data ?? []) as WorkspaceSessionFlatRow[]);

  if (params.programId) {
    rows = rows.filter((s) => s.course_offerings?.program_id === params.programId);
  }
  if (params.levelId) {
    rows = rows.filter((s) => s.course_offerings?.level_id === params.levelId);
  }
  return rows;
}

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
 * When `select` is omitted or is the timetable flat select, rows are hydrated.
 */
export async function fetchSessionsForVersion<T = Record<string, unknown>>(
  params: FetchVersionSessionsParams,
): Promise<T[]> {
  assertSingleVersion(params.versionId);

  const select = params.select ?? "id, day_of_week, start_time, end_time, study_system";
  if (selectContainsNestedCoursesEmbed(select)) {
    throw new Error("PGRST200_GUARD: nested course_offerings(...courses(...)) is forbidden");
  }

  const isTimetableFlat =
    select === TIMETABLE_SESSION_SELECT ||
    select === TIMETABLE_SESSION_FLAT_SELECT ||
    select === LEGACY_TIMETABLE_SESSION_SELECT;

  if (isTimetableFlat) {
    return (await fetchFlatThenHydrate({
      collegeId: params.collegeId,
      versionId: params.versionId!,
      studySystem: params.studySystem,
      instructorId: params.instructorId,
      sectionId: params.sectionId,
      cohortId: params.cohortId,
      deliveryGroupId: params.deliveryGroupId,
      roomId: params.roomId,
    })) as T[];
  }

  let q = supabase
    .from("schedule_sessions")
    .select(select)
    .eq("college_id", params.collegeId)
    .eq("schedule_version_id", params.versionId)
    .order("day_of_week")
    .order("start_time");

  q = applyStudySystemFilter(q, params.studySystem);

  if (params.instructorId) q = q.eq("instructor_id", params.instructorId);
  if (params.sectionId) q = q.eq("section_id", params.sectionId);
  if (params.cohortId) {
    const anchors = sharedGroupIdsForCohort(
      await fetchSharedLectures(params.collegeId),
      params.cohortId,
    );
    q = anchors.length
      ? q.or(`cohort_id.eq.${params.cohortId},delivery_group_id.in.(${anchors.join(",")})`)
      : q.eq("cohort_id", params.cohortId);
  }
  if (params.deliveryGroupId) {
    const links = await fetchSharedLectures(params.collegeId);
    const anchor = links.find((l) => l.member_group_id === params.deliveryGroupId)?.anchor_group_id;
    q = q.eq("delivery_group_id", anchor ?? params.deliveryGroupId);
  }
  if (params.roomId) q = q.eq("room_id", params.roomId);

  const data = await readAllReportRows((from, to) => q.order("id").range(from, to));
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
 * delivery-group filters. Department filter applied client-side after hydrate.
 * A1.5: cohort/DG filters replace the Legacy section filter.
 */
export async function fetchProgramLevelTimetableSessions(
  params: TimetableSessionsBaseParams & ProgramLevelFilterParams,
) {
  let rows = await fetchFlatThenHydrate({
    collegeId: params.collegeId,
    versionId: params.versionId!,
    studySystem: params.studySystem,
    cohortId: params.cohortId ?? undefined,
    deliveryGroupId: params.deliveryGroupId ?? undefined,
    programId: params.programId ?? undefined,
    levelId: params.levelId ?? undefined,
  });

  if (params.departmentId) {
    rows = rows.filter((s) => s.course_offerings?.courses?.department_id === params.departmentId);
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

  const data = await readAllReportRows((from, to) => q.order("id").range(from, to));
  return (data ?? []) as RoomUtilizationSession[];
}

/**
 * Official published timetable — single published version only.
 * A1.5: New Flow projection is cohort/DG based; no Legacy sections join.
 * Flat select + hydrate (no nested courses embed).
 */
export const PUBLISHED_TIMETABLE_SELECT = `
  id, schedule_version_id, day_of_week, start_time, end_time, session_type, study_system,
  section_id, section_subgroup_id, instructor_id, room_id, updated_at, is_locked,
  replaced_by_split, expected_students, course_offering_id,
  cohort_id, delivery_group_id, source_type, teaching_assignment_id, section_group_id
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
  let rows = await fetchFlatThenHydrate({
    collegeId: params.collegeId,
    versionId: params.versionId!,
    studySystem: params.studySystem,
    cohortId: params.cohortId ?? undefined,
    deliveryGroupId: params.deliveryGroupId ?? undefined,
    instructorId: params.instructorId ?? undefined,
    roomId: params.roomId ?? undefined,
    programId: params.programId ?? undefined,
    levelId: params.levelId ?? undefined,
  });

  if (params.departmentId) {
    rows = rows.filter((s) => s.course_offerings?.courses?.department_id === params.departmentId);
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
      rawSessions.map((s) => s?.delivery_group_id as string | null).filter((v): v is string => !!v),
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


/**
 * Cross-college instructor schedule for institutional read-only reporting.
 * Callers must provide the published/specific version per college; versions are
 * intentionally never inferred across colleges to prevent mixed-version totals.
 */
export interface CrossCollegeInstructorScheduleParams {
  instructorPersonId: string;
  colleges: Array<{ collegeId: string; versionId: string }>;
  studySystem: ReportStudySystem;
}

export interface CrossCollegeInstructorScheduleRow extends WorkspaceSessionHydratedRow {
  college_id: string;
  instructor_record_id: string;
}

export async function fetchInstructorScheduleAcrossColleges(
  params: CrossCollegeInstructorScheduleParams,
): Promise<CrossCollegeInstructorScheduleRow[]> {
  if (!params.instructorPersonId || params.colleges.length === 0) return [];

  const { data: instructorRows, error: instructorError } = await supabase
    .from("instructors")
    .select("id, college_id")
    .eq("university_person_id", params.instructorPersonId)
    .in(
      "college_id",
      params.colleges.map((c) => c.collegeId),
    );

  if (instructorError) throw instructorError;
  const byCollege = new Map(
    (instructorRows ?? []).map((row) => [row.college_id as string, row.id as string]),
  );

  const results = await Promise.all(
    params.colleges.flatMap(({ collegeId, versionId }) => {
      const instructorId = byCollege.get(collegeId);
      if (!instructorId) return [];
      return [
        fetchInstructorScheduleSessions({
          collegeId,
          versionId,
          instructorId,
          studySystem: params.studySystem,
        }).then((rows) =>
          rows.map((row) => ({
            ...row,
            college_id: collegeId,
            instructor_record_id: instructorId,
          })),
        ),
      ];
    }),
  );

  return results.flat();
}
/**
 * Pure helpers for Schedule Builder read-only workspace (filters, stats, display).
 */
import { SESSION_TYPE_LABELS, SESSION_STUDY_SYSTEM_LABELS } from "@/lib/reports/session-mappers";
import { matchesStudySystem } from "@/lib/reports/filters";
import type { GridSession } from "@/components/timetable/timetable-grid";
import type { WorkspaceStudySystem } from "@/lib/schedule-builder/queries";
import {
  normalizeEnrollmentCountStatus,
  showUnverifiedEnrollmentBadge,
  UNVERIFIED_ENROLLMENT_BADGE_AR,
  type EnrollmentCountStatus,
} from "@/lib/schedule-builder/enrollment-trust";
import { entityDisplayName } from "@/lib/entity-display";

export interface AcademicMembership {
  program_id: string | null;
  program_name: string;
  level_id: string | null;
  level_name: string;
}

export interface WorkspaceFilters {
  instructor: string; // "all" | id
  section: string;
  room: string;
  program: string;
  level: string;
  sessionType: string;
}

export const EMPTY_WORKSPACE_FILTERS: WorkspaceFilters = {
  instructor: "all",
  section: "all",
  room: "all",
  program: "all",
  level: "all",
  sessionType: "all",
};

export interface WorkspaceSessionView {
  academic_memberships?: AcademicMembership[];
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  session_type: string;
  study_system: string;
  course_code: string;
  course_name: string;
  instructor_name: string;
  room_label: string;
  section_number: string;
  /** Capacity subgroup code (A–D) when session is a split child. */
  subgroup_code: string | null;
  subgroup_expected_students: number | null;
  enrollment_count_status: EnrollmentCountStatus;
  /** Offering headcount (expected_students store). */
  enrollment_count: number | null;
  enrollment_count_updated_at: string | null;
  course_offering_id: string | null;
  program_name: string;
  level_name: string;
  department_name: string;
  instructor_id: string | null;
  section_id: string | null;
  section_subgroup_id: string | null;
  /** New Flow cohort identity for conflict preview (null when unset). */
  cohort_id: string | null;
  room_id: string | null;
  program_id: string | null;
  level_id: string | null;
  updated_at: string | null;
  is_locked: boolean;
}

/** Loose joined row from TIMETABLE_SESSION_SELECT (nullable relations). */
interface RawWorkspaceSessionRow {
  academic_memberships?: AcademicMembership[];
  intake_memberships?: AcademicMembership[];
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  session_type?: string | null;
  study_system?: string | null;
  instructor_id?: string | null;
  section_id?: string | null;
  cohort_id?: string | null;
  cohort_term_headcount?: {
    cohort_id: string;
    scheduling_headcount: number;
    approval_status: string;
    updated_at: string | null;
  } | null;
  room_id?: string | null;
  updated_at?: string | null;
  is_locked?: boolean | null;
  course_offering_id?: string | null;
  course_offerings?: {
    program_id?: string | null;
    level_id?: string | null;
    expected_students?: number | null;
    enrollment_count_status?: string | null;
    enrollment_count_updated_at?: string | null;
    courses?: {
      name?: string | null;
      code?: string | null;
      departments?: { name?: string | null } | null;
    } | null;
    academic_programs?: { name?: string | null } | null;
    academic_levels?: { name?: string | null } | null;
  } | null;
  sections?: { section_number?: string | number | null } | null;
  section_subgroups?: {
    subgroup_code?: string | null;
    ordinal?: number | null;
    expected_students?: number | null;
  } | null;
  section_subgroup_id?: string | null;
  expected_students?: number | null;
  instructors?: { full_name?: string | null } | null;
  rooms?: { code?: string | null; name?: string | null } | null;
}

/** Normalize raw joined session rows into a stable view model. */
export function mapWorkspaceSessions(raw: unknown[]): WorkspaceSessionView[] {
  return (raw as RawWorkspaceSessionRow[]).map((s) => {
    const offering = s.course_offerings;
    const course = offering?.courses;
    const dept = course?.departments;
    const approvedModernHeadcount =
      s.cohort_id && s.cohort_term_headcount?.approval_status === "approved"
        ? s.cohort_term_headcount
        : null;
    const legacyEnrollmentCount =
      offering?.expected_students != null
        ? Number(offering.expected_students)
        : s.expected_students != null
          ? Number(s.expected_students)
          : null;
    return {
      academic_memberships: s.intake_memberships?.length
        ? s.intake_memberships
        : s.academic_memberships,
      id: s.id,
      day_of_week: s.day_of_week,
      start_time: String(s.start_time),
      end_time: String(s.end_time),
      session_type: String(s.session_type ?? "lecture"),
      study_system: String(s.study_system ?? "regular"),
      course_code: course?.code ?? "—",
      course_name: course?.name ?? "مقرر غير متاح",
      instructor_name: s.instructors?.full_name ?? "—",
      room_label: s.rooms ? entityDisplayName(s.rooms) : "—",
      section_number: s.sections?.section_number != null ? String(s.sections.section_number) : "—",
      subgroup_code: s.section_subgroups?.subgroup_code ?? null,
      subgroup_expected_students:
        s.section_subgroups?.expected_students ?? s.expected_students ?? null,
      enrollment_count_status: s.cohort_id
        ? approvedModernHeadcount
          ? "confirmed"
          : "unverified"
        : normalizeEnrollmentCountStatus(offering?.enrollment_count_status),
      enrollment_count: approvedModernHeadcount
        ? Number(approvedModernHeadcount.scheduling_headcount)
        : legacyEnrollmentCount,
      enrollment_count_updated_at: approvedModernHeadcount
        ? approvedModernHeadcount.updated_at
        : (offering?.enrollment_count_updated_at ?? null),
      course_offering_id: s.course_offering_id ?? null,
      program_name: offering?.academic_programs?.name ?? "—",
      level_name: offering?.academic_levels?.name ?? "—",
      department_name: dept?.name ?? "—",
      instructor_id: s.instructor_id ?? null,
      section_id: s.section_id ?? null,
      section_subgroup_id: s.section_subgroup_id ?? null,
      cohort_id: s.cohort_id ?? null,
      room_id: s.room_id ?? null,
      program_id: offering?.program_id ?? null,
      level_id: offering?.level_id ?? null,
      updated_at: s.updated_at ?? null,
      is_locked: !!s.is_locked,
    };
  });
}

export function filterWorkspaceSessions(
  sessions: WorkspaceSessionView[],
  filters: WorkspaceFilters,
): WorkspaceSessionView[] {
  return sessions.filter((s) => {
    if (filters.instructor !== "all" && s.instructor_id !== filters.instructor) return false;
    if (filters.section !== "all" && s.section_id !== filters.section) return false;
    if (filters.room !== "all" && s.room_id !== filters.room) return false;
    if (
      !workspaceAcademicMembers(s).some(
        (m) =>
          (filters.program === "all" || m.program_id === filters.program) &&
          (filters.level === "all" || m.level_id === filters.level),
      )
    )
      return false;
    if (filters.sessionType !== "all" && s.session_type !== filters.sessionType) return false;
    return true;
  });
}

export function toGridSessions(sessions: WorkspaceSessionView[]): GridSession[] {
  return sessions.map((s) => {
    const typeAr = SESSION_TYPE_LABELS[s.session_type] ?? s.session_type;
    const sysAr = SESSION_STUDY_SYSTEM_LABELS[s.study_system] ?? s.study_system;
    const start = String(s.start_time).slice(0, 5);
    const end = String(s.end_time).slice(0, 5);
    const badges = [`${typeAr} · ${sysAr}`];
    if (showUnverifiedEnrollmentBadge(s.enrollment_count_status)) {
      badges.push(UNVERIFIED_ENROLLMENT_BADGE_AR);
    }
    return {
      id: s.id,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
      study_system: s.study_system,
      session_type: s.session_type,
      title: `${entityDisplayName({ name: s.course_name, code: s.course_code })} · ش${s.section_number}`,
      subtitle: `${s.instructor_name} · ${s.room_label} · ${start}–${end}`,
      badge: badges.join(" · "),
    };
  });
}

export interface WorkspaceStats {
  totalSessions: number;
  lectureCount: number;
  labCount: number;
  instructorCount: number;
  roomCount: number;
}

export function computeWorkspaceStats(sessions: WorkspaceSessionView[]): WorkspaceStats {
  const instructors = new Set<string>();
  const rooms = new Set<string>();
  let lectureCount = 0;
  let labCount = 0;
  for (const s of sessions) {
    if (s.instructor_id) instructors.add(s.instructor_id);
    if (s.room_id) rooms.add(s.room_id);
    if (s.session_type === "lab") labCount += 1;
    else if (s.session_type === "lecture") lectureCount += 1;
  }
  return {
    totalSessions: sessions.length,
    lectureCount,
    labCount,
    instructorCount: instructors.size,
    roomCount: rooms.size,
  };
}

export function workspaceAcademicMembers(s: WorkspaceSessionView): AcademicMembership[] {
  return s.academic_memberships?.length ? s.academic_memberships : [s];
}

export function buildFilterOptions(sessions: WorkspaceSessionView[], program = "all") {
  const instructors = new Map<string, string>();
  const sections = new Map<string, string>();
  const rooms = new Map<string, string>();
  const programs = new Map<string, string>();
  const levels = new Map<string, string>();
  const types = new Set<string>();

  for (const s of sessions) {
    if (s.instructor_id) instructors.set(s.instructor_id, s.instructor_name);
    if (s.section_id) sections.set(s.section_id, s.section_number);
    if (s.room_id) rooms.set(s.room_id, s.room_label);
    for (const m of workspaceAcademicMembers(s)) {
      if (m.program_id) programs.set(m.program_id, m.program_name);
      if (m.level_id && (program === "all" || m.program_id === program))
        levels.set(m.level_id, m.level_name);
    }
    types.add(s.session_type);
  }

  return {
    instructors: [...instructors.entries()].map(([id, name]) => ({ id, name })),
    sections: [...sections.entries()].map(([id, name]) => ({ id, name })),
    rooms: [...rooms.entries()].map(([id, name]) => ({ id, name })),
    programs: [...programs.entries()].map(([id, name]) => ({ id, name })),
    levels: [...levels.entries()].map(([id, name]) => ({ id, name })),
    sessionTypes: [...types].map((t) => ({
      id: t,
      name: SESSION_TYPE_LABELS[t] ?? t,
    })),
  };
}

/** Client-side study-system check (mirrors server applyStudySystemFilter). */
export function sessionMatchesWorkspaceStudySystem(
  sessionStudySystem: string,
  filter: WorkspaceStudySystem,
): boolean {
  return matchesStudySystem(sessionStudySystem, filter);
}

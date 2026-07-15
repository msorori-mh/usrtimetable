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
  program_name: string;
  level_name: string;
  department_name: string;
  instructor_id: string | null;
  section_id: string | null;
  section_subgroup_id: string | null;
  room_id: string | null;
  program_id: string | null;
  level_id: string | null;
  updated_at: string | null;
  is_locked: boolean;
}

/** Loose joined row from TIMETABLE_SESSION_SELECT (nullable relations). */
interface RawWorkspaceSessionRow {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  session_type?: string | null;
  study_system?: string | null;
  instructor_id?: string | null;
  section_id?: string | null;
  room_id?: string | null;
  updated_at?: string | null;
  is_locked?: boolean | null;
  course_offerings?: {
    program_id?: string | null;
    level_id?: string | null;
    expected_students?: number | null;
    enrollment_count_status?: string | null;
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
    return {
      id: s.id,
      day_of_week: s.day_of_week,
      start_time: String(s.start_time),
      end_time: String(s.end_time),
      session_type: String(s.session_type ?? "lecture"),
      study_system: String(s.study_system ?? "regular"),
      course_code: course?.code ?? "—",
      course_name: course?.name ?? "—",
      instructor_name: s.instructors?.full_name ?? "—",
      room_label: s.rooms
        ? `${s.rooms.code ?? ""}${s.rooms.name ? ` — ${s.rooms.name}` : ""}`
        : "—",
      section_number: s.sections?.section_number != null ? String(s.sections.section_number) : "—",
      subgroup_code: s.section_subgroups?.subgroup_code ?? null,
      subgroup_expected_students:
        s.section_subgroups?.expected_students ?? s.expected_students ?? null,
      enrollment_count_status: normalizeEnrollmentCountStatus(offering?.enrollment_count_status),
      program_name: offering?.academic_programs?.name ?? "—",
      level_name: offering?.academic_levels?.name ?? "—",
      department_name: dept?.name ?? "—",
      instructor_id: s.instructor_id ?? null,
      section_id: s.section_id ?? null,
      section_subgroup_id: s.section_subgroup_id ?? null,
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
    if (filters.program !== "all" && s.program_id !== filters.program) return false;
    if (filters.level !== "all" && s.level_id !== filters.level) return false;
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
      title: `${s.course_code} · ش${s.section_number}`,
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

export function buildFilterOptions(sessions: WorkspaceSessionView[]) {
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
    if (s.program_id) programs.set(s.program_id, s.program_name);
    if (s.level_id) levels.set(s.level_id, s.level_name);
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

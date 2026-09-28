/** Pure, bounded timetable compaction. No database writes. */
import { cohortCourseDayMismatch } from "./cohort-course-days.ts";
import { MAX_INSTRUCTOR_SESSIONS_PER_DAY } from "./instructor-daily-sessions.ts";
import {
  ATTENDANCE_POLICY,
  compareAttendance,
  measureAttendance,
  instructorAttendanceDayCap,
  instructorAttendanceTarget,
  type AttendanceMetrics,
} from "./attendance-objective.ts";
import { isInstructorAvailabilityEnforced } from "../scheduling/instructor-availability-policy.ts";
import { evaluateInstructorSlotAvailability } from "../scheduling/instructor-slot-availability.ts";
import { isRoomTypeCompatible, roomTypeRank } from "../scheduling/room-type-policy.ts";
import {
  addStudentDailyLoad,
  emptyStudentDailyLoad,
  extendedDayLimit,
  studentDailyPolicy,
  studentDailyTotalMinutes,
  studentLoadKind,
  withinStudentDailyLoad,
  type StudentLoadKind,
} from "../scheduling/student-daily-policy.ts";

/** Plan-course component type behind an assignment (drives the room fallback policy). */
function assignmentComponentType(
  s: Snapshot,
  assignment: { plan_course_component_id?: string | null } | null | undefined,
): string | null {
  const id = assignment?.plan_course_component_id;
  if (!id) return null;
  return (s.components ?? []).find((c) => c.id === id)?.component_type ?? null;
}

/** Theory-like vs practical load of a session, for the student daily-hours policy. */
export function sessionStudentLoadKind(s: Snapshot, x: Session): StudentLoadKind {
  return studentLoadKind(
    assignmentComponentType(
      s,
      s.assignments.find((a) => a.id === x.teaching_assignment_id),
    ),
  );
}
export interface Session {
  id: string;
  updated_at: string;
  cohort_id: string;
  delivery_group_id: string;
  instructor_id: string;
  room_id: string;
  teaching_assignment_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  study_system: string;
  expected_students: number;
  is_locked: boolean;
  replaced_by_split?: boolean;
}
export interface Snapshot {
  qualityScope?: {
    studentDays: Record<string, number>;
    instructorDays: Record<string, number>;
    levelDays: Record<string, number>;
    studentSpanMinutes?: Record<string, number>;
  };
  generationScope?: { existingIds: string[]; maxRelocations: number };
  externalBusy?: {
    instructor_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
  }[];
  revision?: string;
  versionUpdatedAt?: string;
  sessions: Session[];
  cohorts: {
    id: string;
    program_id: string;
    level_id: string;
    study_system: string;
    term_id: string;
  }[];
  groups: {
    id: string;
    cohort_id: string;
    expected_students: number;
    active?: boolean;
    is_obsolete?: boolean;
  }[];
  sharedLectures?: { anchor_group_id: string; member_group_id: string }[];
  members: {
    delivery_group_id: string;
    partition_id: string;
    cohort_id: string;
  }[];
  partitions: {
    id: string;
    cohort_id: string;
    headcount: number;
    active: boolean;
  }[];
  assignments: {
    id: string;
    required_room_type: string;
    is_active: boolean;
    plan_course_component_id?: string | null;
  }[];
  components?: { id: string; component_type: string | null }[];
  rooms: {
    id: string;
    capacity: number;
    room_type: string;
    is_active: boolean;
    available_days: number[] | null;
    available_start_time: string | null;
    available_end_time: string | null;
  }[];
  instructors: {
    id: string;
    instructor_type_id: string | null;
    max_hours_per_day: number | null;
    is_active?: boolean;
    /** Explicit weekly attendance-day target (1..6); overrides generic day compression. */
    target_attendance_days_per_week?: number | null;
    max_attendance_days_per_week?: number | null;
  }[];
  types: { id: string; code: string; is_external: boolean }[];
  availability: {
    instructor_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    availability_type: string;
    is_preference?: boolean;
  }[];
  roomAvailability?: {
    room_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
  }[];
  roomUnavailability?: {
    room_id: string;
    day_of_week: number | null;
    start_time: string | null;
    end_time: string | null;
    start_date: string | null;
    end_date: string | null;
  }[];
  templates: {
    study_system: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    is_active: boolean;
  }[];
  settings: {
    enforce_instructor_availability?: boolean;
    extended_day_policy_enabled?: boolean;
    standard_day_end_time?: string;
    max_extended_days_per_partition?: number;
    working_days: number[];
    day_start_time: string;
    day_end_time: string;
    slot_minutes: number;
    max_daily_hours_per_instructor: number;
    max_daily_hours_per_section: number;
    max_daily_theory_hours_per_section?: number | null;
    max_daily_practical_hours_per_section?: number | null;
    break_between_sessions_min: number;
  };
}
export type Metrics = AttendanceMetrics & {
  cohortCourseDayMismatch?: number;
  extendedDayViolations?: number;
  extendedGroups?: number;
  instructorExcessTargetDays?: number;
  instructorSingleLectureDays?: number;
  practicalHallSessions?: number;
};
export interface Move {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_id: string;
}
export type SearchOutcome =
  | "local_minimum"
  | "time_limit"
  | "candidate_limit"
  | "pass_limit"
  | "cancelled"
  | "empty";
export interface Proposal {
  qualitySearch?: import("./quality-search.ts").QualitySearchReport;
  applicationMode?: "simultaneous";
  attendanceSearch?: import("./attendance-search.ts").AttendanceSearchResult;
  executionBlocked?: string;
  before: Metrics;
  after: Metrics;
  moves: Move[];
  fingerprint: string;
  inputFingerprint: string;
  stopped: boolean;
  outcome?: SearchOutcome;
  evaluatedCandidates?: number;
}
export const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const time = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}:00`;
const duration = (s: Session) => minutes(s.end_time) - minutes(s.start_time);
export const fingerprint = (sessions: Session[]) =>
  JSON.stringify([...sessions].sort((a, b) => a.id.localeCompare(b.id)));
export const inputFingerprint = (s: Snapshot) => JSON.stringify({ ...s, sessions: [] });
const contexts = new WeakMap<
  Snapshot,
  {
    students: (x: Session) => string[];
    share: (a: Session, b: Session) => boolean;
    level: (x: Session) => string;
    levels: (x: Session) => string[];
    weight: (id: string) => number;
  }
>();
export function context(s: Snapshot) {
  const cached = contexts.get(s);
  if (cached) return cached;
  const partitions = new Map(s.partitions.filter((p) => p.active).map((p) => [p.id, p]));
  const memberMap = new Map<string, string[]>();
  for (const m of s.members) {
    if (partitions.get(m.partition_id)?.cohort_id !== m.cohort_id) continue;
    memberMap.set(m.delivery_group_id, [
      ...new Set([...(memberMap.get(m.delivery_group_id) || []), m.partition_id]),
    ]);
  }
  const groups = new Map(s.groups.map((g) => [g.id, g]));
  const complete = (id: string) => {
    const g = groups.get(id),
      ids = memberMap.get(id) || [];
    return (
      !!g &&
      g.expected_students > 0 &&
      ids.length > 0 &&
      ids.reduce((n, p) => n + (partitions.get(p)?.headcount || 0), 0) === g.expected_students
    );
  };
  const groupCohorts = (id: string, fallbackId: string) => [
    ...new Set([
      fallbackId,
      ...(s.sharedLectures ?? [])
        .filter((l) => l.anchor_group_id === id)
        .map((l) => groups.get(l.member_group_id)?.cohort_id)
        .filter((c): c is string => !!c),
      ...(memberMap.get(id) || []).map((p) => partitions.get(p)!.cohort_id),
    ]),
  ];
  // An incomplete shared mapping keeps both source cohorts in conservative conflict checks.
  const fallback = new Set([
    ...s.sessions
      .filter((x) => !complete(x.delivery_group_id))
      .flatMap((x) => groupCohorts(x.delivery_group_id, x.cohort_id)),
    ...s.groups
      .filter((g) => g.active !== false && !g.is_obsolete && !complete(g.id))
      .flatMap((g) => groupCohorts(g.id, g.cohort_id)),
  ]);
  const students = (x: Session) => {
    const scope = groupCohorts(x.delivery_group_id, x.cohort_id);
    const keys = new Set<string>();
    for (const cid of scope) {
      if (fallback.has(cid) || !complete(x.delivery_group_id)) keys.add(`cohort:${cid}`);
      else
        for (const p of memberMap.get(x.delivery_group_id) || [])
          if (partitions.get(p)?.cohort_id === cid) keys.add(p);
    }
    return [...keys];
  };
  const share = (a: Session, b: Session) => {
    const common = groupCohorts(a.delivery_group_id, a.cohort_id).filter((id) =>
      groupCohorts(b.delivery_group_id, b.cohort_id).includes(id),
    );
    return (
      common.some((id) => fallback.has(id)) || students(a).some((p) => students(b).includes(p))
    );
  };
  const cohorts = new Map(s.cohorts.map((c) => [c.id, c]));
  const levelFor = (id: string) => {
    const c = cohorts.get(id);
    return c ? `${c.program_id}|${c.level_id}|${c.study_system}|${c.term_id}` : id;
  };
  const level = (x: Session) => levelFor(x.cohort_id);
  const levels = (x: Session) => groupCohorts(x.delivery_group_id, x.cohort_id).map(levelFor);
  const weight = (id: string) =>
    partitions.get(id)?.headcount ||
    Math.max(
      1,
      ...s.groups.filter((g) => `cohort:${g.cohort_id}` === id).map((g) => g.expected_students),
    );
  const result = { students, share, level, levels, weight };
  contexts.set(s, result);
  return result;
}
export function measure(s: Snapshot, sessions = s.sessions): Metrics {
  const ctx = context(s);
  const attendance = measureAttendance(
    sessions.map((x) => ({
      day: x.day_of_week,
      start: minutes(x.start_time),
      end: minutes(x.end_time),
      students: ctx.students(x),
      instructor: x.instructor_id,
      level: ctx.level(x),
      levels: ctx.levels(x),
    })),
    ctx.weight,
    (id) => s.instructors.find((t) => t.id === id)?.target_attendance_days_per_week ?? null,
  );
  const teacherDays = new Map<string, Map<number, number>>();
  const teacherMinutes = new Map<string, number>();
  for (const x of sessions) {
    const days = teacherDays.get(x.instructor_id) ?? new Map<number, number>();
    days.set(x.day_of_week, (days.get(x.day_of_week) ?? 0) + 1);
    teacherDays.set(x.instructor_id, days);
    teacherMinutes.set(x.instructor_id, (teacherMinutes.get(x.instructor_id) ?? 0) + duration(x));
  }
  const base: Metrics = {
    ...attendance,
    cohortCourseDayMismatch: cohortCourseDayMismatch(s, sessions),
    instructorExcessTargetDays: [...teacherDays].reduce((sum, [id, days]) => {
      const target = instructorAttendanceTarget(
        (teacherMinutes.get(id) ?? 0) / 60,
        s.instructors.find((t) => t.id === id)?.target_attendance_days_per_week,
      );
      return sum + Math.max(0, days.size - target);
    }, 0),
    instructorSingleLectureDays: [...teacherDays.values()].reduce(
      (sum, days) => sum + [...days.values()].filter((count) => count === 1).length,
      0,
    ),
    practicalHallSessions: sessions.filter((x) => {
      const assignment = s.assignments.find((a) => a.id === x.teaching_assignment_id);
      return (
        roomTypeRank({
          componentType: assignmentComponentType(s, assignment),
          requiredRoomType: assignment?.required_room_type,
          roomType: s.rooms.find((r) => r.id === x.room_id)?.room_type,
        }) === 1
      );
    }).length,
  };
  if (!s.settings.extended_day_policy_enabled) return base;
  const days = extendedDays(s, sessions);
  const limit = extendedDayLimit(s.settings);
  return {
    ...base,
    extendedGroups: days.size,
    extendedDayViolations: [...days.values()].reduce((n, d) => n + Math.max(0, d.size - limit), 0),
  };
}
/** A shared lecture consumes the extended day of every real student partition attending it. */
export function extendedDays(s: Snapshot, sessions = s.sessions): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  const cutoff = minutes(s.settings.standard_day_end_time ?? "14:00:00");
  for (const x of sessions) {
    if (x.replaced_by_split || minutes(x.end_time) <= cutoff) continue;
    for (const p of context(s).students(x)) {
      const days = result.get(p) ?? new Set<number>();
      days.add(x.day_of_week);
      result.set(p, days);
    }
  }
  return result;
}
/** Safe upper capacity bound, independent of candidate-grid resolution. */
export function studentWeeklyCapacity(s: Snapshot, days: number): number {
  // A student cannot attend longer than the college's actual teaching window.
  // This is an upper capacity bound, not a change to daily-load policy.
  const daily = Math.min(
    studentDailyTotalMinutes(s.settings),
    Math.max(0, minutes(s.settings.day_end_time) - minutes(s.settings.day_start_time)),
  );
  if (!s.settings.extended_day_policy_enabled) return daily * days;
  const start = minutes(s.settings.day_start_time);
  const normal = Math.min(
    daily,
    Math.max(0, minutes(s.settings.standard_day_end_time ?? "14:00:00") - start),
  );
  const full = Math.min(daily, Math.max(0, minutes(s.settings.day_end_time) - start));
  const extended = Math.min(days, extendedDayLimit(s.settings));
  return Math.min(normal, full) * (days - extended) + full * extended;
}
export function better(a: Metrics, b: Metrics) {
  if ((a.extendedDayViolations ?? 0) !== (b.extendedDayViolations ?? 0))
    return (a.extendedDayViolations ?? 0) < (b.extendedDayViolations ?? 0);
  // A forbidden sixth day is repaired first. Ordinary improvements may not
  // sacrifice either side's gaps, short days or attendance for the aggregate.
  if (a.excessDaysOverFive < b.excessDaysOverFive) return true;
  if (a.excessDaysOverFive > b.excessDaysOverFive) return false;
  if (a.excessDaysOverThree !== b.excessDaysOverThree)
    return a.excessDaysOverThree < b.excessDaysOverThree;
  // Student-side metrics stay protected: nothing below may make them worse.
  const protectedStudentMetrics: Array<
    keyof Pick<
      Metrics,
      "studentGapMinutes" | "worstStudentGapMinutes" | "shortStudentDays" | "studentAttendanceDays"
    >
  > = ["studentGapMinutes", "worstStudentGapMinutes", "shortStudentDays", "studentAttendanceDays"];
  if (protectedStudentMetrics.some((key) => a[key] > b[key])) return false;
  // Explicit per-instructor day targets (e.g. department heads at five days) rank
  // above generic instructor day compression, but below the student rules and the
  // hard constraints checked in feasible(). Reaching the explicit target may
  // therefore increase instructorAttendanceDays / shortInstructorDays.
  if (a.instructorTargetDayDeviation !== b.instructorTargetDayDeviation)
    return a.instructorTargetDayDeviation < b.instructorTargetDayDeviation;
  // Consolidation rule: after student-side protection and explicit targets,
  // eliminate days where an instructor attends for only one lecture before
  // polishing instructor gaps. The goal is grouping attendance, never spreading it.
  if ((a.instructorSingleLectureDays ?? 0) !== (b.instructorSingleLectureDays ?? 0))
    return (a.instructorSingleLectureDays ?? 0) < (b.instructorSingleLectureDays ?? 0);
  if (a.instructorAttendanceDays !== b.instructorAttendanceDays)
    return a.instructorAttendanceDays < b.instructorAttendanceDays;
  const protectedInstructorMetrics: Array<
    keyof Pick<
      Metrics,
      "instructorGapMinutes" | "worstInstructorGapMinutes" | "shortInstructorDays"
    >
  > = ["instructorGapMinutes", "worstInstructorGapMinutes", "shortInstructorDays"];
  if (protectedInstructorMetrics.some((key) => a[key] > b[key])) return false;
  const attendance = compareAttendance(a, b);
  return (
    attendance < 0 ||
    (attendance === 0 && (a.cohortCourseDayMismatch ?? 0) < (b.cohortCourseDayMismatch ?? 0))
  );
}
export function feasible(
  s: Snapshot,
  sessions: Session[],
  candidate: Session,
  original: Session,
): boolean {
  return placementIssue(s, sessions, candidate, original) === null;
}
export function placementIssue(
  s: Snapshot,
  sessions: Session[],
  candidate: Session,
  original: Session,
): string | null {
  const ctx = context(s),
    settings = s.settings,
    assignment = s.assignments.find((a) => a.id === candidate.teaching_assignment_id);
  const room = s.rooms.find((r) => r.id === candidate.room_id),
    teacher = s.instructors.find((t) => t.id === candidate.instructor_id);
  if (!assignment?.is_active) return "inactive_assignment";
  if (!room?.is_active) return "inactive_room";
  if (!teacher || teacher.is_active === false) return "inactive_instructor";
  if (candidate.is_locked) return "locked_session";
  if (duration(candidate) !== duration(original)) return "changed_duration";
  const start = minutes(candidate.start_time),
    end = minutes(candidate.end_time),
    day = candidate.day_of_week;
  if (
    s.externalBusy?.some(
      (b) =>
        b.instructor_id === candidate.instructor_id &&
        b.day_of_week === day &&
        minutes(b.start_time) < end &&
        start < minutes(b.end_time),
    )
  )
    return "external_instructor_conflict";
  if (
    end <= start ||
    !settings.working_days.includes(day) ||
    start < minutes(settings.day_start_time) ||
    end > minutes(settings.day_end_time)
  )
    return "working_window";
  if (
    room.capacity < candidate.expected_students ||
    !isRoomTypeCompatible({
      componentType: assignmentComponentType(s, assignment),
      requiredRoomType: assignment.required_room_type,
      roomType: room.room_type,
    })
  )
    return "room_capacity_or_type";
  // room_availability rows are authoritative when present; the denormalized
  // rooms.available_* columns are only a fallback (they can be stale).
  const roomRows = (s.roomAvailability || []).filter((w) => w.room_id === room.id);
  if (roomRows.length) {
    const sameDay = roomRows.filter((w) => w.day_of_week === day);
    if (!sameDay.length) return "room_closed_day";
    if (!sameDay.some((w) => start >= minutes(w.start_time) && end <= minutes(w.end_time)))
      return "room_window";
  } else {
    if (room.available_days?.length && !room.available_days.includes(day)) return "room_closed_day";
    if (
      (room.available_start_time && start < minutes(room.available_start_time)) ||
      (room.available_end_time && end > minutes(room.available_end_time))
    )
      return "room_window";
  }
  // Date-specific closures are still checked by the authoritative save RPC.
  if (
    (s.roomUnavailability || []).some(
      (w) =>
        w.room_id === room.id &&
        !w.start_date &&
        !w.end_date &&
        (w.day_of_week === null || w.day_of_week === day) &&
        start < (w.end_time ? minutes(w.end_time) : 1440) &&
        end > (w.start_time ? minutes(w.start_time) : 0),
    )
  )
    return "room_closure";
  if (
    !(candidate.study_system === "both" ? ["regular", "parallel"] : [candidate.study_system]).every(
      (system) =>
        s.templates.some(
          (t) =>
            t.is_active &&
            t.day_of_week === day &&
            (t.study_system === system || t.study_system === "both") &&
            start >= minutes(t.start_time) &&
            end <= minutes(t.end_time),
        ),
    )
  )
    return "system_template";
  // Instructor availability is only a constraint when enforcement is on.
  // Permanent instructors are available by default outside explicit blacklist
  // windows. External/visiting instructors require a positive hard window.
  if (isInstructorAvailabilityEnforced(settings.enforce_instructor_availability)) {
    const windows = (s.availability || []).filter(
      (a) => a.instructor_id === teacher.id && a.day_of_week === day && !a.is_preference,
    );
    const type = s.types.find((t) => t.id === teacher.instructor_type_id);
    if (
      !evaluateInstructorSlotAvailability({
        enforce: settings.enforce_instructor_availability,
        startTime: candidate.start_time,
        endTime: candidate.end_time,
        windows,
        requiresExplicitPositiveWindow: !!type?.is_external || type?.code === "from_other_college",
      }).available
    )
      return "instructor_availability";
  }
  const others = sessions.filter((x) => x.id !== candidate.id),
    sameDay = others.filter((x) => x.day_of_week === day);
  if (
    sameDay.filter((x) => x.instructor_id === teacher.id && !x.replaced_by_split).length >=
    MAX_INSTRUCTOR_SESSIONS_PER_DAY
  )
    return "instructor_daily_sessions";
  const teacherDays = new Set(
    others.filter((x) => x.instructor_id === teacher.id).map((x) => x.day_of_week),
  );
  teacherDays.add(day);
  if (
    teacherDays.size >
    instructorAttendanceDayCap(
      teacher.target_attendance_days_per_week,
      undefined,
      teacher.max_attendance_days_per_week,
    )
  )
    return "instructor_day_cap";
  if (settings.extended_day_policy_enabled) {
    const before = extendedDays(s, sessions);
    const after = extendedDays(s, [...others, candidate]);
    for (const p of ctx.students(candidate)) {
      if (
        (after.get(p)?.size ?? 0) > Math.max(extendedDayLimit(settings), before.get(p)?.size ?? 0)
      )
        return "extended_day_cap";
    }
  }
  if (
    sameDay.some(
      (x) =>
        start < minutes(x.end_time) &&
        end > minutes(x.start_time) &&
        (x.room_id === candidate.room_id ||
          x.instructor_id === teacher.id ||
          ctx.share(x, candidate)),
    )
  )
    return "resource_overlap";
  const requiredGap = Math.max(0, settings.break_between_sessions_min || 0);
  if (
    requiredGap &&
    sameDay.some(
      (x) =>
        (x.instructor_id === teacher.id || ctx.share(x, candidate)) &&
        start < minutes(x.end_time) + requiredGap &&
        end > minutes(x.start_time) - requiredGap,
    )
  )
    return "required_break";
  for (const levelKey of ctx.levels(candidate)) {
    const days = new Set(
      others.filter((x) => ctx.levels(x).includes(levelKey)).map((x) => x.day_of_week),
    );
    days.add(day);
    const beforeDays = new Set(
      sessions.filter((x) => ctx.levels(x).includes(levelKey)).map((x) => x.day_of_week),
    ).size;
    if (days.size > Math.max(ATTENDANCE_POLICY.maximumDays, beforeDays)) return "student_day_cap";
  }
  // Existing violations may be repaired incrementally; never enlarge them.
  const teacherMinutes =
    sameDay.filter((x) => x.instructor_id === teacher.id).reduce((a, x) => a + duration(x), 0) +
    duration(candidate);
  const priorTeacher = sessions
    .filter((x) => x.day_of_week === day && x.instructor_id === teacher.id)
    .reduce((a, x) => a + duration(x), 0);
  if (
    teacherMinutes >
    Math.max(
      (teacher.max_hours_per_day || settings.max_daily_hours_per_instructor || 6) * 60,
      priorTeacher,
    )
  )
    return "instructor_daily_hours";
  // Student daily hours: one shared policy (total / theory-like / practical).
  const dailyPolicy = studentDailyPolicy(settings);
  const load = (list: Session[]) =>
    list.reduce(
      (acc, x) => addStudentDailyLoad(acc, sessionStudentLoadKind(s, x), duration(x)),
      emptyStudentDailyLoad(),
    );
  for (const p of ctx.students(candidate)) {
    const prior = load(
      sessions.filter((x) => x.day_of_week === day && ctx.students(x).includes(p)),
    );
    const next = addStudentDailyLoad(
      load(sameDay.filter((x) => ctx.students(x).includes(p))),
      sessionStudentLoadKind(s, candidate),
      duration(candidate),
    );
    if (!withinStudentDailyLoad(next, dailyPolicy, prior)) return "student_daily_hours";
  }
  return null;
}
export interface CompactOptions {
  signal?: AbortSignal;
  maxPasses?: number;
  maxDurationMs?: number;
  maxCandidateEvaluations?: number;
  onProgress?: (moves: number, metrics: Metrics) => void;
}

/** Candidate grid plus exact adjacency anchors; a zero break permits end-to-start placement. */
export function compactSlots(
  s: Snapshot,
  old: Session,
): Array<{ day: number; start: string; end: string }> {
  const slots = new Map<string, { day: number; start: string; end: string }>();
  const length = duration(old);
  const step = Math.max(1, s.settings.slot_minutes || 60);
  for (const template of s.templates.filter(
    (t) =>
      t.is_active &&
      (old.study_system === "both" ||
        t.study_system === old.study_system ||
        t.study_system === "both"),
  )) {
    const begin = minutes(template.start_time),
      end = minutes(template.end_time);
    const anchors = new Set<number>([begin, end - length]);
    for (let start = begin; start + length <= end; start += step) anchors.add(start);
    for (const session of s.sessions.filter((x) => x.day_of_week === template.day_of_week)) {
      anchors.add(minutes(session.end_time));
      anchors.add(minutes(session.start_time) - length);
    }
    for (const start of anchors) {
      if (start < begin || start + length > end) continue;
      const slot = {
        day: template.day_of_week,
        start: time(start),
        end: time(start + length),
      };
      slots.set(`${slot.day}|${slot.start}`, slot);
    }
  }
  return [...slots.values()].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
}

export async function compact(s: Snapshot, options: CompactOptions = {}): Promise<Proposal> {
  const sessions = s.sessions.map((x) => ({ ...x })).sort((a, b) => a.id.localeCompare(b.id));
  const before = measure(s),
    moves: Move[] = [];
  let current = before,
    evaluated = 0;
  const budget = Math.max(0, Math.min(60000, options.maxDurationMs ?? 15000));
  const deadline = Date.now() + budget;
  const evaluationLimit = Math.max(
    0,
    options.maxCandidateEvaluations ?? Math.max(150000, budget * 100),
  );
  const passLimit = Math.max(1, Math.min(20, options.maxPasses ?? 5));
  const finished = (outcome: SearchOutcome): Proposal => ({
    before,
    after: current,
    moves,
    fingerprint: fingerprint(s.sessions),
    inputFingerprint: inputFingerprint(s),
    stopped: outcome === "cancelled",
    outcome,
    evaluatedCandidates: evaluated,
  });
  const stopReason = (): SearchOutcome | null =>
    options.signal?.aborted
      ? "cancelled"
      : Date.now() >= deadline
        ? "time_limit"
        : evaluated >= evaluationLimit
          ? "candidate_limit"
          : null;
  if (options.signal?.aborted) return finished("cancelled");
  if (!sessions.length) return finished("empty");
  const rooms = [...s.rooms].sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id));
  const roomCache = new Map<string, typeof rooms>();
  const roomsFor = (session: Session) => {
    const key = `${session.teaching_assignment_id}|${session.expected_students}`;
    if (!roomCache.has(key)) {
      const assignment = s.assignments.find((a) => a.id === session.teaching_assignment_id);
      const componentType = assignmentComponentType(s, assignment);
      roomCache.set(
        key,
        rooms
          .filter((room) => room.is_active && room.capacity >= session.expected_students)
          .map((room) => ({
            room,
            rank: roomTypeRank({
              componentType,
              requiredRoomType: assignment?.required_room_type,
              roomType: room.room_type,
            }),
          }))
          .filter((entry) => entry.rank !== null)
          // Required room type first; the practical lab→hall fallback last.
          .sort((a, b) => a.rank! - b.rank! || a.room.capacity - b.room.capacity)
          .map((entry) => entry.room),
      );
    }
    return roomCache.get(key)!;
  };
  const candidateCache = new Map<string, ReturnType<typeof compactSlots>>();
  for (const old of sessions) {
    const key = `${old.study_system}|${duration(old)}`;
    if (!candidateCache.has(key)) candidateCache.set(key, compactSlots(s, old));
  }
  const slotsFor = (old: Session) =>
    candidateCache.get(`${old.study_system}|${duration(old)}`) ?? [];
  const move = (value: Session): Move => ({
    id: value.id,
    day_of_week: value.day_of_week,
    start_time: value.start_time,
    end_time: value.end_time,
    room_id: value.room_id,
  });
  const progress = async () => {
    options.onProgress?.(moves.length, current);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  };
  const ctx = context(s);
  for (let pass = 0; pass < passLimit; pass++) {
    let changed = false;
    for (let i = 0; i < sessions.length; i++) {
      const reason = stopReason();
      if (reason) return finished(reason);
      const old = sessions[i];
      if (old.is_locked) continue;
      let best: Session | null = null,
        bestScore = current;
      candidateSearch: for (const slot of slotsFor(old)) {
        if (slot.day === old.day_of_week && slot.start === old.start_time) continue;
        for (const room of roomsFor(old)) {
          if (stopReason()) break candidateSearch;
          evaluated++;
          const candidate = {
            ...old,
            day_of_week: slot.day,
            start_time: slot.start,
            end_time: slot.end,
            room_id: room.id,
          };
          if (!feasible(s, sessions, candidate, old)) continue;
          const trial = [...sessions];
          trial[i] = candidate;
          const score = measure(s, trial);
          if (better(score, current) && compareAttendance(score, bestScore) < 0) {
            best = candidate;
            bestScore = score;
          }
          break; // Room identity does not change the attendance objective.
        }
      }
      if (best) {
        sessions[i] = best;
        current = bestScore;
        changed = true;
        moves.push(move(best));
      }
      await progress();
    }
    if (changed) continue;
    // At a local minimum, try a legal preparatory relocation followed by the target.
    // Applies to student AND instructor gaps, short days and attendance days, not only a sixth day.
    let pairFound = false;
    const targets = sessions
      .filter((x) => !x.is_locked)
      .sort(
        (a, b) =>
          (current.levelDays[ctx.level(b)] ?? 0) - (current.levelDays[ctx.level(a)] ?? 0) ||
          a.id.localeCompare(b.id),
      );
    pairSearch: for (const target of targets) {
      for (const slot of slotsFor(target)) {
        for (const room of roomsFor(target)) {
          const reason = stopReason();
          if (reason) return finished(reason);
          const candidate = {
            ...target,
            day_of_week: slot.day,
            start_time: slot.start,
            end_time: slot.end,
            room_id: room.id,
          };
          if (
            candidate.day_of_week === target.day_of_week &&
            candidate.start_time === target.start_time &&
            candidate.room_id === target.room_id
          )
            continue;
          evaluated++;
          const blockers = sessions.filter(
            (x) =>
              x.id !== target.id &&
              x.day_of_week === slot.day &&
              minutes(slot.start) < minutes(x.end_time) &&
              minutes(slot.end) > minutes(x.start_time) &&
              (x.instructor_id === target.instructor_id ||
                ctx.share(x, target) ||
                x.room_id === room.id),
          );
          if (blockers.length !== 1 || blockers[0].is_locked) continue;
          const blocker = blockers[0];
          if (
            !feasible(
              s,
              sessions.filter((x) => x.id !== blocker.id),
              candidate,
              target,
            )
          )
            continue;
          for (const alt of slotsFor(blocker)) {
            for (const altRoom of roomsFor(blocker)) {
              const reason = stopReason();
              if (reason) return finished(reason);
              evaluated++;
              const relocated = {
                ...blocker,
                day_of_week: alt.day,
                start_time: alt.start,
                end_time: alt.end,
                room_id: altRoom.id,
              };
              if (!feasible(s, sessions, relocated, blocker)) continue;
              const intermediate = sessions.map((x) => (x.id === blocker.id ? relocated : x));
              if (!feasible(s, intermediate, candidate, target)) continue;
              const final = intermediate.map((x) => (x.id === target.id ? candidate : x)),
                score = measure(s, final);
              if (!better(score, current)) continue;
              sessions.splice(0, sessions.length, ...final);
              current = score;
              moves.push(move(relocated), move(candidate));
              pairFound = true;
              break pairSearch;
            }
          }
        }
        await progress();
      }
    }
    if (!pairFound) return finished("local_minimum");
    await progress();
  }
  return finished(stopReason() ?? "pass_limit");
}

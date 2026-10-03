/** Shared objective for generation and compaction. All idle time is counted. */
export const ATTENDANCE_POLICY = Object.freeze({
  targetDays: 3,
  fallbackDays: 4,
  maximumDays: 5,
  breakMinutes: 0,
});

export interface AttendanceEvent {
  day: number;
  start: number;
  end: number;
  students: string[];
  instructor: string;
  level: string;
  levels?: string[];
}

export interface AttendanceMetrics {
  levelsOverFive: number;
  excessDaysOverFive: number;
  excessDaysOverFour: number;
  excessDaysOverThree: number;
  studentGapMinutes: number;
  studentAverageGapMinutes: number;
  worstStudentGapMinutes: number;
  shortStudentDays: number;
  studentAttendanceDays: number;
  studentCount: number;
  instructorGapMinutes: number;
  instructorAverageGapMinutes: number;
  worstInstructorGapMinutes: number;
  shortInstructorDays: number;
  instructorAttendanceDays: number;
  instructorCount: number;
  /** Sum of |attended days - explicit per-instructor target| over instructors that declare one. */
  instructorTargetDayDeviation: number;
  balancedGapMinutes: number;
  sessions: number;
  teachingMinutes: number;
  levelDays: Record<string, number>;
}

function idleMinutes(events: AttendanceEvent[]): number {
  const sorted = [...events].sort((a, b) => a.start - b.start || a.end - b.end);
  let end = sorted[0]?.end ?? 0;
  let gap = 0;
  for (const event of sorted.slice(1)) {
    gap += Math.max(0, event.start - end);
    end = Math.max(end, event.end);
  }
  return gap;
}

/**
 * Partition weights count people once, including across theory/practical groups.
 * `instructorTarget` returns an explicit weekly attendance-day target (1..6) for
 * instructors such as department heads; it overrides the general instructor
 * day-compression preference but never relaxes hard availability constraints.
 */
export function measureAttendance(
  events: AttendanceEvent[],
  weight: (studentId: string) => number,
  instructorTarget: (instructorId: string) => number | null | undefined = () => null,
): AttendanceMetrics {
  const levels = new Map<string, Set<number>>();
  const students = new Map<string, Map<number, AttendanceEvent[]>>();
  const instructors = new Map<string, Map<number, AttendanceEvent[]>>();
  const add = (map: typeof students, id: string, event: AttendanceEvent) => {
    const days = map.get(id) ?? new Map<number, AttendanceEvent[]>();
    days.set(event.day, [...(days.get(event.day) ?? []), event]);
    map.set(id, days);
  };
  for (const event of events) {
    if (!Number.isFinite(event.start) || !Number.isFinite(event.end) || event.end <= event.start) {
      throw new Error("INVALID_ATTENDANCE_INTERVAL");
    }
    for (const key of event.levels ?? [event.level]) {
      const days = levels.get(key) ?? new Set<number>();
      days.add(event.day);
      levels.set(key, days);
    }
    for (const id of new Set(event.students)) add(students, id, event);
    add(instructors, event.instructor, event);
  }
  const summarize = (people: typeof students, personWeight: (id: string) => number) => {
    let gap = 0,
      worst = 0,
      shortDays = 0,
      attendance = 0,
      count = 0;
    for (const [id, days] of people) {
      const w = personWeight(id);
      if (!Number.isFinite(w) || w <= 0) throw new Error("INVALID_ATTENDANCE_HEADCOUNT");
      let personGap = 0;
      count += w;
      attendance += days.size * w;
      for (const intervals of days.values()) {
        personGap += idleMinutes(intervals);
        if (intervals.reduce((n, event) => n + event.end - event.start, 0) <= 120) shortDays += w;
      }
      gap += personGap * w;
      worst = Math.max(worst, personGap);
    }
    return {
      gap,
      worst,
      shortDays,
      attendance,
      count,
      average: count ? gap / count : 0,
    };
  };
  const student = summarize(students, weight);
  const instructor = summarize(instructors, () => 1);
  let targetDeviation = 0;
  for (const [id, days] of instructors) {
    const target = instructorTarget(id);
    if (target == null) continue;
    if (!Number.isInteger(target) || target < 1 || target > 6)
      throw new Error("INVALID_INSTRUCTOR_ATTENDANCE_TARGET");
    targetDeviation += Math.abs(days.size - target);
  }
  const days = [...levels.values()].map((value) => value.size);
  return {
    levelsOverFive: days.filter((value) => value > ATTENDANCE_POLICY.maximumDays).length,
    excessDaysOverFive: days.reduce(
      (n, value) => n + Math.max(0, value - ATTENDANCE_POLICY.maximumDays),
      0,
    ),
    excessDaysOverFour: days.reduce(
      (n, value) => n + Math.max(0, value - ATTENDANCE_POLICY.fallbackDays),
      0,
    ),
    excessDaysOverThree: days.reduce(
      (n, value) => n + Math.max(0, value - ATTENDANCE_POLICY.targetDays),
      0,
    ),
    studentGapMinutes: student.gap,
    studentAverageGapMinutes: student.average,
    worstStudentGapMinutes: student.worst,
    shortStudentDays: student.shortDays,
    studentAttendanceDays: student.attendance,
    studentCount: student.count,
    instructorGapMinutes: instructor.gap,
    instructorAverageGapMinutes: instructor.average,
    worstInstructorGapMinutes: instructor.worst,
    shortInstructorDays: instructor.shortDays,
    instructorAttendanceDays: instructor.attendance,
    instructorCount: instructor.count,
    instructorTargetDayDeviation: targetDeviation,
    // Equal influence for the average student and instructor, regardless of cohort size.
    balancedGapMinutes: (student.average + instructor.average) / 2,
    sessions: events.length,
    teachingMinutes: events.reduce((n, event) => n + event.end - event.start, 0),
    levelDays: Object.fromEntries([...levels].map(([key, value]) => [key, value.size])),
  };
}

const perPerson = (value: number, count: number) => (count ? value / count : 0);
const vector = (m: AttendanceMetrics) => [
  m.excessDaysOverFive,
  m.excessDaysOverFour,
  m.excessDaysOverThree,
  // Explicit per-instructor day targets outrank generic instructor day compression,
  // but stay below the student day rules above.
  m.instructorTargetDayDeviation,
  (m as AttendanceMetrics & { instructorExcessTargetDays?: number }).instructorExcessTargetDays ??
    0,
  (m as AttendanceMetrics & { instructorSingleLectureDays?: number }).instructorSingleLectureDays ??
    0,
  m.instructorAttendanceDays,
  m.balancedGapMinutes,
  Math.max(m.worstStudentGapMinutes, m.worstInstructorGapMinutes),
  perPerson(m.shortStudentDays, m.studentCount) +
    perPerson(m.shortInstructorDays, m.instructorCount),
  perPerson(m.studentAttendanceDays, m.studentCount) +
    perPerson(m.instructorAttendanceDays, m.instructorCount),
  m.instructorGapMinutes,
  m.studentGapMinutes,
];

/** Negative means a improves b. Feasibility must be checked separately. */
export function compareAttendance(a: AttendanceMetrics, b: AttendanceMetrics): number {
  const av = vector(a),
    bv = vector(b);
  for (let i = 0; i < av.length; i++) {
    const delta = av[i] - bv[i];
    if (Math.abs(delta) > 1e-8) return delta;
  }
  return 0;
}

/**
 * Generic weekly attendance-day cap for instructors, honoured by the fail-closed
 * persistence gate. An instructor with an explicit
 * `target_attendance_days_per_week` is measured against that target instead; the
 * generic cap is never raised for anyone else, and student day rules,
 * instructor_availability, conflicts and daily hour limits are untouched.
 */
export const INSTRUCTOR_GENERIC_ATTENDANCE_DAY_CAP = 4;

/** Regular instructors may exceed the workload-derived minimum by one day only. */
export const INSTRUCTOR_ATTENDANCE_FLEX_DAYS = 1;

/** Weekly hours count each session once, never once per candidate placement. */
export function instructorAttendanceTarget(hours: number, explicit?: number | null): number {
  if (explicit != null) {
    if (!Number.isInteger(explicit) || explicit < 1 || explicit > 6)
      throw new Error("INVALID_INSTRUCTOR_ATTENDANCE_TARGET");
    return explicit;
  }
  return hours <= 6 ? 1 : hours <= 10 ? 2 : hours <= 16 ? 3 : 4;
}

/**
 * Effective ceiling for a regular instructor: the workload-derived minimum plus
 * one fallback day, never more than the institutional four-day ceiling.
 * Explicit maxima remain authoritative. Explicit targets (for example a
 * department head targeting four days) may raise the ceiling, but never beyond 6.
 */
export function instructorAttendanceDayCapForHours(
  hours: number,
  target: number | null | undefined,
  maxOverride: number | null | undefined = null,
): number {
  if (!Number.isFinite(hours) || hours < 0) throw new Error("INVALID_INSTRUCTOR_WEEKLY_HOURS");
  const minimum = instructorAttendanceTarget(hours);
  const regularCap = Math.min(
    INSTRUCTOR_GENERIC_ATTENDANCE_DAY_CAP,
    minimum + INSTRUCTOR_ATTENDANCE_FLEX_DAYS,
  );
  // A legacy target above four does not silently expand the institutional ceiling.
  // Only an explicit maximum is allowed to document an approved exception.
  if (maxOverride != null) return instructorAttendanceDayCap(target, regularCap, maxOverride);
  return Math.min(
    INSTRUCTOR_GENERIC_ATTENDANCE_DAY_CAP,
    instructorAttendanceDayCap(target, regularCap),
  );
}

/** Per-instructor attendance-day limits as stored on `instructors`. */
export interface InstructorAttendanceLimits {
  id: string;
  /** Explicit weekly target (drives ranking and the deviation objective). */
  target_attendance_days_per_week?: number | null;
  /** Explicit hard ceiling (1..6); may tighten or extend the generic ceiling without becoming a target. */
  max_attendance_days_per_week?: number | null;
}

export function instructorAttendanceDayCap(
  target: number | null | undefined,
  genericCap: number = INSTRUCTOR_GENERIC_ATTENDANCE_DAY_CAP,
  maxOverride: number | null | undefined = null,
): number {
  const validate = (value: number) => {
    if (!Number.isInteger(value) || value < 1 || value > 6) {
      throw new Error("INVALID_INSTRUCTOR_ATTENDANCE_TARGET");
    }
    return value;
  };
  const validatedTarget = target == null ? null : validate(target);
  const validatedMax = maxOverride == null ? null : validate(maxOverride);
  if (validatedTarget != null && validatedMax != null && validatedTarget > validatedMax) {
    throw new Error("INSTRUCTOR_ATTENDANCE_TARGET_EXCEEDS_MAX");
  }
  // An explicit maximum is the instructor's real hard ceiling and may tighten
  // the generic four-day limit. Without an explicit maximum, an explicit target
  // can only raise the generic ceiling (e.g. a department head targeting 5 days).
  if (validatedMax != null) return validatedMax;
  return validatedTarget == null ? genericCap : Math.max(genericCap, validatedTarget);
}

/** Instructors scheduled on more distinct weekdays than their effective cap allows. */
export function instructorsOverAttendanceDayCap(
  sessions: { instructor_id: string; day_of_week: number }[],
  instructors: InstructorAttendanceLimits[],
  genericCap: number = INSTRUCTOR_GENERIC_ATTENDANCE_DAY_CAP,
): { instructorId: string; days: number; cap: number }[] {
  const limits = new Map(
    instructors.map((i) => [
      i.id,
      {
        target: i.target_attendance_days_per_week ?? null,
        max: i.max_attendance_days_per_week ?? null,
      },
    ]),
  );
  const byInstructor = new Map<string, Set<number>>();
  for (const session of sessions) {
    const days = byInstructor.get(session.instructor_id) ?? new Set<number>();
    days.add(session.day_of_week);
    byInstructor.set(session.instructor_id, days);
  }
  const over: { instructorId: string; days: number; cap: number }[] = [];
  for (const [instructorId, days] of byInstructor) {
    const limit = limits.get(instructorId);
    const cap = instructorAttendanceDayCap(limit?.target ?? null, genericCap, limit?.max ?? null);
    if (days.size > cap) over.push({ instructorId, days: days.size, cap });
  }
  return over;
}

/**
 * Workload-aware violations used by the automatic scheduler. The complete weekly
 * duration is measured first; regular instructors receive only one fallback day
 * above their minimum target.
 */
export function instructorsOverWorkloadAttendanceDayCap(
  sessions: {
    instructor_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
  }[],
  instructors: InstructorAttendanceLimits[],
): { instructorId: string; days: number; cap: number; hours: number }[] {
  const limits = new Map(instructors.map((i) => [i.id, i]));
  const byInstructor = new Map<string, { days: Set<number>; minutes: number }>();
  const toMinutes = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute))
      throw new Error("INVALID_INSTRUCTOR_SESSION_TIME");
    return hour * 60 + minute;
  };
  for (const session of sessions) {
    const row = byInstructor.get(session.instructor_id) ?? {
      days: new Set<number>(),
      minutes: 0,
    };
    const duration = toMinutes(session.end_time) - toMinutes(session.start_time);
    if (duration <= 0) throw new Error("INVALID_INSTRUCTOR_SESSION_TIME");
    row.days.add(session.day_of_week);
    row.minutes += duration;
    byInstructor.set(session.instructor_id, row);
  }
  const over: { instructorId: string; days: number; cap: number; hours: number }[] = [];
  for (const [instructorId, row] of byInstructor) {
    const limit = limits.get(instructorId);
    const hours = row.minutes / 60;
    const cap = instructorAttendanceDayCapForHours(
      hours,
      limit?.target_attendance_days_per_week ?? null,
      limit?.max_attendance_days_per_week ?? null,
    );
    if (row.days.size > cap) over.push({ instructorId, days: row.days.size, cap, hours });
  }
  return over;
}

/**
 * New or increased attendance-day cap violations compared with a baseline.
 * Historical violations that existed before the run and were preserved as-is must
 * not fail a fill_missing run; only a regression may.
 */
export function attendanceDayCapRegressions(
  baselineSessions: { instructor_id: string; day_of_week: number }[],
  finalSessions: { instructor_id: string; day_of_week: number }[],
  instructors: InstructorAttendanceLimits[],
  genericCap: number = INSTRUCTOR_GENERIC_ATTENDANCE_DAY_CAP,
): { instructorId: string; days: number; cap: number; baselineDays: number }[] {
  const baseline = new Map(
    instructorsOverAttendanceDayCap(baselineSessions, instructors, genericCap).map((row) => [
      row.instructorId,
      row.days,
    ]),
  );
  return instructorsOverAttendanceDayCap(finalSessions, instructors, genericCap)
    .map((row) => ({
      ...row,
      baselineDays: baseline.get(row.instructorId) ?? row.cap,
    }))
    .filter((row) => row.days > row.baselineDays);
}

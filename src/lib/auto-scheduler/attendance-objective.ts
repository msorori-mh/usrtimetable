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

/** Weekly hours count each session once, never once per candidate placement. */
export function instructorAttendanceTarget(hours: number, explicit?: number | null): number {
  if (explicit != null) {
    if (!Number.isInteger(explicit) || explicit < 1 || explicit > 6)
      throw new Error("INVALID_INSTRUCTOR_ATTENDANCE_TARGET");
    return explicit;
  }
  return hours <= 6 ? 1 : hours <= 10 ? 2 : hours <= 16 ? 3 : 4;
}

/** Per-instructor attendance-day limits as stored on `instructors`. */
export interface InstructorAttendanceLimits {
  id: string;
  /** Explicit weekly target (drives ranking and the deviation objective). */
  target_attendance_days_per_week?: number | null;
  /** Hard-ceiling override only: allows extending to N days without targeting N. */
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
  // Effective hard cap = max(generic, explicit target, explicit max override).
  // The max override raises the ceiling only; it is never a target and never
  // enters `instructorTargetDayDeviation` or candidate ranking.
  let cap = genericCap;
  if (target != null) cap = Math.max(cap, validate(target));
  if (maxOverride != null) cap = Math.max(cap, validate(maxOverride));
  return cap;
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

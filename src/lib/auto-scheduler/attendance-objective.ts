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

/** Partition weights count people once, including across theory/practical groups. */
export function measureAttendance(
  events: AttendanceEvent[],
  weight: (studentId: string) => number,
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

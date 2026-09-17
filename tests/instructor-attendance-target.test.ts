/**
 * INSTRUCTOR-ATTENDANCE-TARGET-01 — focused tests.
 * instructors.target_attendance_days_per_week is an explicit weekly attendance-day
 * target (1..6). When set it overrides the generic instructor day-compression
 * preference, ranks below the student day rules, and never creates sessions.
 */
import { describe, expect, it } from "bun:test";
import {
  compareAttendance,
  measureAttendance,
  instructorAttendanceDayCap,
  instructorsOverAttendanceDayCap,
  type AttendanceEvent,
} from "@/lib/auto-scheduler/attendance-objective";
import {
  better,
  measure,
  type Metrics,
  type Session,
  type Snapshot,
} from "@/lib/auto-scheduler/compact";

/**
 * Each event belongs to its own level/student, so the two layouts below are
 * identical for students (one attendance day, no gaps) and differ only in how
 * many days the instructor attends.
 */
const event = (n: number, day: number, start: number, instructor = "head"): AttendanceEvent => ({
  day,
  start,
  end: start + 120,
  students: [`p${n}`],
  instructor,
  level: `L${n}`,
});

const spread = [
  event(1, 1, 480),
  event(2, 2, 480),
  event(3, 3, 480),
  event(4, 4, 480),
  event(5, 5, 480),
];
const packed = [
  event(1, 1, 480),
  event(2, 1, 600),
  event(3, 2, 480),
  event(4, 2, 600),
  event(5, 3, 480),
];

describe("instructor weekly attendance-day target", () => {
  it("no target keeps the metric at zero", () => {
    expect(measureAttendance(spread, () => 20).instructorTargetDayDeviation).toBe(0);
  });

  it("measures the deviation from an explicit target in both directions", () => {
    expect(
      measureAttendance(
        spread,
        () => 20,
        () => 5,
      ).instructorTargetDayDeviation,
    ).toBe(0);
    expect(
      measureAttendance(
        packed,
        () => 20,
        () => 5,
      ).instructorTargetDayDeviation,
    ).toBe(2);
    expect(
      measureAttendance(
        spread,
        () => 20,
        () => 3,
      ).instructorTargetDayDeviation,
    ).toBe(2);
  });

  it("rejects an out-of-range target", () => {
    expect(() =>
      measureAttendance(
        spread,
        () => 20,
        () => 0,
      ),
    ).toThrow("INVALID_INSTRUCTOR_ATTENDANCE_TARGET");
    expect(() =>
      measureAttendance(
        spread,
        () => 20,
        () => 7,
      ),
    ).toThrow("INVALID_INSTRUCTOR_ATTENDANCE_TARGET");
  });

  it("prefers the five-day layout for a targeted instructor", () => {
    const five = measureAttendance(
      spread,
      () => 20,
      () => 5,
    );
    const three = measureAttendance(
      packed,
      () => 20,
      () => 5,
    );
    expect(compareAttendance(five, three)).toBeLessThan(0);
  });

  it("keeps the student day rules above the instructor target", () => {
    const a = {
      ...measureAttendance(
        spread,
        () => 20,
        () => 5,
      ),
      excessDaysOverFive: 1,
    };
    const b = {
      ...measureAttendance(
        packed,
        () => 20,
        () => 5,
      ),
      excessDaysOverFive: 0,
    };
    expect(compareAttendance(a, b)).toBeGreaterThan(0);
  });

  it("never accepts a move that increases the deviation", () => {
    const base = measureAttendance(
      spread,
      () => 20,
      () => 5,
    ) as Metrics;
    const worse = measureAttendance(
      packed,
      () => 20,
      () => 5,
    ) as Metrics;
    expect(better(worse, base)).toBe(false);
  });
});

const session = (over: Partial<Session>): Session =>
  ({
    id: "x",
    day_of_week: 1,
    start_time: "08:00:00",
    end_time: "10:00:00",
    room_id: "r1",
    instructor_id: "head",
    cohort_id: "c1",
    delivery_group_id: "g1",
    teaching_assignment_id: "a1",
    ...over,
  }) as Session;

describe("snapshot wiring", () => {
  it("reads the target from the instructor row", () => {
    const snapshot = {
      sessions: [
        session({ id: "s1", day_of_week: 1 }),
        session({ id: "s2", day_of_week: 2 }),
        session({ id: "s3", day_of_week: 3 }),
      ],
      cohorts: [
        { id: "c1", program_id: "p", level_id: "l", study_system: "regular", term_id: "t" },
      ],
      groups: [{ id: "g1", cohort_id: "c1", expected_students: 20, active: true }],
      members: [],
      partitions: [],
      sharedLectures: [],
      assignments: [],
      rooms: [],
      instructors: [
        {
          id: "head",
          instructor_type_id: null,
          max_hours_per_day: null,
          target_attendance_days_per_week: 5,
        },
      ],
      types: [],
      availability: [],
      templates: [],
      settings: {
        working_days: [1, 2, 3, 4, 5],
        day_start_time: "08:00:00",
        day_end_time: "14:00:00",
        slot_minutes: 60,
        max_daily_hours_per_instructor: 6,
        max_daily_hours_per_section: 6,
        break_between_sessions_min: 0,
      },
    } as unknown as Snapshot;
    expect(measure(snapshot).instructorTargetDayDeviation).toBe(2);
  });
});

describe("fail-closed persistence gate honours the explicit target", () => {
  const s = (instructor: string, day: number) => ({ instructor_id: instructor, day_of_week: day });
  const fiveDays = (instructor: string) => [0, 1, 2, 3, 4].map((d) => s(instructor, d));

  it("does not flag five days for an instructor whose target is five", () => {
    expect(
      instructorsOverAttendanceDayCap(fiveDays("head"), [
        { id: "head", target_attendance_days_per_week: 5 },
      ]),
    ).toEqual([]);
  });

  it("still flags a regular instructor at five days", () => {
    expect(
      instructorsOverAttendanceDayCap(fiveDays("plain"), [
        { id: "plain", target_attendance_days_per_week: null },
      ]),
    ).toEqual([{ instructorId: "plain", days: 5, cap: 4 }]);
  });

  it("flags a targeted instructor only beyond their own target", () => {
    expect(
      instructorsOverAttendanceDayCap([...fiveDays("head"), s("head", 5)], [
        { id: "head", target_attendance_days_per_week: 5 },
      ]),
    ).toEqual([{ instructorId: "head", days: 6, cap: 5 }]);
  });

  it("never lowers the generic cap for a target below four", () => {
    expect(instructorAttendanceDayCap(2)).toBe(4);
    expect(instructorAttendanceDayCap(null)).toBe(4);
    expect(instructorAttendanceDayCap(5)).toBe(5);
    expect(() => instructorAttendanceDayCap(7)).toThrow("INVALID_INSTRUCTOR_ATTENDANCE_TARGET");
  });

  it("keeps unknown instructors on the generic cap", () => {
    expect(instructorsOverAttendanceDayCap(fiveDays("ghost"), [])).toEqual([
      { instructorId: "ghost", days: 5, cap: 4 },
    ]);
  });
});

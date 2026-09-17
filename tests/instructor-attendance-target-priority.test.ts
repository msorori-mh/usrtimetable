/**
 * INSTRUCTOR-ATTENDANCE-TARGET-02 — explicit target priority.
 *
 * An explicit instructors.target_attendance_days_per_week (department heads at
 * five days) outranks generic instructor day compression, but stays below the
 * student day rules and the hard constraints. The fill_missing persistence gate
 * only blocks NEW or INCREASED cap violations, never historical ones.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  attendanceDayCapRegressions,
  instructorAttendanceDayCap,
  instructorsOverAttendanceDayCap,
  measureAttendance,
  type AttendanceEvent,
} from "@/lib/auto-scheduler/attendance-objective";
import { better, type Metrics } from "@/lib/auto-scheduler/compact";

/** Each event has its own level/student, so student metrics are identical across layouts. */
const event = (n: number, day: number, start = 480): AttendanceEvent => ({
  day,
  start,
  end: start + 120,
  students: [`p${n}`],
  instructor: "head",
  level: `L${n}`,
});

/** Same six teaching units, spread over `days` instructor days. */
const layout = (days: number): Metrics => {
  const events: AttendanceEvent[] = [];
  for (let i = 0; i < 6; i++) {
    const day = (i % days) + 1;
    events.push(event(i + 1, day, 480 + Math.floor(i / days) * 120));
  }
  return measureAttendance(
    events,
    () => 20,
    () => 5,
  ) as Metrics;
};

describe("targeted instructor (target = 5)", () => {
  it("prefers four days over three, and five over four", () => {
    expect(better(layout(4), layout(3))).toBe(true);
    expect(better(layout(5), layout(4))).toBe(true);
  });

  it("does not accept a sixth day", () => {
    expect(better(layout(6), layout(5))).toBe(false);
    expect(
      instructorsOverAttendanceDayCap(
        [0, 1, 2, 3, 4, 5].map((d) => ({ instructor_id: "head", day_of_week: d })),
        [{ id: "head", target_attendance_days_per_week: 5 }],
      ),
    ).toHaveLength(1);
  });
});

describe("untargeted instructor", () => {
  it("keeps the generic four-day cap on a fifth day", () => {
    expect(instructorAttendanceDayCap(null)).toBe(4);
    expect(
      instructorsOverAttendanceDayCap(
        [0, 1, 2, 3, 4].map((d) => ({ instructor_id: "plain", day_of_week: d })),
        [{ id: "plain", target_attendance_days_per_week: null }],
      ),
    ).toEqual([{ instructorId: "plain", days: 5, cap: 4 }]);
  });
});

describe("fill_missing persistence gate", () => {
  const days = (instructor: string, list: number[]) =>
    list.map((d) => ({ instructor_id: instructor, day_of_week: d }));
  const instructors = [{ id: "plain", target_attendance_days_per_week: null }];

  it("allows a preserved historical violation", () => {
    const baseline = days("plain", [0, 1, 2, 3, 4]);
    expect(attendanceDayCapRegressions(baseline, baseline, instructors)).toEqual([]);
  });

  it("blocks an increased violation", () => {
    expect(
      attendanceDayCapRegressions(
        days("plain", [0, 1, 2, 3, 4]),
        days("plain", [0, 1, 2, 3, 4, 5]),
        instructors,
      ),
    ).toEqual([{ instructorId: "plain", days: 6, cap: 4, baselineDays: 5 }]);
  });

  it("blocks a brand-new violation", () => {
    expect(
      attendanceDayCapRegressions(
        days("plain", [0, 1, 2]),
        days("plain", [0, 1, 2, 3, 4]),
        instructors,
      ),
    ).toHaveLength(1);
  });
});

describe("engine source contract", () => {
  const source = readFileSync("src/lib/auto-scheduler/v2.ts", "utf8");

  it("has no hard-coded four-day instructor gate", () => {
    expect(source).not.toContain("teacherDays.size >= 4");
    expect(source).toContain("instructorDayCap(item.instructor_id)");
  });

  it("uses the explicit target for ranking and the persistence gate", () => {
    expect(source).toContain("target_attendance_days_per_week");
    expect(source).toContain("instructorsOverAttendanceDayCap");
    expect(source).toContain("applyGenerationPlan");
  });
});

/**
 * INSTRUCTOR-ATTENDANCE-MAX-01 — cap-only override.
 *
 * `max_attendance_days_per_week` raises the hard ceiling without becoming a
 * target: day compression still prefers fewer days for that instructor.
 */
describe("max-only attendance-day override", () => {
  it("target=5 + max=null: cap is 5 and the target deviation drives planning", () => {
    expect(instructorAttendanceDayCap(5, undefined, null)).toBe(5);
    expect(layout(5).instructorTargetDayDeviation).toBe(0);
    expect(better(layout(5), layout(4))).toBe(true);
  });

  it("target=null + max=5: cap is 5 but nothing pushes planning towards five days", () => {
    expect(instructorAttendanceDayCap(null, undefined, 5)).toBe(5);
    const untargeted = (days: number) => {
      const events: AttendanceEvent[] = [];
      for (let i = 0; i < 6; i++)
        events.push(event(i + 1, (i % days) + 1, 480 + Math.floor(i / days) * 120));
      return measureAttendance(events, () => 20) as Metrics;
    };
    expect(untargeted(5).instructorTargetDayDeviation).toBe(0);
    expect(untargeted(4).instructorTargetDayDeviation).toBe(0);
    // No target objective exists, so compression keeps preferring fewer days.
    expect(better(untargeted(5), untargeted(4))).toBe(false);
    expect(better(untargeted(3), untargeted(4))).toBe(true);
    // Five days are legal for this instructor, not a cap violation.
    expect(
      instructorsOverAttendanceDayCap(
        [0, 1, 2, 3, 4].map((d) => ({ instructor_id: "ext", day_of_week: d })),
        [{ id: "ext", max_attendance_days_per_week: 5 }],
      ),
    ).toHaveLength(0);
  });

  it("target=null + max=null: cap stays at the generic four days", () => {
    expect(instructorAttendanceDayCap(null, undefined, null)).toBe(4);
    expect(
      instructorsOverAttendanceDayCap(
        [0, 1, 2, 3, 4].map((d) => ({ instructor_id: "plain", day_of_week: d })),
        [{ id: "plain" }],
      ),
    ).toEqual([{ instructorId: "plain", days: 5, cap: 4 }]);
  });

  it("rejects an invalid max override", () => {
    expect(() => instructorAttendanceDayCap(null, undefined, 0)).toThrow();
    expect(() => instructorAttendanceDayCap(null, undefined, 7)).toThrow();
    expect(() => instructorAttendanceDayCap(null, undefined, 4.5)).toThrow();
  });

  it("fill_missing regression comparison honours the max override", () => {
    const days = (n: number) =>
      Array.from({ length: n }, (_, d) => ({ instructor_id: "ext", day_of_week: d }));
    const instructors = [{ id: "ext", max_attendance_days_per_week: 5 }];
    // Five days are within the effective cap: no violation, no regression.
    expect(attendanceDayCapRegressions(days(4), days(5), instructors)).toHaveLength(0);
    // A sixth day exceeds the override and is reported as a regression.
    expect(attendanceDayCapRegressions(days(5), days(6), instructors)).toHaveLength(1);
    // Without the override the same fifth day is a regression.
    expect(attendanceDayCapRegressions(days(4), days(5), [{ id: "ext" }])).toHaveLength(1);
  });
});

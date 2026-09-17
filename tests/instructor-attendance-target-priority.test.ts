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
    expect(source).toContain("attendanceDayCapRegressions");
  });
});

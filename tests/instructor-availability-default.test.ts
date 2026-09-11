/**
 * INSTRUCTOR-AVAILABILITY-DEFAULT-01 — focused tests.
 * Missing/incomplete instructor availability must never block placement while
 * enforcement is off; explicit instructor double-booking stays blocked.
 */
import { describe, expect, it } from "bun:test";
import {
  ENFORCE_INSTRUCTOR_AVAILABILITY,
  isInstructorAvailabilityEnforced,
} from "@/lib/scheduling/instructor-availability-policy";
import { feasible, type Session, type Snapshot } from "@/lib/auto-scheduler/compact";

const session = (over: Partial<Session>): Session =>
  ({
    id: "s1",
    updated_at: "2026-01-01T00:00:00Z",
    cohort_id: "c1",
    delivery_group_id: "g1",
    instructor_id: "i-external",
    room_id: "r1",
    teaching_assignment_id: "a1",
    day_of_week: 1,
    start_time: "08:00:00",
    end_time: "10:00:00",
    study_system: "regular",
    expected_students: 30,
    ...over,
  }) as Session;

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  sessions: [],
  cohorts: [
    { id: "c1", program_id: "p1", level_id: "l1", study_system: "regular", term_id: "t1" },
  ],
  groups: [{ id: "g1", cohort_id: "c1", expected_students: 30, active: true, is_obsolete: false }],
  members: [{ delivery_group_id: "g1", partition_id: "part1", cohort_id: "c1" }],
  partitions: [{ id: "part1", cohort_id: "c1", headcount: 30, active: true }],
  assignments: [{ id: "a1", required_room_type: "lecture_hall", is_active: true }],
  rooms: [
    {
      id: "r1",
      capacity: 75,
      room_type: "lecture_hall",
      is_active: true,
      available_days: null,
      available_start_time: null,
      available_end_time: null,
    },
    {
      id: "r2",
      capacity: 75,
      room_type: "lecture_hall",
      is_active: true,
      available_days: null,
      available_start_time: null,
      available_end_time: null,
    },
  ],
  instructors: [
    { id: "i-external", instructor_type_id: "type-ext", max_hours_per_day: 8, is_active: true },
    { id: "i-other", instructor_type_id: "type-ext", max_hours_per_day: 8, is_active: true },
  ],
  types: [{ id: "type-ext", code: "external", is_external: true }],
  // Intentionally empty: no availability rows entered yet.
  availability: [],
  templates: [1, 2, 3].map((day) => ({
    study_system: "both",
    day_of_week: day,
    start_time: "08:00:00",
    end_time: "16:00:00",
    is_active: true,
  })),
  settings: {
    working_days: [1, 2, 3],
    day_start_time: "08:00:00",
    day_end_time: "16:00:00",
    slot_minutes: 60,
    max_daily_hours_per_instructor: 8,
    max_daily_hours_per_section: 8,
    break_between_sessions_min: 0,
  },
  ...over,
});

describe("instructor availability policy", () => {
  it("is disabled by default", () => {
    expect(ENFORCE_INSTRUCTOR_AVAILABILITY).toBe(false);
    expect(isInstructorAvailabilityEnforced()).toBe(false);
  });

  it("honours an explicit override for future activation", () => {
    expect(isInstructorAvailabilityEnforced(true)).toBe(true);
    expect(isInstructorAvailabilityEnforced(false)).toBe(false);
  });
});

describe("placement with no availability rows", () => {
  it("accepts an external instructor with zero availability rows on any teaching slot", () => {
    const s = snapshot();
    const original = session({});
    for (const day of s.settings.working_days) {
      for (const start of ["08:00:00", "10:00:00", "12:00:00", "14:00:00"]) {
        const end = `${String(Number(start.slice(0, 2)) + 2).padStart(2, "0")}:00:00`;
        const candidate = session({ day_of_week: day, start_time: start, end_time: end });
        expect(feasible(s, [original], candidate, original)).toBe(true);
      }
    }
  });

  it("still rejects the same instructor in two overlapping sessions", () => {
    const original = session({});
    const busy = session({
      id: "s2",
      delivery_group_id: "g1",
      room_id: "r2",
      day_of_week: 2,
      start_time: "08:00:00",
      end_time: "10:00:00",
    });
    const s = snapshot();
    const candidate = session({ day_of_week: 2, start_time: "09:00:00", end_time: "11:00:00" });
    expect(feasible(s, [original, busy], candidate, original)).toBe(false);
  });

  it("still rejects a room clash and keeps other hard constraints", () => {
    const original = session({});
    const otherTeacher = session({
      id: "s3",
      instructor_id: "i-other",
      room_id: "r1",
      day_of_week: 3,
      start_time: "08:00:00",
      end_time: "10:00:00",
    });
    const s = snapshot();
    const candidate = session({ day_of_week: 3, start_time: "08:00:00", end_time: "10:00:00" });
    expect(feasible(s, [original, otherTeacher], candidate, original)).toBe(false);
    // outside working days is still rejected
    expect(
      feasible(s, [original], session({ day_of_week: 5 }), original),
    ).toBe(false);
  });
});

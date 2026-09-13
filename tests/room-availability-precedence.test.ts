/**
 * ROOM-AVAILABILITY-PRECEDENCE-01 — focused tests.
 * room_availability rows are the authoritative room window inside the scheduler.
 * The denormalized rooms.available_* columns are only a fallback, so a stale
 * available_end_time must not kill an otherwise valid candidate.
 */
import { describe, expect, it } from "bun:test";
import { feasible, type Session, type Snapshot } from "@/lib/auto-scheduler/compact";

const session = (over: Partial<Session>): Session =>
  ({
    id: "s1",
    updated_at: "2026-01-01T00:00:00Z",
    cohort_id: "c1",
    delivery_group_id: "g1",
    instructor_id: "i1",
    room_id: "lab1",
    teaching_assignment_id: "a1",
    day_of_week: 1,
    start_time: "08:00:00",
    end_time: "10:00:00",
    study_system: "regular",
    expected_students: 20,
    ...over,
  }) as Session;

const snapshot = (over: Partial<Snapshot> = {}): Snapshot =>
  ({
    sessions: [],
    cohorts: [
      { id: "c1", program_id: "p1", level_id: "l1", study_system: "regular", term_id: "t1" },
    ],
    groups: [
      { id: "g1", cohort_id: "c1", expected_students: 20, active: true, is_obsolete: false },
    ],
    members: [{ delivery_group_id: "g1", partition_id: "part1", cohort_id: "c1" }],
    partitions: [{ id: "part1", cohort_id: "c1", headcount: 20, active: true }],
    assignments: [{ id: "a1", required_room_type: "computer_lab", is_active: true }],
    rooms: [
      {
        id: "lab1",
        capacity: 30,
        room_type: "computer_lab",
        is_active: true,
        available_days: null,
        // Intentionally stale denormalized value (real window ends 16:00).
        available_start_time: "08:00:00",
        available_end_time: "14:00:00",
      },
      {
        id: "hall1",
        capacity: 60,
        room_type: "lecture_hall",
        is_active: true,
        available_days: null,
        available_start_time: "08:00:00",
        available_end_time: "14:00:00",
      },
    ],
    instructors: [{ id: "i1", instructor_type_id: "t-ext", max_hours_per_day: 8, is_active: true }],
    types: [{ id: "t-ext", code: "external", is_external: true }],
    availability: [],
    roomAvailability: [
      { room_id: "lab1", day_of_week: 1, start_time: "08:00:00", end_time: "16:00:00" },
      { room_id: "hall1", day_of_week: 1, start_time: "08:00:00", end_time: "14:00:00" },
    ],
    templates: [
      {
        study_system: "both",
        day_of_week: 1,
        start_time: "08:00:00",
        end_time: "16:00:00",
        is_active: true,
      },
    ],
    settings: {
      working_days: [1],
      day_start_time: "08:00:00",
      day_end_time: "16:00:00",
      slot_minutes: 60,
      max_daily_hours_per_instructor: 8,
      max_daily_hours_per_section: 8,
      break_between_sessions_min: 0,
    },
    ...over,
  }) as Snapshot;

describe("room window precedence in feasible()", () => {
  const original = session({});

  it("allows 14:00-16:00 in a lab whose room_availability ends 16:00 despite a stale column", () => {
    const s = snapshot();
    const candidate = session({ start_time: "14:00:00", end_time: "16:00:00" });
    expect(feasible(s, [original], candidate, original)).toBe(true);
  });

  it("rejects 14:00-16:00 in a hall whose room_availability window ends 14:00", () => {
    const s = snapshot({
      assignments: [{ id: "a1", required_room_type: "lecture_hall", is_active: true }],
    } as Partial<Snapshot>);
    const base = session({ room_id: "hall1" });
    const candidate = session({ room_id: "hall1", start_time: "14:00:00", end_time: "16:00:00" });
    expect(feasible(s, [base], candidate, base)).toBe(false);
  });

  it("falls back to rooms.available_* when the room has no availability rows", () => {
    const s = snapshot({ roomAvailability: [] } as Partial<Snapshot>);
    expect(
      feasible(s, [original], session({ start_time: "14:00:00", end_time: "16:00:00" }), original),
    ).toBe(false);
    expect(
      feasible(s, [original], session({ start_time: "08:00:00", end_time: "10:00:00" }), original),
    ).toBe(true);
  });

  it("keeps room overlap rejection intact inside the authoritative window", () => {
    const s = snapshot();
    const busy = session({
      id: "s2",
      instructor_id: "i1",
      room_id: "lab1",
      start_time: "14:00:00",
      end_time: "16:00:00",
    });
    const candidate = session({ start_time: "14:00:00", end_time: "16:00:00" });
    expect(feasible(s, [original, busy], candidate, original)).toBe(false);
  });
});

/**
 * JAWF-REPAIR-01 — bounded repair search for the V2 auto-scheduler.
 *
 * The repair may only relocate unlocked existing sessions through the same
 * `feasible()` predicate, so every hard constraint (room/instructor/shared
 * students overlap, capacity, room availability, room type policy, templates,
 * study-system isolation, five-day attendance) is preserved.
 */
import { describe, expect, it } from "bun:test";
import { feasible, type Session, type Snapshot } from "@/lib/auto-scheduler/compact";
import {
  applyRepairPlan,
  REPAIR_CHANGE_REASON_AR,
  type RepairPlan,
} from "@/lib/auto-scheduler/v2";
import { compareRepairPriority, planRepair } from "@/lib/auto-scheduler/repair";

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
    start_time: "09:00:00",
    end_time: "12:00:00",
    study_system: "regular",
    expected_students: 20,
    is_locked: false,
    ...over,
  }) as Session;

const baseSnapshot = (over: Partial<Snapshot> = {}): Snapshot =>
  ({
    sessions: [],
    cohorts: [
      { id: "c1", program_id: "p1", level_id: "l1", study_system: "regular", term_id: "t1" },
      { id: "c2", program_id: "p1", level_id: "l2", study_system: "regular", term_id: "t1" },
    ],
    groups: [
      { id: "g1", cohort_id: "c1", expected_students: 20, active: true, is_obsolete: false },
      { id: "g2", cohort_id: "c2", expected_students: 20, active: true, is_obsolete: false },
    ],
    members: [
      { delivery_group_id: "g1", partition_id: "p-c1", cohort_id: "c1" },
      { delivery_group_id: "g2", partition_id: "p-c2", cohort_id: "c2" },
    ],
    partitions: [
      { id: "p-c1", cohort_id: "c1", headcount: 20, active: true },
      { id: "p-c2", cohort_id: "c2", headcount: 20, active: true },
    ],
    assignments: [
      { id: "a1", required_room_type: "computer_lab", is_active: true },
      { id: "a2", required_room_type: "lecture_hall", is_active: true },
    ],
    rooms: [
      {
        id: "lab1",
        capacity: 30,
        room_type: "computer_lab",
        is_active: true,
        available_days: null,
        available_start_time: "08:00:00",
        available_end_time: "16:00:00",
      },
      {
        id: "hall1",
        capacity: 60,
        room_type: "lecture_hall",
        is_active: true,
        available_days: null,
        available_start_time: "08:00:00",
        available_end_time: "16:00:00",
      },
    ],
    instructors: [{ id: "i1", instructor_type_id: "t1", max_hours_per_day: 8, is_active: true }],
    types: [{ id: "t1", code: "internal", is_external: false }],
    availability: [],
    roomAvailability: [],
    templates: [
      {
        study_system: "both",
        day_of_week: 1,
        start_time: "09:00:00",
        end_time: "13:00:00",
        is_active: true,
      },
      {
        study_system: "both",
        day_of_week: 2,
        start_time: "09:00:00",
        end_time: "13:00:00",
        is_active: true,
      },
    ],
    settings: {
      working_days: [1, 2],
      day_start_time: "09:00:00",
      day_end_time: "13:00:00",
      slot_minutes: 60,
      max_daily_hours_per_instructor: 8,
      max_daily_hours_per_section: 8,
      break_between_sessions_min: 0,
    },
    ...over,
  }) as Snapshot;

const missing3h = session({ id: "repair:missing", start_time: "00:00:00", end_time: "03:00:00" });
const slots1h = (day: number, starts: string[]) =>
  starts.map((start) => ({
    day,
    start,
    end: `${String(Number(start.slice(0, 2)) + 3).padStart(2, "0")}:00:00`,
  }));

describe("planRepair — 1-hop relocation", () => {
  it("relocates one movable 2h blocker to free a 3h block", () => {
    const blocker = session({
      id: "b1",
      teaching_assignment_id: "a2",
      room_id: "hall1",
      cohort_id: "c2",
      delivery_group_id: "g2",
      day_of_week: 1,
      start_time: "10:00:00",
      end_time: "12:00:00",
    });
    const snapshot = baseSnapshot({ sessions: [blocker] });
    const plan = planRepair({
      snapshot,
      sessions: [blocker],
      missing: missing3h,
      targetSlots: slots1h(1, ["09:00:00", "10:00:00"]),
      roomIds: ["lab1", "hall1"],
    });
    expect(plan).not.toBeNull();
    expect(plan!.moves.length).toBe(1);
    expect(plan!.moves[0].sessionId).toBe("b1");
    expect(plan!.depth).toBe(1);
    expect(plan!.placement.room_id).toBe("lab1");

    // The whole resulting layout must satisfy every hard constraint.
    const moved = { ...blocker, ...plan!.moves[0].to };
    const placedMissing = { ...missing3h, ...plan!.placement };
    const after = [moved, placedMissing];
    expect(feasible(snapshot, after, placedMissing, missing3h)).toBe(true);
    expect(feasible(snapshot, after, moved, blocker)).toBe(true);
  });

  it("never moves a locked blocker", () => {
    const blocker = session({
      id: "b1",
      teaching_assignment_id: "a2",
      room_id: "hall1",
      cohort_id: "c2",
      delivery_group_id: "g2",
      start_time: "10:00:00",
      end_time: "12:00:00",
      is_locked: true,
    });
    const snapshot = baseSnapshot({ sessions: [blocker] });
    const plan = planRepair({
      snapshot,
      sessions: [blocker],
      missing: missing3h,
      targetSlots: slots1h(1, ["09:00:00", "10:00:00"]),
      roomIds: ["lab1", "hall1"],
    });
    expect(plan).toBeNull();
  });

  it("returns null when the blocker has no legal alternative", () => {
    // Single working day, single room family: nothing can move anywhere.
    const blocker = session({
      id: "b1",
      teaching_assignment_id: "a2",
      room_id: "hall1",
      cohort_id: "c2",
      delivery_group_id: "g2",
      start_time: "10:00:00",
      end_time: "12:00:00",
    });
    const snapshot = baseSnapshot({
      sessions: [blocker],
      working_days: undefined,
      templates: [
        {
          study_system: "both",
          day_of_week: 1,
          start_time: "10:00:00",
          end_time: "12:00:00",
          is_active: true,
        },
      ],
      settings: {
        working_days: [1],
        day_start_time: "10:00:00",
        day_end_time: "12:00:00",
        slot_minutes: 60,
        max_daily_hours_per_instructor: 8,
        max_daily_hours_per_section: 8,
        break_between_sessions_min: 0,
      },
    } as Partial<Snapshot>);
    const plan = planRepair({
      snapshot,
      sessions: [blocker],
      missing: session({
        id: "repair:missing",
        start_time: "00:00:00",
        end_time: "02:00:00",
      }),
      targetSlots: [{ day: 1, start: "10:00:00", end: "12:00:00" }],
      roomIds: ["lab1", "hall1"],
    });
    expect(plan).toBeNull();
  });
});

describe("planRepair — bounded 2-hop", () => {
  it("relocates two blockers when a single hop is not enough", () => {
    const b1 = session({
      id: "b1",
      teaching_assignment_id: "a2",
      room_id: "hall1",
      cohort_id: "c2",
      delivery_group_id: "g2",
      day_of_week: 1,
      start_time: "09:00:00",
      end_time: "10:00:00",
    });
    const b2 = session({
      id: "b2",
      teaching_assignment_id: "a2",
      room_id: "hall1",
      cohort_id: "c2",
      delivery_group_id: "g2",
      day_of_week: 1,
      start_time: "11:00:00",
      end_time: "12:00:00",
    });
    const snapshot = baseSnapshot({ sessions: [b1, b2] });
    const plan = planRepair({
      snapshot,
      sessions: [b1, b2],
      missing: missing3h,
      targetSlots: [{ day: 1, start: "09:00:00", end: "12:00:00" }],
      roomIds: ["lab1", "hall1"],
    });
    expect(plan).not.toBeNull();
    expect(plan!.moves.length).toBe(2);
    expect(plan!.depth).toBe(2);
    const placedMissing = { ...missing3h, ...plan!.placement };
    const after = [
      { ...b1, ...plan!.moves.find((m) => m.sessionId === "b1")!.to },
      { ...b2, ...plan!.moves.find((m) => m.sessionId === "b2")!.to },
      placedMissing,
    ];
    expect(feasible(snapshot, after, placedMissing, missing3h)).toBe(true);
    for (const original of [b1, b2]) {
      const moved = after.find((x) => x.id === original.id)!;
      expect(feasible(snapshot, after, moved, original)).toBe(true);
    }
  });

  it("respects the attempt budget instead of exploding", () => {
    const b1 = session({
      id: "b1",
      teaching_assignment_id: "a2",
      room_id: "hall1",
      cohort_id: "c2",
      delivery_group_id: "g2",
      start_time: "10:00:00",
      end_time: "12:00:00",
    });
    const stats = { attempts: 0 };
    const plan = planRepair({
      snapshot: baseSnapshot({ sessions: [b1] }),
      sessions: [b1],
      missing: missing3h,
      targetSlots: slots1h(1, ["09:00:00", "10:00:00"]),
      roomIds: ["lab1", "hall1"],
      budget: { maxAttempts: 1 },
      stats,
    });
    expect(plan).toBeNull();
    expect(stats.attempts).toBeGreaterThan(0);
    expect(stats.attempts).toBeLessThanOrEqual(2);
  });
});

describe("applyRepairPlan — fail-safe application", () => {
  const plan: RepairPlan = {
    moves: [
      {
        sessionId: "b1",
        updatedAt: "2026-01-01T00:00:00Z",
        from: {
          day_of_week: 1,
          start_time: "10:00:00",
          end_time: "12:00:00",
          room_id: "hall1",
        },
        to: { day_of_week: 2, start_time: "09:00:00", end_time: "11:00:00", room_id: "hall1" },
      },
    ],
    placement: {
      day_of_week: 1,
      start_time: "10:00:00",
      end_time: "13:00:00",
      room_id: "lab1",
    },
    depth: 1,
    attempts: 12,
  };

  const okMove = () => ({
    ok: true,
    code: null,
    stale: false,
    message_ar: null,
    blocking_conflicts: [],
    warnings: [],
    approved_exceptions: [],
    session: { id: "b1", updated_at: "2026-01-01T01:00:00Z" },
  });

  it("creates the missing session after a successful relocation", async () => {
    const moves: unknown[] = [];
    const result = await applyRepairPlan({
      scheduleVersionId: "v1",
      teachingAssignmentId: "a1",
      plan,
      versionUpdatedAt: "2026-01-01T00:00:00Z",
      note: "auto-repair",
      moveSession: (async (pending: unknown) => {
        moves.push(pending);
        return okMove();
      }) as never,
      createSession: (async () => ({
        ok: true,
        code: null,
        stale: false,
        message_ar: null,
        blocking_conflicts: [],
        warnings: [],
        session: { id: "new-session" },
        schedule_version_updated_at: "2026-01-01T02:00:00Z",
        scheduling_summary: null,
      })) as never,
      readVersion: async () => "2026-01-01T01:30:00Z",
    });
    expect(result.ok).toBe(true);
    expect(result.rolledBack).toBe(false);
    expect(result.versionUpdatedAt).toBe("2026-01-01T02:00:00Z");
    expect(moves.length).toBe(1);
    expect((moves[0] as { changeReason: string }).changeReason).toBe(REPAIR_CHANGE_REASON_AR);
  });

  it("rolls the relocation back when the placement fails", async () => {
    const calls: Array<{ sessionId: string; proposed: { start_time: string } }> = [];
    const result = await applyRepairPlan({
      scheduleVersionId: "v1",
      teachingAssignmentId: "a1",
      plan,
      versionUpdatedAt: "2026-01-01T00:00:00Z",
      note: "auto-repair",
      moveSession: (async (pending: {
        sessionId: string;
        proposed: { start_time: string };
      }) => {
        calls.push(pending);
        return okMove();
      }) as never,
      createSession: (async () => ({
        ok: false,
        code: "ROOM_CONFLICT",
        stale: false,
        message_ar: "تعارض قاعة",
        blocking_conflicts: [],
        warnings: [],
        session: null,
        schedule_version_updated_at: null,
        scheduling_summary: null,
      })) as never,
      readVersion: async () => "2026-01-01T01:30:00Z",
    });
    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.reason).toBe("تعارض قاعة");
    expect(calls.length).toBe(2);
    // The rollback puts the session back exactly where it started.
    expect(calls[1].proposed.start_time).toBe("10:00:00");
  });

  it("rolls back and reports when a relocation itself fails", async () => {
    const result = await applyRepairPlan({
      scheduleVersionId: "v1",
      teachingAssignmentId: "a1",
      plan,
      versionUpdatedAt: "2026-01-01T00:00:00Z",
      note: "auto-repair",
      moveSession: (async () => ({
        ok: false,
        code: "INSTRUCTOR_CONFLICT",
        stale: false,
        message_ar: "تعارض مدرس",
        blocking_conflicts: [],
        warnings: [],
        approved_exceptions: [],
        session: null,
      })) as never,
      createSession: (async () => {
        throw new Error("must not be called");
      }) as never,
      readVersion: async () => "2026-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("تعارض مدرس");
  });
});

describe("hardest-first ordering", () => {
  it("puts long blocks before flexible short ones", () => {
    const order = [
      { durationMinutes: 120, candidateCount: 4 },
      { durationMinutes: 180, candidateCount: 9 },
      { durationMinutes: 180, candidateCount: 2 },
    ].sort(compareRepairPriority);
    expect(order.map((x) => `${x.durationMinutes}/${x.candidateCount}`)).toEqual([
      "180/2",
      "180/9",
      "120/4",
    ]);
  });
});

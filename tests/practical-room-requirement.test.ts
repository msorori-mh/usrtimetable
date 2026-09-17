/**
 * JAWF-PRACTICAL-LAB-CANDIDATE-01
 *
 * Root cause captured: candidate generation built its room pools from
 * `plan_course_components.required_room_type_id` (stale `lecture_hall`) while the
 * guarded RPC and `feasible()` enforce `teaching_assignments.required_room_type`
 * (`computer_lab`). Every legal computer lab was therefore dropped before the
 * server was asked, and the run reported "no candidate" for practical level-4
 * sessions even though free labs existed.
 */
import { describe, expect, it } from "bun:test";
import { resolveRoomRequirement } from "@/lib/auto-scheduler/room-requirement";
import {
  partitionCandidateRoomsByRank,
  roomCandidateRank,
  type RoomLite,
} from "@/lib/auto-scheduler/session-plan";
import { feasible, type Session, type Snapshot } from "@/lib/auto-scheduler/compact";

const roomTypeCodeById = {
  "rt-hall": "lecture_hall",
  "rt-lab": "computer_lab",
} as const;

const lab: RoomLite = { id: "lab-1", capacity: 39, room_type: "computer_lab" };
const smallLab: RoomLite = { id: "lab-small", capacity: 10, room_type: "computer_lab" };
const hall: RoomLite = { id: "hall-1", capacity: 60, room_type: "lecture_hall" };

describe("practical room requirement resolution", () => {
  it("prefers the assignment's required room type over a stale plan component", () => {
    expect(
      resolveRoomRequirement({
        assignmentRequiredRoomType: "computer_lab",
        componentRoomTypeId: "rt-hall",
        planCourseRoomType: "lecture_hall",
      }),
    ).toEqual({ roomTypeName: "computer_lab", roomTypeId: null });
  });

  it("falls back to the plan component, then the plan course", () => {
    expect(resolveRoomRequirement({ componentRoomTypeId: "rt-lab" })).toEqual({
      roomTypeName: null,
      roomTypeId: "rt-lab",
    });
    expect(resolveRoomRequirement({ planCourseRoomType: "lecture_hall" })).toEqual({
      roomTypeName: "lecture_hall",
      roomTypeId: null,
    });
    expect(resolveRoomRequirement({})).toEqual({ roomTypeName: null, roomTypeId: null });
  });

  it("makes the previously dropped computer lab a preferred candidate", () => {
    const resolved = resolveRoomRequirement({
      assignmentRequiredRoomType: "computer_lab",
      componentRoomTypeId: "rt-hall",
    });
    const pools = partitionCandidateRoomsByRank([hall, lab], {
      roomTypeId: resolved.roomTypeId,
      roomTypeName: resolved.roomTypeName,
      componentType: "practical",
      expectedStudents: 28,
      roomTypeCodeById,
    });
    expect(pools.preferred.map((r) => r.id)).toEqual(["lab-1"]);
    expect(pools.fallback.map((r) => r.id)).toEqual(["hall-1"]);

    // The old resolution order produced hall-only pools — the reported failure.
    const stale = partitionCandidateRoomsByRank([hall, lab], {
      roomTypeId: "rt-hall",
      componentType: "practical",
      expectedStudents: 28,
      roomTypeCodeById,
    });
    expect(stale.preferred.map((r) => r.id)).toEqual(["hall-1"]);
    expect(stale.fallback).toHaveLength(0);
  });

  it("keeps capacity and room-type hard rules blocking illegal candidates", () => {
    const req = {
      roomTypeName: "computer_lab",
      componentType: "practical",
      expectedStudents: 28,
      roomTypeCodeById,
    };
    expect(roomCandidateRank(smallLab, req)).toBeNull();
    expect(
      roomCandidateRank(lab, {
        roomTypeName: "lecture_hall",
        componentType: "theory",
        expectedStudents: 28,
        roomTypeCodeById,
      }),
    ).toBeNull();
  });
});

const session = (over: Partial<Session> = {}): Session => ({
  id: "s1",
  updated_at: "",
  cohort_id: "c1",
  delivery_group_id: "g1",
  instructor_id: "i1",
  teaching_assignment_id: "a1",
  room_id: "lab-1",
  day_of_week: 1,
  start_time: "08:00:00",
  end_time: "10:00:00",
  study_system: "regular",
  expected_students: 28,
  is_locked: false,
  ...over,
});

const snapshot = (sessions: Session[]): Snapshot =>
  ({
    sessions,
    cohorts: [{ id: "c1", program_id: "p", level_id: "l4", study_system: "regular", term_id: "t" }],
    groups: [{ id: "g1", cohort_id: "c1", expected_students: 28 }],
    members: [{ delivery_group_id: "g1", partition_id: "part1", cohort_id: "c1" }],
    partitions: [{ id: "part1", cohort_id: "c1", headcount: 28, active: true }],
    assignments: [
      {
        id: "a1",
        required_room_type: "computer_lab",
        is_active: true,
        plan_course_component_id: "cmp1",
      },
    ],
    components: [{ id: "cmp1", component_type: "practical" }],
    rooms: [
      {
        ...lab,
        is_active: true,
        available_days: [1],
        available_start_time: "08:00:00",
        available_end_time: "16:00:00",
      },
      {
        ...hall,
        is_active: true,
        available_days: [1],
        available_start_time: "08:00:00",
        available_end_time: "14:00:00",
      },
    ],
    instructors: [{ id: "i1", instructor_type_id: "permanent", max_hours_per_day: 8 }],
    types: [{ id: "permanent", code: "permanent", is_external: false }],
    availability: [],
    roomAvailability: [],
    roomUnavailability: [],
    templates: [1].map((day) => ({
      day_of_week: day,
      start_time: "08:00:00",
      end_time: "16:00:00",
      study_system: "both",
      is_active: true,
    })),
    settings: {
      working_days: [0, 1, 2, 3, 4, 6],
      day_start_time: "08:00:00",
      day_end_time: "16:00:00",
      slot_minutes: 60,
      max_daily_hours_per_instructor: 8,
      max_daily_hours_per_section: 8,
      break_between_sessions_min: 0,
    },
  }) as unknown as Snapshot;

describe("feasible() accepts the lab candidate and still enforces hard constraints", () => {
  it("accepts a free computer lab for the practical session", () => {
    const candidate = session();
    expect(feasible(snapshot([]), [], candidate, candidate)).toBe(true);
  });

  it("blocks a busy room, a busy instructor and shared students", () => {
    const candidate = session();
    const busyRoom = session({ id: "x1", teaching_assignment_id: "a1", instructor_id: "i2" });
    expect(feasible(snapshot([busyRoom]), [busyRoom], candidate, candidate)).toBe(false);
    const busyInstructor = session({ id: "x2", room_id: "hall-1" });
    expect(feasible(snapshot([busyInstructor]), [busyInstructor], candidate, candidate)).toBe(
      false,
    );
  });

  it("blocks a lab outside its approved opening hours", () => {
    const late = session({ start_time: "16:00:00", end_time: "18:00:00" });
    expect(feasible(snapshot([]), [], late, late)).toBe(false);
  });

  it("blocks an oversized group in a small lab", () => {
    const s = snapshot([]);
    const big = session({ expected_students: 100 });
    expect(feasible(s, [], big, big)).toBe(false);
  });
});

/**
 * Production reproduction (draft c5350abf, level-4 practical work):
 * every lecture hall is taken for the whole teaching day while a free computer
 * lab exists. Ranking over the stale plan room type returns zero candidates —
 * the reported "no candidate satisfies the delivery group / cohort constraints" —
 * while ranking over the assignment's own room type finds the legal lab slot.
 */
describe("candidate generation over the production shape", () => {
  const blockedHall = (): Snapshot => {
    const busyHall = session({
      id: "other",
      room_id: "hall-1",
      instructor_id: "i2",
      cohort_id: "c2",
      delivery_group_id: "g2",
      teaching_assignment_id: "a2",
      start_time: "08:00:00",
      end_time: "16:00:00",
    });
    const s = snapshot([busyHall]) as Snapshot & {
      cohorts: unknown[];
      groups: unknown[];
      members: unknown[];
      partitions: unknown[];
      assignments: unknown[];
      instructors: unknown[];
    };
    s.cohorts.push({
      id: "c2",
      program_id: "p2",
      level_id: "l4",
      study_system: "regular",
      term_id: "t",
    });
    s.groups.push({ id: "g2", cohort_id: "c2", expected_students: 30 });
    s.partitions.push({ id: "part2", cohort_id: "c2", headcount: 30, active: true });
    s.members.push({ delivery_group_id: "g2", partition_id: "part2", cohort_id: "c2" });
    s.assignments.push({ id: "a2", required_room_type: "lecture_hall", is_active: true });
    s.instructors.push({ id: "i2", instructor_type_id: "permanent", max_hours_per_day: 8 });
    return s;
  };

  const rank = (roomIds: string[]) => {
    const s = blockedHall();
    return rankGenerationCandidates({
      snapshot: s,
      sessions: [...s.sessions],
      session: session(),
      slots: compactSlots({ ...s, sessions: [...s.sessions] }, session()),
      roomIds,
    });
  };

  const poolFor = (sources: Parameters<typeof resolveRoomRequirement>[0]) => {
    const resolved = resolveRoomRequirement(sources);
    const pools = partitionCandidateRoomsByRank([hall, lab], {
      roomTypeId: resolved.roomTypeId,
      roomTypeName: resolved.roomTypeName,
      componentType: "practical",
      expectedStudents: 28,
      roomTypeCodeById,
    });
    return [...pools.preferred, ...pools.fallback].map((r) => r.id);
  };

  it("found no candidate while the stale plan room type drove the pool", () => {
    const staleIds = poolFor({ componentRoomTypeId: "rt-hall" });
    expect(staleIds).toEqual(["hall-1"]);
    expect(rank(staleIds)).toHaveLength(0);
  });

  it("finds the legal lab candidate once the assignment room type drives the pool", () => {
    const fixedIds = poolFor({
      assignmentRequiredRoomType: "computer_lab",
      componentRoomTypeId: "rt-hall",
    });
    expect(fixedIds).toEqual(["lab-1", "hall-1"]);
    const ranked = rank(fixedIds);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]!.session.room_id).toBe("lab-1");
    expect(
      generationDomainSize({
        snapshot: blockedHall(),
        sessions: blockedHall().sessions,
        session: session(),
        slots: compactSlots(blockedHall(), session()),
        roomIds: fixedIds,
      }),
    ).toBeGreaterThan(0);
  });
});

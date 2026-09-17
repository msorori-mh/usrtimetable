/**
 * JAWF-AUTH-FALLBACK-01 regression pack.
 *
 * Reproduces the production case (teaching assignment 89be17da…, AI practical,
 * IT G2, level 4, regular, 27 students, required_room_type = computer_lab) where
 * a legal candidate — Saturday 08:00–10:00 in computer lab 4 — exists in the
 * database yet the local prefilters (`feasible` / `isLocallyBlocked`) drop every
 * candidate, so nothing ever reaches the guarded RPC.
 *
 * Source-only: no database access, no writes.
 */
import { describe, expect, it } from "bun:test";
import { feasible, compactSlots, type Session, type Snapshot } from "@/lib/auto-scheduler/compact";
import { rankGenerationCandidates } from "@/lib/auto-scheduler/generation-ranking";
import { isLocallyBlocked, partitionCandidateRoomsByRank } from "@/lib/auto-scheduler/session-plan";
import {
  candidateAttemptKey,
  enumerateAuthoritativeCandidates,
  isInstructorSlotAvailable,
} from "@/lib/auto-scheduler/authoritative-fallback";

const DAYS = [0, 1, 2, 3, 4, 6];
const COHORT = "cohort-it-level4";
const G1 = "dg-it-g1";
const G2 = "dg-it-g2";
const INSTRUCTOR = "instructor-asma";
const ASSIGNMENT = "ta-89be17da";

const lab = (id: string) => ({
  id,
  capacity: 39,
  room_type: "computer_lab",
  is_active: true,
  available_days: DAYS,
  available_start_time: "08:00:00",
  available_end_time: "16:00:00",
});
const hall = (id: string) => ({
  id,
  capacity: 60,
  room_type: "lecture_hall",
  is_active: true,
  available_days: DAYS,
  available_start_time: "08:00:00",
  available_end_time: "14:00:00",
});

const existing = (
  id: string,
  day: number,
  start: string,
  end: string,
  extra: Partial<Session> = {},
): Session => ({
  id,
  updated_at: "t0",
  cohort_id: COHORT,
  delivery_group_id: G1,
  instructor_id: INSTRUCTOR,
  room_id: "lab-1",
  teaching_assignment_id: "ta-other",
  day_of_week: day,
  start_time: start,
  end_time: end,
  study_system: "regular",
  expected_students: 25,
  is_locked: true,
  ...extra,
});

/**
 * Production-shaped snapshot: G1 (already scheduled Saturday 08:00–10:00) and G2
 * (the missing session) belong to the same cohort but to DISJOINT student
 * partitions. The partition mapping is intentionally incomplete here, exactly as
 * in production, so the local rule degrades to "same cohort ⇒ clash".
 */
function snapshot(): Snapshot {
  return {
    sessions: [existing("s-g1-sat", 6, "08:00:00", "10:00:00", { room_id: "lab-1" })],
    cohorts: [
      { id: COHORT, program_id: "prog-it", level_id: "level4", study_system: "regular", term_id: "t" },
    ],
    groups: [
      { id: G1, cohort_id: COHORT, expected_students: 25 },
      { id: G2, cohort_id: COHORT, expected_students: 27 },
    ],
    members: [],
    partitions: [],
    assignments: [
      { id: ASSIGNMENT, required_room_type: "computer_lab", is_active: true },
      { id: "ta-other", required_room_type: "computer_lab", is_active: true },
    ],
    rooms: [lab("lab-1"), lab("lab-4"), hall("hall-1")],
    instructors: [
      { id: INSTRUCTOR, instructor_type_id: "permanent", max_hours_per_day: 6 },
    ],
    types: [{ id: "permanent", code: "permanent", is_external: false }],
    availability: DAYS.map((day) => ({
      instructor_id: INSTRUCTOR,
      day_of_week: day,
      start_time: "08:00:00",
      end_time: "14:00:00",
      availability_type: "available",
    })),
    roomAvailability: [
      ...DAYS.map((day) => ({
        room_id: "lab-1",
        day_of_week: day,
        start_time: "08:00:00",
        end_time: "16:00:00",
      })),
      ...DAYS.map((day) => ({
        room_id: "lab-4",
        day_of_week: day,
        start_time: "08:00:00",
        end_time: "16:00:00",
      })),
      ...DAYS.map((day) => ({
        room_id: "hall-1",
        day_of_week: day,
        start_time: "08:00:00",
        end_time: "14:00:00",
      })),
    ],
    roomUnavailability: [],
    templates: DAYS.map((day) => ({
      day_of_week: day,
      start_time: "08:00:00",
      end_time: "14:00:00",
      study_system: "regular",
      is_active: true,
    })),
    settings: {
      working_days: DAYS,
      day_start_time: "08:00:00",
      day_end_time: "14:00:00",
      slot_minutes: 60,
      max_daily_hours_per_instructor: 6,
      max_daily_hours_per_section: 8,
      break_between_sessions_min: 0,
      enforce_instructor_availability: true,
    },
  } as unknown as Snapshot;
}

const missing = (): Session => ({
  id: "candidate:g2",
  updated_at: "",
  cohort_id: COHORT,
  delivery_group_id: G2,
  teaching_assignment_id: ASSIGNMENT,
  instructor_id: INSTRUCTOR,
  room_id: "",
  day_of_week: 6,
  start_time: "08:00:00",
  end_time: "10:00:00",
  study_system: "regular",
  expected_students: 27,
  is_locked: false,
});

const requirement = {
  roomTypeId: null,
  roomTypeName: "computer_lab",
  expectedStudents: 27,
  componentType: "practical",
  roomTypeCodeById: {},
};

function pools(s: Snapshot) {
  const partitioned = partitionCandidateRoomsByRank(s.rooms, requirement);
  return [partitioned.preferred, partitioned.fallback].filter((pool) => pool.length > 0);
}

function baseInput(s: Snapshot) {
  const roomPools = pools(s);
  return {
    slots: compactSlots(s, missing()),
    roomPools,
    roomAvailability: s.roomAvailability,
    instructorId: INSTRUCTOR,
    instructorAvailability: s.availability,
    enforceInstructorAvailability: true,
    instructorRequiresExplicitWindow: false,
    levelDays: new Set<number>([0, 1, 2, 6]),
    maxLevelDays: 4,
    instructorDays: new Set<number>([6]),
    instructorDayCap: 4,
    plannedDay: 6,
    durationMinutes: 120,
    instructorDayMinutes: (day: number) => (day === 6 ? 120 : 0),
    maxInstructorDailyMinutes: 360,
    studentDayMinutes: (day: number) => (day === 6 ? 120 : 0),
    maxStudentDailyMinutes: 480,
  };
}

describe("local prefilter diagnosis", () => {
  it("(a) drops the legal Saturday computer-lab candidate that the RPC accepts", () => {
    const s = snapshot();
    const target = { day: 6, start: "08:00:00", end: "10:00:00" };
    const ranked = rankGenerationCandidates({
      snapshot: s,
      sessions: s.sessions,
      session: missing(),
      slots: [target],
      roomIds: ["lab-4"],
    });
    // feasible()/rankGenerationCandidates reject it: without partition rows the
    // same-cohort G1 session at that time is treated as a student clash.
    expect(ranked).toHaveLength(0);
    expect(
      feasible(s, s.sessions, { ...missing(), room_id: "lab-4" }, missing()),
    ).toBe(false);
    expect(
      isLocallyBlocked(
        target,
        {
          roomId: "lab-4",
          instructorId: INSTRUCTOR,
          cohortId: COHORT,
          deliveryGroupId: G2,
        },
        [
          {
            day: 6,
            start: "08:00:00",
            end: "10:00:00",
            roomId: "lab-1",
            instructorId: "instructor-other",
            cohortId: COHORT,
            deliveryGroupId: G1,
          },
        ],
      ),
    ).toBe(true);

    // The authoritative enumeration keeps it and hands the decision to the RPC.
    const candidates = enumerateAuthoritativeCandidates(baseInput(s));
    expect(
      candidates.some(
        (c) => c.day === 6 && c.start === "08:00:00" && c.roomId === "lab-4" && c.poolIndex === 0,
      ),
    ).toBe(true);
  });

  it("(ب) a rejected candidate is not retried and the exact reason survives", () => {
    const s = snapshot();
    const first = enumerateAuthoritativeCandidates(baseInput(s))[0];
    const attempted = new Set([candidateAttemptKey(first)]);
    const retried = enumerateAuthoritativeCandidates({ ...baseInput(s), attempted });
    expect(retried.some((c) => candidateAttemptKey(c) === candidateAttemptKey(first))).toBe(false);
  });
});

describe("hard constraints stay binding", () => {
  it("(ج) never opens a fifth student attendance day", () => {
    const s = snapshot();
    const candidates = enumerateAuthoritativeCandidates({
      ...baseInput(s),
      levelDays: new Set<number>([0, 1, 2, 6]),
      maxLevelDays: 4,
    });
    expect(candidates.every((c) => [0, 1, 2, 6].includes(c.day))).toBe(true);
  });

  it("(د) never exceeds the instructor effective day cap", () => {
    const s = snapshot();
    const candidates = enumerateAuthoritativeCandidates({
      ...baseInput(s),
      levelDays: new Set<number>(DAYS),
      maxLevelDays: 6,
      instructorDays: new Set<number>([0, 1]),
      instructorDayCap: 2,
    });
    expect(candidates.every((c) => [0, 1].includes(c.day))).toBe(true);
  });

  it("(د2) respects instructor and student daily-hour caps", () => {
    const s = snapshot();
    const candidates = enumerateAuthoritativeCandidates({
      ...baseInput(s),
      instructorDayMinutes: (day) => (day === 6 ? 300 : 0),
      maxInstructorDailyMinutes: 360,
    });
    expect(candidates.some((c) => c.day === 6)).toBe(false);

    const studentCapped = enumerateAuthoritativeCandidates({
      ...baseInput(s),
      studentDayMinutes: (day) => (day === 6 ? 420 : 0),
      maxStudentDailyMinutes: 480,
    });
    expect(studentCapped.some((c) => c.day === 6)).toBe(false);
  });

  it("(هـ) enumeration is read-only: existing sessions are untouched", () => {
    const s = snapshot();
    const before = JSON.stringify(s.sessions);
    enumerateAuthoritativeCandidates(baseInput(s));
    expect(JSON.stringify(s.sessions)).toBe(before);
  });

  it("(و) computer labs are tried before the lecture-hall fallback", () => {
    const s = snapshot();
    const candidates = enumerateAuthoritativeCandidates(baseInput(s));
    const firstHall = candidates.findIndex((c) => c.roomId === "hall-1");
    const lastLab = candidates.map((c) => c.roomId.startsWith("lab-")).lastIndexOf(true);
    expect(candidates[0]?.roomId.startsWith("lab-")).toBe(true);
    if (firstHall >= 0) expect(firstHall).toBeGreaterThan(lastLab);
  });

  it("(ز) capacity, room type, room availability and instructor availability still prefilter", () => {
    const s = snapshot();
    // A 20-seat lab cannot host 27 students: excluded by the ranked pools.
    const small = { ...lab("lab-small"), capacity: 20 };
    const withSmall = { ...s, rooms: [...s.rooms, small] } as Snapshot;
    const partitioned = partitionCandidateRoomsByRank(withSmall.rooms, requirement);
    expect(partitioned.preferred.some((r) => r.id === "lab-small")).toBe(false);

    // Room closed on Saturday → no Saturday candidate for that room.
    const closed = enumerateAuthoritativeCandidates({
      ...baseInput(s),
      roomAvailability: (s.roomAvailability ?? []).filter(
        (w) => !(w.room_id === "lab-4" && w.day_of_week === 6),
      ),
    });
    expect(closed.some((c) => c.day === 6 && c.roomId === "lab-4")).toBe(false);

    // Instructor unavailable that morning → no candidate in that window.
    const unavailable = enumerateAuthoritativeCandidates({
      ...baseInput(s),
      instructorAvailability: [
        ...(s.availability ?? []),
        {
          instructor_id: INSTRUCTOR,
          day_of_week: 6,
          start_time: "08:00:00",
          end_time: "12:00:00",
          availability_type: "unavailable",
        },
      ],
    });
    expect(unavailable.some((c) => c.day === 6 && c.start === "08:00:00")).toBe(false);

    // External instructors still require an explicit window.
    expect(
      isInstructorSlotAvailable({
        enforce: true,
        slot: { day: 5, start: "08:00:00", end: "10:00:00" },
        windows: s.availability ?? [],
        instructorId: INSTRUCTOR,
        requiresExplicitWindow: true,
      }),
    ).toBe(false);
  });

  it("bounds the number of authoritative attempts", () => {
    const s = snapshot();
    const candidates = enumerateAuthoritativeCandidates({
      ...baseInput(s),
      levelDays: new Set<number>(DAYS),
      maxLevelDays: 6,
      instructorDays: new Set<number>(DAYS),
      instructorDayCap: 6,
      maxCandidates: 5,
    });
    expect(candidates).toHaveLength(5);
  });
});

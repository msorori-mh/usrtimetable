/**
 * JAWF-SESSION-DURATION-01 — weekly cadence for the V2 auto-scheduler.
 * Pure-module tests: no DB access, no writes, no production data.
 */
import { describe, expect, test } from "bun:test";
import {
  cadenceFamilyForComponent,
  filterCandidateRooms,
  isLocallyBlocked,
  nonconformingWarningAr,
  orderSlotsByDistinctDay,
  planRemainingSessions,
  requiredCadenceForComponent,
  sessionHours,
  splitHoursIntoSessions,
} from "../src/lib/auto-scheduler/session-plan";

const theory4Plan = {
  lectures_per_week: 2,
  lecture_session_duration: 2,
  labs_per_week: 0,
  lab_session_duration: 2,
};

const practical4Plan = {
  lectures_per_week: 0,
  lecture_session_duration: 2,
  labs_per_week: 2,
  lab_session_duration: 2,
};

const mixedPlan = {
  lectures_per_week: 1,
  lecture_session_duration: 2,
  labs_per_week: 1,
  lab_session_duration: 2,
};

const theory3Plan = {
  lectures_per_week: 1,
  lecture_session_duration: 3,
  labs_per_week: 0,
  lab_session_duration: 2,
};

describe("required plan cadence", () => {
  test("theory 4h becomes 2 weekly sessions of 2h", () => {
    const cadence = requiredCadenceForComponent({
      componentType: "theory",
      assignedHours: 4,
      planCourse: theory4Plan,
    });
    expect(cadence.durations).toEqual([2, 2]);
    expect(cadence.source).toBe("plan");
    expect(cadence.noteAr).toBeNull();
  });

  test("practical-only 4h becomes 2 weekly sessions of 2h", () => {
    const cadence = requiredCadenceForComponent({
      componentType: "practical",
      assignedHours: 4,
      planCourse: practical4Plan,
    });
    expect(cadence.durations).toEqual([2, 2]);
    expect(cadence.source).toBe("plan");
  });

  test("mixed course gives one 2h theory session and one 2h practical session", () => {
    const theory = requiredCadenceForComponent({
      componentType: "theory",
      assignedHours: 2,
      planCourse: mixedPlan,
    });
    const practical = requiredCadenceForComponent({
      componentType: "practical",
      assignedHours: 2,
      planCourse: mixedPlan,
    });
    expect(theory.durations).toEqual([2]);
    expect(practical.durations).toEqual([2]);
  });

  test("pure theory 3h stays a single 3h session", () => {
    const cadence = requiredCadenceForComponent({
      componentType: "theory",
      assignedHours: 3,
      planCourse: theory3Plan,
    });
    expect(cadence.durations).toEqual([3]);
    expect(cadence.source).toBe("plan");
  });

  test("tutorial uses the lecture cadence, practical uses the lab cadence", () => {
    expect(cadenceFamilyForComponent("tutorial")).toBe("lecture");
    expect(cadenceFamilyForComponent("practical")).toBe("lab");
    expect(cadenceFamilyForComponent(null)).toBe("lecture");
  });

  test("inconsistent or missing plan pattern derives blocks and reports why", () => {
    const mismatch = requiredCadenceForComponent({
      componentType: "theory",
      assignedHours: 4,
      planCourse: { ...theory4Plan, lectures_per_week: 1, lecture_session_duration: 2 },
    });
    expect(mismatch.durations).toEqual([2, 2]);
    expect(mismatch.source).toBe("derived");
    expect(mismatch.noteAr).toContain("لا يطابق");

    const missing = requiredCadenceForComponent({
      componentType: "theory",
      assignedHours: 4,
      planCourse: null,
    });
    expect(missing.durations).toEqual([2, 2]);
    expect(missing.noteAr).toContain("الخطة");
  });

  test("hour splitting never produces a session longer than 4h", () => {
    expect(splitHoursIntoSessions(1)).toEqual([1]);
    expect(splitHoursIntoSessions(2)).toEqual([2]);
    expect(splitHoursIntoSessions(3)).toEqual([3]);
    expect(splitHoursIntoSessions(4)).toEqual([2, 2]);
    expect(splitHoursIntoSessions(6)).toEqual([2, 2, 2]);
    expect(splitHoursIntoSessions(0)).toEqual([]);
    for (const h of [1, 2, 3, 4, 5, 6, 8]) {
      const parts = splitHoursIntoSessions(h);
      expect(parts.every((p) => p <= 4)).toBe(true);
      expect(Math.round(parts.reduce((a, b) => a + b, 0) * 100) / 100).toBe(h);
    }
  });
});

describe("resume, idempotency and hour ceiling", () => {
  test("a partial 2h session leaves exactly one 2h session to create", () => {
    const plan = planRemainingSessions({
      requiredDurations: [2, 2],
      existing: [{ id: "s1", day_of_week: 0, start_time: "08:00", end_time: "10:00" }],
    });
    expect(plan.remaining).toEqual([2]);
    expect(plan.conforming).toHaveLength(1);
    expect(plan.nonconforming).toHaveLength(0);
    expect(plan.scheduledHours).toBe(2);
    expect(plan.budgetExhausted).toBe(false);
  });

  test("a fully scheduled component creates no duplicates on re-run", () => {
    const plan = planRemainingSessions({
      requiredDurations: [2, 2],
      existing: [
        { id: "s1", day_of_week: 0, start_time: "08:00", end_time: "10:00" },
        { id: "s2", day_of_week: 2, start_time: "08:00", end_time: "10:00" },
      ],
    });
    expect(plan.remaining).toEqual([]);
    expect(plan.budgetExhausted).toBe(true);
    expect(plan.nonconforming).toHaveLength(0);
  });

  test("a mismatched existing 4h session is held, not counted complete, and never exceeds hours", () => {
    const plan = planRemainingSessions({
      requiredDurations: [2, 2],
      existing: [{ id: "old", day_of_week: 1, start_time: "08:00", end_time: "12:00" }],
    });
    expect(plan.nonconforming.map((s) => s.id)).toEqual(["old"]);
    expect(plan.conforming).toHaveLength(0);
    // 4h already consumed out of a 4h budget: nothing more may be created.
    expect(plan.remaining).toEqual([]);
    expect(plan.budgetExhausted).toBe(true);
    const warning = nonconformingWarningAr({
      courseCode: "C101",
      componentType: "theory",
      groupCode: "G1",
      sessions: plan.nonconforming,
      requiredDurations: [2, 2],
    });
    expect(warning).toContain("لا تطابق نمط الخطة");
    expect(warning).toContain("لم تُعدَّل");
  });

  test("partial hours are capped so the component budget is never exceeded", () => {
    const plan = planRemainingSessions({
      requiredDurations: [2, 2],
      existing: [{ id: "odd", day_of_week: 1, start_time: "08:00", end_time: "11:00" }],
    });
    expect(plan.scheduledHours).toBe(3);
    expect(plan.remaining.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1);
  });

  test("session hours parses HH:MM and HH:MM:SS and rejects invalid ranges", () => {
    expect(sessionHours("08:00", "10:00")).toBe(2);
    expect(sessionHours("08:00:00", "11:00:00")).toBe(3);
    expect(sessionHours("10:00", "08:00")).toBe(0);
    expect(sessionHours("x", "y")).toBe(0);
  });
});

describe("candidate selection", () => {
  const slots = [
    { day: 0, start: "08:00:00", end: "10:00:00" },
    { day: 0, start: "10:00:00", end: "12:00:00" },
    { day: 2, start: "08:00:00", end: "10:00:00" },
  ];

  test("repeated weekly sessions prefer a distinct day", () => {
    const ordered = orderSlotsByDistinctDay(slots, [0]);
    expect(ordered[0]).toEqual({ day: 2, start: "08:00:00", end: "10:00:00" });
    expect(ordered).toHaveLength(3);
  });

  test("wrong room type and too-small rooms are excluded, capacity respected", () => {
    const rooms = [
      { id: "lab-1", capacity: 40, room_type: "lab", room_type_id: "rt-lab" },
      { id: "hall-1", capacity: 40, room_type: "hall", room_type_id: "rt-hall" },
      { id: "lab-small", capacity: 10, room_type: "lab", room_type_id: "rt-lab" },
    ];
    expect(
      filterCandidateRooms(rooms, { roomTypeId: "rt-lab", expectedStudents: 30 }).map((r) => r.id),
    ).toEqual(["lab-1"]);
    expect(
      filterCandidateRooms(rooms, { roomTypeName: "hall", expectedStudents: 30 }).map((r) => r.id),
    ).toEqual(["hall-1"]);
    expect(filterCandidateRooms(rooms, { expectedStudents: 30 }).map((r) => r.id)).toEqual([
      "lab-1",
      "hall-1",
    ]);
  });

  test("locally known occupied slots are pre-filtered without replacing server checks", () => {
    const occupied = [
      {
        day: 0,
        start: "08:00:00",
        end: "10:00:00",
        roomId: "lab-1",
        instructorId: "i1",
        cohortId: "c1",
        deliveryGroupId: "g1",
      },
    ];
    const slot = { day: 0, start: "09:00:00", end: "11:00:00" };
    expect(isLocallyBlocked(slot, { roomId: "lab-1" }, occupied)).toBe(true);
    expect(isLocallyBlocked(slot, { roomId: "lab-2", instructorId: "i1" }, occupied)).toBe(true);
    expect(isLocallyBlocked(slot, { roomId: "lab-2", cohortId: "c1" }, occupied)).toBe(true);
    expect(isLocallyBlocked(slot, { roomId: "lab-2", deliveryGroupId: "g1" }, occupied)).toBe(true);
    expect(isLocallyBlocked(slot, { roomId: "lab-2", cohortId: "c9" }, occupied)).toBe(false);
    expect(
      isLocallyBlocked({ day: 2, start: "08:00:00", end: "10:00:00" }, { roomId: "lab-1" }, occupied),
    ).toBe(false);
  });
});

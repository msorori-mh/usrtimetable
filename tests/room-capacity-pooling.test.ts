/**
 * PRACTICAL-LAB-FALLBACK-CAPACITY-02 — readiness capacity pooling and scheduler
 * candidate generation must use the SAME policy: practical demand takes labs
 * first, then the lecture-hall surplus; theory never borrows a lab.
 */
import { describe, expect, test } from "bun:test";
import {
  analyzeRoomTimeCapacity,
  roomTimeCapacityMessagesAr,
  roomTimeCapacityReadinessMetrics,
} from "@/lib/reports/room-time-capacity";
import { filterCandidateRooms, roomMatchesRequirement } from "@/lib/auto-scheduler/session-plan";
import { isRoomTypeCompatible } from "@/lib/scheduling/room-type-policy";

const settings = {
  working_days: [0, 1, 2, 3, 4, 6],
  day_start_time: "08:00",
  day_end_time: "16:00",
};
const roomTypes = [
  { id: "lh", name_ar: "قاعة محاضرات", code: "lecture_hall" },
  { id: "lab", name_ar: "معمل حاسوب", code: "computer_lab" },
];
const rooms = (typeId: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `${typeId}-${i}`, room_type_id: typeId }));
const demand = (roomTypeId: string, hours: number, componentType: string) => [
  { roomTypeId, hours, componentType },
];

describe("pooled weekly room-hours capacity", () => {
  test("(أ) lab deficit covered by lecture-hall surplus is not a blocker", () => {
    const analysis = analyzeRoomTimeCapacity({
      settings,
      rooms: [...rooms("lab", 6), ...rooms("lh", 10)],
      roomTypes,
      demand: [...demand("lab", 308, "practical"), ...demand("lh", 200, "theory")],
    });
    const lab = analysis.perType.find((t) => t.roomTypeId === "lab")!;
    const hall = analysis.perType.find((t) => t.roomTypeId === "lh")!;
    expect(lab.availableHours).toBe(288);
    expect(lab.deficitHours).toBe(20);
    expect(lab.coveredByFallbackHours).toBe(20);
    expect(lab.effectiveDeficitHours).toBe(0);
    expect(lab.additionalRoomsNeeded).toBe(0);
    expect(hall.reservedForFallbackHours).toBe(20);
    expect(analysis.insufficient).toHaveLength(0);
    expect(roomTimeCapacityMessagesAr(analysis)).toHaveLength(0);
    const metric = roomTimeCapacityReadinessMetrics(analysis)[0];
    expect(metric.missing).toBe(0);
  });

  test("(ج) blocker stays when pooled capacity is still short", () => {
    const analysis = analyzeRoomTimeCapacity({
      settings,
      rooms: [...rooms("lab", 6), ...rooms("lh", 6)],
      roomTypes,
      demand: [...demand("lab", 400, "practical"), ...demand("lh", 280, "theory")],
    });
    const lab = analysis.perType.find((t) => t.roomTypeId === "lab")!;
    expect(lab.deficitHours).toBe(112);
    expect(lab.coveredByFallbackHours).toBe(8);
    expect(lab.effectiveDeficitHours).toBe(104);
    expect(analysis.insufficient.map((t) => t.roomTypeId)).toEqual(["lab"]);
    expect(roomTimeCapacityMessagesAr(analysis)[0]).toContain("العجز المتبقي 104 ساعة");
    expect(roomTimeCapacityReadinessMetrics(analysis)[0].missing).toBe(1);
  });

  test("(د) theory demand never borrows lab hours", () => {
    const analysis = analyzeRoomTimeCapacity({
      settings,
      rooms: [...rooms("lab", 10), ...rooms("lh", 2)],
      roomTypes,
      demand: [...demand("lh", 200, "theory")],
    });
    const hall = analysis.perType.find((t) => t.roomTypeId === "lh")!;
    expect(hall.effectiveDeficitHours).toBe(hall.deficitHours);
    expect(hall.effectiveDeficitHours).toBeGreaterThan(0);
    expect(analysis.insufficient.map((t) => t.roomTypeId)).toEqual(["lh"]);
  });

  test("practical lab demand with no hall surplus keeps its own deficit", () => {
    const analysis = analyzeRoomTimeCapacity({
      settings,
      rooms: [...rooms("lab", 6), ...rooms("lh", 4)],
      roomTypes,
      demand: [...demand("lab", 308, "practical"), ...demand("lh", 192, "theory")],
    });
    const lab = analysis.perType.find((t) => t.roomTypeId === "lab")!;
    expect(lab.coveredByFallbackHours).toBe(0);
    expect(lab.effectiveDeficitHours).toBe(20);
  });

  test("lab demand of a non-practical component is not pooled", () => {
    const analysis = analyzeRoomTimeCapacity({
      settings,
      rooms: [...rooms("lab", 6), ...rooms("lh", 10)],
      roomTypes,
      demand: [...demand("lab", 308, "theory")],
    });
    const lab = analysis.perType.find((t) => t.roomTypeId === "lab")!;
    expect(lab.coveredByFallbackHours).toBe(0);
    expect(lab.effectiveDeficitHours).toBe(20);
  });
});

describe("(ب) candidate generation shares the same policy", () => {
  const labRoom = { id: "lab-1", room_type: "computer_lab", capacity: 30 };
  const hallRoom = { id: "hall-1", room_type: "lecture_hall", capacity: 60 };
  const practical = {
    roomTypeName: "computer_lab",
    componentType: "practical",
    expectedStudents: 25,
  };

  test("practical prefers the lab and keeps the hall as fallback only", () => {
    const candidates = filterCandidateRooms([hallRoom, labRoom], practical);
    expect(candidates.map((r) => r.id)).toEqual(["lab-1", "hall-1"]);
  });

  test("practical uses the hall when no valid lab exists", () => {
    expect(filterCandidateRooms([hallRoom], practical).map((r) => r.id)).toEqual(["hall-1"]);
  });

  test("theory never gets a lab candidate", () => {
    const theory = {
      roomTypeName: "lecture_hall",
      componentType: "theory",
      expectedStudents: 25,
    };
    expect(filterCandidateRooms([labRoom, hallRoom], theory).map((r) => r.id)).toEqual(["hall-1"]);
    expect(roomMatchesRequirement(labRoom, theory)).toBe(false);
    expect(
      isRoomTypeCompatible({
        componentType: "theory",
        requiredRoomType: "lecture_hall",
        roomType: "computer_lab",
      }),
    ).toBe(false);
  });

  test("(هـ) seat capacity stays a hard constraint for the fallback hall", () => {
    const small = { id: "hall-small", room_type: "lecture_hall", capacity: 10 };
    expect(filterCandidateRooms([small], practical)).toHaveLength(0);
    expect(roomMatchesRequirement(hallRoom, { ...practical, expectedStudents: 200 })).toBe(false);
  });
});

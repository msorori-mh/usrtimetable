/**
 * JAWF-ROOM-FALLBACK-01 — practical computer_lab → lecture_hall fallback policy.
 *
 * Mirrors the deployed DB helper `is_assignment_room_compatible` / `_ss_room_type`:
 * only a practical component that requires `computer_lab` may use a
 * `lecture_hall`, and only as a ranked fallback after labs.
 */
import { describe, expect, it } from "bun:test";
import {
  isPracticalLabFallback,
  isRoomTypeCompatible,
  orderedRoomTypePreference,
  roomTypeRank,
} from "@/lib/scheduling/room-type-policy";
import {
  filterCandidateRooms,
  isRoomSlotAvailable,
  partitionCandidateRoomsByRank,
  roomCandidateRank,
  type RoomLite,
} from "@/lib/auto-scheduler/session-plan";

const lab: RoomLite = { id: "lab-1", capacity: 30, room_type: "computer_lab" };
const hall: RoomLite = { id: "hall-1", capacity: 60, room_type: "lecture_hall" };

describe("room type policy", () => {
  it("prefers the lab for a practical computer_lab component", () => {
    const req = { componentType: "practical", requiredRoomType: "computer_lab" };
    expect(roomTypeRank({ ...req, roomType: "computer_lab" })).toBe(0);
    expect(roomTypeRank({ ...req, roomType: "lecture_hall" })).toBe(1);
    expect(orderedRoomTypePreference(req)).toEqual(["computer_lab", "lecture_hall"]);
  });

  it("never lets theory or tutorial borrow a computer lab", () => {
    expect(
      isRoomTypeCompatible({
        componentType: "theory",
        requiredRoomType: "lecture_hall",
        roomType: "computer_lab",
      }),
    ).toBe(false);
    expect(
      isRoomTypeCompatible({
        componentType: "tutorial",
        requiredRoomType: "lecture_hall",
        roomType: "computer_lab",
      }),
    ).toBe(false);
    expect(
      isRoomTypeCompatible({
        componentType: "tutorial",
        requiredRoomType: "lecture_hall",
        roomType: "lecture_hall",
      }),
    ).toBe(true);
  });

  it("keeps every other required room type an exact match", () => {
    expect(
      isRoomTypeCompatible({
        componentType: "practical",
        requiredRoomType: "science_lab",
        roomType: "lecture_hall",
      }),
    ).toBe(false);
    expect(
      isPracticalLabFallback({
        componentType: "practical",
        requiredRoomType: "computer_lab",
        roomType: "workshop",
      }),
    ).toBe(false);
  });
});

describe("candidate room ranking", () => {
  const practicalReq = {
    roomTypeName: "computer_lab",
    componentType: "practical",
    expectedStudents: 25,
  };

  it("selects the lab first and the hall only as fallback", () => {
    const ordered = filterCandidateRooms([hall, lab], practicalReq);
    expect(ordered.map((r) => r.id)).toEqual(["lab-1", "hall-1"]);
    const pools = partitionCandidateRoomsByRank([hall, lab], practicalReq);
    expect(pools.preferred.map((r) => r.id)).toEqual(["lab-1"]);
    expect(pools.fallback.map((r) => r.id)).toEqual(["hall-1"]);
  });

  it("uses the lecture hall when no valid lab exists", () => {
    const pools = partitionCandidateRoomsByRank([hall], practicalReq);
    expect(pools.preferred).toHaveLength(0);
    expect(pools.fallback.map((r) => r.id)).toEqual(["hall-1"]);
    expect(roomCandidateRank(hall, practicalReq)).toBe(1);
  });

  it("does not offer a lab to a theory component", () => {
    const theoryReq = {
      roomTypeName: "lecture_hall",
      componentType: "theory",
      expectedStudents: 25,
    };
    expect(filterCandidateRooms([lab, hall], theoryReq).map((r) => r.id)).toEqual(["hall-1"]);
    expect(roomCandidateRank(lab, theoryReq)).toBeNull();
  });

  it("still enforces capacity on a fallback hall", () => {
    expect(
      roomCandidateRank(
        { id: "small-hall", capacity: 10, room_type: "lecture_hall" },
        practicalReq,
      ),
    ).toBeNull();
  });

  it("resolves room type codes through room_type_id", () => {
    const req = {
      roomTypeId: "rt-lab",
      componentType: "practical",
      expectedStudents: 10,
      roomTypeCodeById: { "rt-lab": "computer_lab", "rt-hall": "lecture_hall" },
    };
    expect(roomCandidateRank({ id: "l", capacity: 20, room_type_id: "rt-lab" }, req)).toBe(0);
    expect(roomCandidateRank({ id: "h", capacity: 20, room_type_id: "rt-hall" }, req)).toBe(1);
  });
});

describe("room availability windows", () => {
  const windows = [
    { room_id: "lab-1", day_of_week: 0, start_time: "08:00:00", end_time: "16:00:00" },
    { room_id: "hall-1", day_of_week: 0, start_time: "08:00:00", end_time: "14:00:00" },
  ];

  it("allows a lab session until 16:00", () => {
    expect(
      isRoomSlotAvailable({ id: "lab-1" }, { day: 0, start: "14:00:00", end: "16:00:00" }, windows),
    ).toBe(true);
  });

  it("blocks a lecture hall after 14:00", () => {
    expect(
      isRoomSlotAvailable(
        { id: "hall-1" },
        { day: 0, start: "14:00:00", end: "16:00:00" },
        windows,
      ),
    ).toBe(false);
    expect(
      isRoomSlotAvailable(
        { id: "hall-1" },
        { day: 0, start: "12:00:00", end: "14:00:00" },
        windows,
      ),
    ).toBe(true);
  });

  it("falls back to the rooms.available_* columns when no window rows exist", () => {
    const room = {
      id: "hall-2",
      available_days: [0, 1],
      available_start_time: "08:00:00",
      available_end_time: "14:00:00",
    };
    expect(isRoomSlotAvailable(room, { day: 0, start: "13:00:00", end: "14:00:00" }, [])).toBe(
      true,
    );
    expect(isRoomSlotAvailable(room, { day: 0, start: "13:00:00", end: "15:00:00" }, [])).toBe(
      false,
    );
    expect(isRoomSlotAvailable(room, { day: 3, start: "09:00:00", end: "10:00:00" }, [])).toBe(
      false,
    );
  });
});

describe("no hard mismatch for a valid practical fallback", () => {
  it("treats practical lab→hall as compatible, unlike a real mismatch", () => {
    expect(
      isRoomTypeCompatible({
        componentType: "practical",
        requiredRoomType: "computer_lab",
        roomType: "lecture_hall",
      }),
    ).toBe(true);
    expect(
      isRoomTypeCompatible({
        componentType: "practical",
        requiredRoomType: "computer_lab",
        roomType: "seminar_room",
      }),
    ).toBe(false);
  });
});

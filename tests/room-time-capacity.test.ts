import { describe, expect, it } from "bun:test";
import {
  analyzeRoomTimeCapacity,
  roomTimeCapacityMessagesAr,
  roomTimeCapacityReadinessMetrics,
  ROOM_TIME_CAPACITY_LABEL,
} from "@/lib/reports/room-time-capacity";

const settings = {
  working_days: [0, 1, 2, 3, 4, 6],
  day_start_time: "08:00",
  day_end_time: "14:00",
};
const roomTypes = [
  { id: "lh", name_ar: "قاعة محاضرات" },
  { id: "lab", name_ar: "معمل حاسوب" },
];
const rooms = (typeId: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `${typeId}-${i}`, room_type_id: typeId }));

describe("room time capacity readiness", () => {
  it("flags a blocker when required room-hours exceed available room-hours", () => {
    const analysis = analyzeRoomTimeCapacity({
      settings,
      rooms: rooms("lh", 12),
      roomTypes,
      demand: Array.from({ length: 300 }, () => ({ roomTypeId: "lh", hours: 3 })),
    });
    const lh = analysis.perType.find((t) => t.roomTypeId === "lh")!;
    expect(lh.weeklyHoursPerRoom).toBe(36);
    expect(lh.availableHours).toBe(432);
    expect(lh.requiredHours).toBe(900);
    expect(lh.deficitHours).toBe(468);
    expect(lh.additionalRoomsNeeded).toBe(13);
    expect(analysis.insufficient).toHaveLength(1);
    const metric = roomTimeCapacityReadinessMetrics(analysis)[0];
    expect(metric.label).toBe(ROOM_TIME_CAPACITY_LABEL);
    expect(metric.critical).toBe(true);
    expect(metric.missing).toBe(1);
    expect(roomTimeCapacityMessagesAr(analysis)[0]).toContain("العجز 468 ساعة");
  });

  it("passes when capacity is sufficient", () => {
    const analysis = analyzeRoomTimeCapacity({
      settings,
      rooms: rooms("lh", 12),
      roomTypes,
      demand: [{ roomTypeId: "lh", hours: 100 }],
    });
    expect(analysis.insufficient).toHaveLength(0);
    expect(roomTimeCapacityReadinessMetrics(analysis)[0].missing).toBe(0);
  });

  it("ignores obsolete/inactive rooms and respects room availability windows", () => {
    const analysis = analyzeRoomTimeCapacity({
      settings,
      rooms: [
        { id: "lab-0", room_type_id: "lab" },
        { id: "lab-1", room_type_id: "lab", is_active: false },
      ],
      roomTypes,
      roomAvailability: [
        { room_id: "lab-0", day_of_week: 0, start_time: "08:00", end_time: "12:00" },
        { room_id: "lab-0", day_of_week: 1, start_time: "08:00", end_time: "20:00" },
        { room_id: "lab-0", day_of_week: 5, start_time: "08:00", end_time: "14:00" },
      ],
      demand: [{ roomTypeId: "lab", hours: 20 }],
    });
    const lab = analysis.perType.find((t) => t.roomTypeId === "lab")!;
    // 4h + clamped 6h; the non-working day is ignored; inactive room excluded.
    expect(lab.activeRooms).toBe(1);
    expect(lab.availableHours).toBe(10);
    expect(lab.deficitHours).toBe(10);
    expect(lab.additionalRoomsNeeded).toBe(1);
  });

  it("fails closed when working days or day window are missing", () => {
    const analysis = analyzeRoomTimeCapacity({
      settings: { working_days: [], day_start_time: null, day_end_time: null },
      rooms: rooms("lh", 5),
      roomTypes,
      demand: [{ roomTypeId: "lh", hours: 10 }],
    });
    expect(analysis.unavailable).toBe(true);
    const metrics = roomTimeCapacityReadinessMetrics(analysis);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].missing).toBe(1);
    expect(metrics[0].critical).toBe(true);
  });

  it("reports unresolved demand hours separately without hiding them", () => {
    const analysis = analyzeRoomTimeCapacity({
      settings,
      rooms: rooms("lh", 12),
      roomTypes,
      demand: [
        { roomTypeId: null, hours: 6 },
        { roomTypeId: "lh", hours: 10 },
      ],
    });
    expect(analysis.unresolvedHours).toBe(6);
    expect(roomTimeCapacityReadinessMetrics(analysis)[1].missing).toBe(1);
  });
});

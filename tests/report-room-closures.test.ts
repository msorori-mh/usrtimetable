import test from "node:test";
import assert from "node:assert/strict";
import {
  roomUtilizationMetrics,
  type ReportRoomClosure,
} from "../src/lib/reports/presentation-metrics";
import { physicalSeatSummary, QARDAI_ROOM_IDS } from "../src/lib/reports/physical-rooms";

const base = {
  settings: { working_days: [0, 1], day_start_time: "08:00", day_end_time: "14:00" },
  room: {},
  availability: [],
  sessions: [],
};
const closure = (extra: Partial<ReportRoomClosure> = {}): ReportRoomClosure => ({
  room_id: "r",
  day_of_week: 0,
  start_time: "10:00",
  end_time: "12:00",
  start_date: null,
  end_date: null,
  ...extra,
});

test("overlapping closures are subtracted once; blocked sessions remain outside availability", () => {
  const m = roomUtilizationMetrics({
    ...base,
    unavailability: [closure(), closure({ start_time: "11:00", end_time: "13:00" })],
    sessions: [{ day_of_week: 0, start_time: "09:00", end_time: "14:00" }],
  });
  assert.equal(m.available_hours, 9);
  assert.equal(m.blocked_hours, 3);
  assert.equal(m.occupied_hours, 2);
  assert.equal(m.outside_hours, 3);
  assert.equal(m.idle_hours, 7);
});

test("all-day and all-week closures preserve explicit availability precedence", () => {
  assert.equal(
    roomUtilizationMetrics({
      ...base,
      unavailability: [closure({ start_time: null, end_time: null })],
    }).available_hours,
    6,
  );
  assert.equal(
    roomUtilizationMetrics({
      ...base,
      unavailability: [closure({ day_of_week: null, start_time: null, end_time: null })],
    }).available_hours,
    0,
  );
  const m = roomUtilizationMetrics({
    ...base,
    room: { available_days: [0], available_start_time: "10:00", available_end_time: "12:00" },
    availability: [
      { day_of_week: 0, start_time: "08:00", end_time: "14:00" },
      { day_of_week: 1, start_time: "08:00", end_time: "14:00" },
    ],
  });
  assert.equal(m.available_hours, 12);
});

test("dated closures do not silently become permanent weekly restrictions", () => {
  assert.throws(
    () =>
      roomUtilizationMetrics({ ...base, unavailability: [closure({ start_date: "2026-10-01" })] }),
    /مرتبطة بتواريخ/,
  );
});

test("shared-record overlap is measured within the allocation, not outside its days", () => {
  const m = roomUtilizationMetrics({
    ...base,
    room: { available_days: [0] },
    sessions: [
      { day_of_week: 0, start_time: "08:00", end_time: "11:00" },
      { day_of_week: 0, start_time: "09:00", end_time: "12:00" },
      { day_of_week: 1, start_time: "08:00", end_time: "12:00" },
      { day_of_week: 1, start_time: "08:00", end_time: "12:00" },
    ],
  });
  assert.equal(m.occupied_hours, 4);
  assert.equal(m.inside_overlap_hours, 2);
  assert.equal(m.overlap_hours, 6);
});

test("unresolved shared seats do not erase the consistent subtotal", () => {
  assert.deepEqual(
    physicalSeatSummary([
      { id: QARDAI_ROOM_IDS[0], seats: 220 },
      { id: QARDAI_ROOM_IDS[1], seats: 200 },
      { id: QARDAI_ROOM_IDS[2], seats: 200 },
      { id: "another-room", seats: 60 },
    ]),
    { known: 60, unresolved: 1 },
  );
});

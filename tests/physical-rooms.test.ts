import test from "node:test";
import assert from "node:assert/strict";
import {
  QARDAI_ROOM_IDS,
  physicalRoomGroups,
  physicalSeatCount,
  physicalRoomSourcesComplete,
} from "../src/lib/reports/physical-rooms";
import { roomUtilizationMetrics } from "../src/lib/reports/presentation-metrics";
import { resourceSummary, type OverviewRoom } from "../src/lib/reports/university-overview";

test("approved Qardai days partition one 36-hour hall into 6,12,18 hours", () => {
  const allocations = [[0], [6, 2], [1, 3, 4]];
  const metrics = allocations.map((available_days) =>
    roomUtilizationMetrics({
      settings: {
        working_days: [6, 0, 1, 2, 3, 4],
        day_start_time: "08:00",
        day_end_time: "14:00",
      },
      room: { available_days },
      availability: [],
      sessions: [],
    }),
  );
  assert.deepEqual(
    metrics.map((m) => m.available_hours),
    [6, 12, 18],
  );
  const rooms = metrics.map(
    (m, i) =>
      ({
        id: QARDAI_ROOM_IDS[i],
        seats: 200,
        capacityHours: m.available_hours,
        occupiedHours: 0,
        freeHours: m.idle_hours,
        sessions: 0,
      }) as OverviewRoom,
  );
  const total = resourceSummary(rooms, true);
  assert.equal(total.count, 1);
  assert.equal(total.capacityHours, 36);
  assert.equal(total.seats, 200);
  assert.equal(total.unusedCount, 1);
  rooms[0].seats = 220;
  assert.equal(resourceSummary(rooms, true).seats, null);
});

test("identical labels do not merge unrelated rooms; incomplete shared reads are not free capacity", () => {
  assert.equal(
    physicalRoomGroups([
      { id: "r1", name: "القردعي" },
      { id: "r2", name: "القردعي" },
    ]).length,
    2,
  );
  assert.equal(physicalRoomSourcesComplete(QARDAI_ROOM_IDS[0], [QARDAI_ROOM_IDS[0]]), false);
  assert.equal(physicalRoomSourcesComplete(QARDAI_ROOM_IDS[0], [...QARDAI_ROOM_IDS]), true);
  assert.equal(
    physicalSeatCount([
      { id: "r1", seats: 60 },
      { id: "r2", seats: 60 },
    ]),
    120,
  );
});

test("off-allocation lectures remain visible outside availability and do not increase capacity", () => {
  const m = roomUtilizationMetrics({
    settings: { working_days: [6, 0, 1, 2, 3, 4], day_start_time: "08:00", day_end_time: "14:00" },
    room: { available_days: [0] },
    availability: [],
    sessions: [
      { day_of_week: 0, start_time: "08:00", end_time: "10:00" },
      { day_of_week: 1, start_time: "08:00", end_time: "11:00" },
    ],
  });
  assert.equal(m.available_hours, 6);
  assert.equal(m.occupied_hours, 2);
  assert.equal(m.outside_hours, 3);
  assert.equal(m.idle_hours, 4);
});

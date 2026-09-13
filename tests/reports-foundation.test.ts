import assert from "node:assert/strict";
import { test } from "node:test";
import { attendanceMetrics, roomUtilizationMetrics } from "../src/lib/reports/presentation-metrics";
import { readAllReportRows } from "../src/lib/reports/read-all";
const time = (start: string, end: string, day = 1) => ({
  day_of_week: day,
  start_time: start,
  end_time: end,
});
const settings = { working_days: [1, 2], day_start_time: "08:00", day_end_time: "16:00" };
test("attendance counts internal gaps and unions overlapping teaching", () => {
  assert.deepEqual(
    attendanceMetrics([time("08:00", "10:00"), time("09:00", "11:00"), time("12:00", "14:00")]),
    { days: 1, gapHours: 1, occupiedHours: 5, presenceHours: 6 },
  );
});
test("availability windows override room fallback and duplicate windows do not inflate capacity", () => {
  const result = roomUtilizationMetrics({
    settings,
    room: { available_end_time: "10:00" },
    availability: [time("08:00", "16:00"), time("08:00", "16:00")],
    sessions: [time("14:00", "16:00")],
  });
  assert.equal(result.available_hours, 8);
  assert.equal(result.utilization_pct, 25);
  assert.equal(result.outside_hours, 0);
});
test("reports separate overlap and teaching outside availability", () => {
  const result = roomUtilizationMetrics({
    settings,
    room: {},
    availability: [time("08:00", "12:00")],
    sessions: [time("08:00", "11:00"), time("10:00", "14:00")],
  });
  assert.equal(result.available_hours, 4);
  assert.equal(result.occupied_hours, 4);
  assert.equal(result.overlap_hours, 1);
  assert.equal(result.outside_hours, 2);
  assert.equal(result.utilization_pct, 100);
});
test("fallback uses configured days and times rather than a fixed 40 hour denominator", () => {
  const result = roomUtilizationMetrics({
    settings,
    room: { available_days: [2], available_start_time: "10:00", available_end_time: "14:00" },
    availability: [],
    sessions: [time("10:00", "12:00", 2)],
  });
  assert.equal(result.available_hours, 4);
  assert.equal(result.utilization_pct, 50);
});
test("missing settings never become a plausible zero", () => {
  assert.throws(() =>
    roomUtilizationMetrics({ settings: null, room: {}, availability: [], sessions: [] }),
  );
});
test("a room with zero available hours has an undefined percentage", () => {
  assert.equal(
    roomUtilizationMetrics({
      settings,
      room: { available_days: [] },
      availability: [],
      sessions: [],
    }).utilization_pct,
    null,
  );
});
test("pagination retrieves more than the server row limit", async () => {
  const rows = Array.from({ length: 1251 }, (_, id) => ({ id }));
  assert.equal(
    (await readAllReportRows(async (from, to) => ({ data: rows.slice(from, to + 1), error: null })))
      .length,
    1251,
  );
});
test("a later page failure rejects the entire report", async () => {
  await assert.rejects(
    readAllReportRows(async (from) =>
      from
        ? { data: null, error: new Error("network") }
        : { data: Array(500).fill(1), error: null },
    ),
    /network/,
  );
});

import { buildDeliveryGroupCoverage } from "../src/lib/reports/program-timetable-coverage";
test("a placed group with missing hours remains incomplete", () => {
  const result = buildDeliveryGroupCoverage({
    groups: [
      {
        id: "g",
        cohortId: "c",
        groupCode: "G1",
        groupNumber: 1,
        componentType: "theory",
        courseCode: "X",
        courseName: "Course",
        expectedStudents: 10,
        requiredHours: 3,
        instructorName: "Teacher",
      },
    ],
    sessions: [{ delivery_group_id: "g", start_time: "08:00", end_time: "10:00" }],
  });
  assert.equal(result.summary.unscheduledGroups, 0);
  assert.equal(result.summary.partialGroups, 1);
  assert.equal(result.summary.unscheduledHours, 1);
  assert.equal(result.incomplete.length, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { studentWeeklyCapacity, type Snapshot } from "../src/lib/auto-scheduler/compact.ts";

function snapshot(settings: Record<string, unknown>): Snapshot {
  return { settings: {
    max_daily_hours_per_section: 8,
    day_start_time: "08:00:00",
    day_end_time: "14:00:00",
    extended_day_policy_enabled: false,
    ...settings,
  } } as unknown as Snapshot;
}
test("Arts 21-hour demand proves three days insufficient, while four have capacity", () => {
  const s = snapshot({});
  assert.equal(studentWeeklyCapacity(s, 3), 18 * 60);
  assert.ok(21 * 60 > studentWeeklyCapacity(s, 3));
  assert.ok(21 * 60 <= studentWeeklyCapacity(s, 4));
});
test("a longer working window never raises the configured student daily cap", () => {
  assert.equal(studentWeeklyCapacity(snapshot({ day_end_time: "18:00:00" }), 3), 24 * 60);
});
test("a smaller configured cap remains effective", () => {
  assert.equal(studentWeeklyCapacity(snapshot({ max_daily_hours_per_section: 4 }), 3), 12 * 60);
});
test("extended-day quota remains enforced", () => {
  assert.equal(studentWeeklyCapacity(snapshot({
    extended_day_policy_enabled: true, standard_day_end_time: "14:00:00",
    day_end_time: "16:00:00", max_extended_days_per_partition: 1,
  }), 3), 20 * 60);
});
test("a closed working window cannot certify positive capacity", () => {
  assert.equal(studentWeeklyCapacity(snapshot({ day_end_time: "08:00:00" }), 3), 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  assertValidSchedulingPolicy,
  validateSchedulingPolicy,
} from "../src/lib/scheduling/policy.ts";

const valid = {
  working_days: [6, 0, 1, 2, 3, 4],
  day_start_time: "08:00",
  day_end_time: "14:00",
  slot_minutes: 60,
  min_session_hours: 1,
  max_session_hours: 3,
  max_daily_hours_per_instructor: 6,
  max_daily_hours_per_section: 6,
  max_daily_theory_hours_per_section: 6,
  max_daily_practical_hours_per_section: 6,
  max_extended_days_per_partition: 0,
  break_between_sessions_min: 0,
};

test("accepts the approved six-hour college policy", () => {
  assert.deepEqual(validateSchedulingPolicy(valid), []);
  assert.doesNotThrow(() => assertValidSchedulingPolicy(valid));
});

test("accepts the approved eight-hour college policy", () => {
  assert.doesNotThrow(() =>
    assertValidSchedulingPolicy({
      ...valid,
      day_end_time: "16:00:00",
      max_daily_hours_per_instructor: 8,
      max_daily_hours_per_section: 8,
      max_daily_practical_hours_per_section: 8,
      max_extended_days_per_partition: 2,
    }),
  );
});

test("rejects missing days, inverted times and invalid limits together", () => {
  const issues = validateSchedulingPolicy({
    ...valid,
    working_days: [],
    day_start_time: "14:00",
    day_end_time: "08:00",
    slot_minutes: 0,
    max_daily_hours_per_instructor: -1,
    break_between_sessions_min: -5,
  });
  assert.deepEqual(
    issues.map((issue) => issue.code),
    [
      "WORKING_DAYS_INVALID",
      "DAY_WINDOW_INVALID",
      "SLOT_MINUTES_INVALID",
      "INSTRUCTOR_DAILY_LIMIT_INVALID",
      "BREAK_INVALID",
    ],
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  instructorAttendanceDayCapForHours,
  instructorsOverWorkloadAttendanceDayCap,
} from "../src/lib/auto-scheduler/attendance-objective";

test("regular instructors receive only one fallback day above the workload minimum", () => {
  assert.equal(instructorAttendanceDayCapForHours(6, null), 2);
  assert.equal(instructorAttendanceDayCapForHours(10, null), 3);
  assert.equal(instructorAttendanceDayCapForHours(16, null), 4);
  assert.equal(instructorAttendanceDayCapForHours(18, null), 4);
});

test("a department-head target of four remains four, while explicit maxima stay authoritative", () => {
  assert.equal(instructorAttendanceDayCapForHours(6, 4), 4);
  assert.equal(instructorAttendanceDayCapForHours(6, 5), 4);
  assert.equal(instructorAttendanceDayCapForHours(6, 5, 5), 5);
  assert.equal(instructorAttendanceDayCapForHours(10, null, 2), 2);
  assert.throws(
    () => instructorAttendanceDayCapForHours(10, 4, 3),
    /INSTRUCTOR_ATTENDANCE_TARGET_EXCEEDS_MAX/,
  );
});

test("workload-aware validation rejects a third day for a six-hour regular instructor", () => {
  const sessions = [1, 2, 3].map((day) => ({
    instructor_id: "regular",
    day_of_week: day,
    start_time: "08:00:00",
    end_time: "10:00:00",
  }));
  assert.deepEqual(
    instructorsOverWorkloadAttendanceDayCap(sessions, [
      { id: "regular", target_attendance_days_per_week: null },
    ]),
    [{ instructorId: "regular", days: 3, cap: 2, hours: 6 }],
  );
});

test("two days remain legal for a six-hour regular instructor", () => {
  const sessions = [
    {
      instructor_id: "regular",
      day_of_week: 1,
      start_time: "08:00:00",
      end_time: "11:00:00",
    },
    {
      instructor_id: "regular",
      day_of_week: 2,
      start_time: "08:00:00",
      end_time: "11:00:00",
    },
  ];
  assert.deepEqual(instructorsOverWorkloadAttendanceDayCap(sessions, [{ id: "regular" }]), []);
});

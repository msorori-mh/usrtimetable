import test from "node:test";
import assert from "node:assert/strict";
import {
  assertInstructorsAvailableForNewScheduling,
  unavailableInstructorBlockers,
} from "../src/lib/auto-scheduler/preflight.ts";

const instructors = [
  {
    id: "available",
    full_name: "محاضر متوفر",
    availability_status: "available",
  },
  {
    id: "external",
    full_name: "عبدالوهاب عفيف",
    availability_status: "external_scholarship",
  },
  {
    id: "sick",
    full_name: "محاضر في إجازة",
    availability_status: "sick_leave",
  },
];

test("checks only instructors who need new sessions", () => {
  assert.deepEqual(
    unavailableInstructorBlockers(instructors, [{ instructor_id: "available" }]),
    [],
  );
});

test("blocks unavailable instructors with an actionable Arabic reason", () => {
  assert.throws(
    () =>
      assertInstructorsAvailableForNewScheduling(instructors, [
        { instructor_id: "external" },
        { instructor_id: "sick" },
      ]),
    /عبدالوهاب عفيف \(إبتعاث خارجي\).*إجازة مرضية/,
  );
});

test("ignores unavailable instructors outside the pending work", () => {
  assert.doesNotThrow(() =>
    assertInstructorsAvailableForNewScheduling(instructors, [{ instructor_id: "available" }]),
  );
});

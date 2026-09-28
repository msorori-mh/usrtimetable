import { strict as assert } from "node:assert";
import { matchesVerifiedHostedSession } from "../src/lib/conflict-engine/hosted-session-policy.ts";

const approved = {
  id: "session",
  schedule_version_id: "version",
  course_offering_id: "offering",
  teaching_assignment_id: "assignment",
  instructor_id: "instructor",
  room_id: "host-room",
  day_of_week: 6,
  start_time: "10:00:00",
  end_time: "12:00:00",
  study_system: "regular",
  expected_students: 80,
};
assert.equal(matchesVerifiedHostedSession(approved, approved, "version"), true);
assert.equal(
  matchesVerifiedHostedSession({ ...approved, start_time: "10:00" }, approved, "version"),
  true,
);
for (const [key, value] of Object.entries({
  id: "other",
  schedule_version_id: "other",
  course_offering_id: "other",
  teaching_assignment_id: null,
  instructor_id: "other",
  room_id: "other",
  day_of_week: 2,
  start_time: "08:00",
  end_time: "14:00",
  study_system: "parallel",
  expected_students: 81,
})) {
  assert.equal(
    matchesVerifiedHostedSession({ ...approved, [key]: value }, approved, "version"),
    false,
    key,
  );
}
assert.equal(
  matchesVerifiedHostedSession({ ...approved, id: undefined }, approved, "version"),
  false,
);
assert.equal(matchesVerifiedHostedSession(approved, approved, "other"), false);
console.log(
  "PASS: exact hosted session only; moves, replacements, room changes and new sessions denied",
);

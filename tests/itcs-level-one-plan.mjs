import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const plan = JSON.parse(
  readFileSync(
    new URL("../docs/scheduler-repair/itcs-level-one-draft-reconciliation-plan.json", import.meta.url),
    "utf8",
  ),
);

assert.equal(plan.status, "OFFLINE_PREVIEW_ONLY");
assert.equal(plan.target_version_id, "d68d8d22-9a6d-4f21-935f-cebf18bb969b");
assert.equal(plan.old_version_session_count, 275);
assert.equal(plan.proposed_version_session_count, 281);
assert.equal(plan.cohort_counts.length, 5);
assert.equal(plan.existing_group_changes.length, 44);
assert.equal(new Set(plan.existing_group_changes.map((g) => g.group_id)).size, 44);
assert.equal(plan.new_groups.length, 6);
assert.equal(plan.new_assignments.length, 6);
assert.equal(plan.proposed_sessions.length, 6);

const counts = new Map(
  plan.cohort_counts.map((c) => [
    c.code,
    { newCount: c.new, partitions: new Map(c.partitions.map((p) => [p.code, p.headcount])) },
  ]),
);
assert.deepEqual(
  [...counts].map(([code, item]) => [code, item.newCount]),
  [
    ["CYB-P-L1-2026", 140],
    ["IT-P-L1-2026", 100],
    ["CIS-JF-L1-2026", 125],
    ["CS-P-L1-2026", 59],
    ["CIS-P-L1-2026", 42],
  ],
);
assert.equal([...counts.values()].reduce((total, x) => total + x.newCount, 0), 466);
for (const cohort of plan.cohort_counts) {
  assert.equal(
    cohort.partitions.reduce((total, p) => total + p.headcount, 0),
    cohort.new,
    cohort.code,
  );
}

const groupKey = (group) => [group.cohort_code, group.component_id, group.group_code].join(":");
const groups = new Map(plan.new_groups.map((g) => [groupKey(g), g]));
assert.equal(groups.size, 6);
for (const group of [...plan.existing_group_changes, ...plan.new_groups]) {
  const expected = group.new ?? group.expected_students;
  const partitionCounts = counts.get(group.cohort_code)?.partitions;
  assert.ok(partitionCounts, group.cohort_code);
  assert.equal(
    group.partitions.reduce((total, code) => total + (partitionCounts.get(code) ?? 0), 0),
    expected,
    groupKey(group),
  );
  assert.ok(expected > 0 && expected <= (group.capacity ?? group.capacity_limit), groupKey(group));
  for (const code of group.partitions) assert.ok(partitionCounts.has(code), code);
}

const assignments = new Map(
  plan.new_assignments.map((assignment) => [groupKey(assignment), assignment]),
);
assert.equal(assignments.size, 6);
for (const [key, group] of groups) {
  const assignment = assignments.get(key);
  assert.ok(assignment, key);
  assert.equal(assignment.source_group_id, group.source_group_id, key);
  assert.equal(assignment.expected_students, group.expected_students, key);
}

const minutes = (value) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};
for (const session of plan.proposed_sessions) {
  const group = [...groups.values()].find(
    (g) =>
      g.cohort_id === session.cohort_id &&
      session.delivery_group_id ===
        `PLANNED:${g.component_id}:${Number(g.group_code.slice(1))}`,
  );
  assert.ok(group, session.delivery_group_id);
  const assignment = assignments.get(groupKey(group));
  assert.equal(session.source_assignment_id, assignment.source_assignment_id);
  assert.equal(session.instructor_id, assignment.instructor_id);
  assert.equal(session.course_offering_id, assignment.course_offering_id);
  assert.equal(session.expected_students, group.expected_students);
  assert.equal(minutes(session.end_time) - minutes(session.start_time), assignment.weekly_hours * 60);
  assert.ok(minutes(session.start_time) >= 8 * 60);
  assert.ok(minutes(session.end_time) <= (session.session_type === "lab" ? 16 : 14) * 60);
  if (session.room_code === "R13" || session.room_code === "R14") {
    assert.ok(minutes(session.end_time) <= 14 * 60);
  }
}
for (let i = 0; i < plan.proposed_sessions.length; i++) {
  for (let j = i + 1; j < plan.proposed_sessions.length; j++) {
    const a = plan.proposed_sessions[i];
    const b = plan.proposed_sessions[j];
    if (
      a.day_of_week === b.day_of_week &&
      minutes(a.start_time) < minutes(b.end_time) &&
      minutes(b.start_time) < minutes(a.end_time)
    ) {
      assert.notEqual(a.instructor_id, b.instructor_id, "planned instructor overlap");
      assert.notEqual(a.room_id, b.room_id, "planned room overlap");
    }
  }
}
console.log("ITCS first-year plan: 466 students, 44 updated and 6 new groups, 6 matched sessions PASS");

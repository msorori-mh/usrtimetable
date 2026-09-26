import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileSourceRow,
  sourceReconciliationSummary,
} from "../src/lib/reports/source-reconciliation.ts";

const row = (overrides = {}) => ({
  study_plan_id: "plan",
  plan_course_id: "course",
  component_id: "component",
  delivery_group_id: "group",
  teaching_assignment_id: "assignment",
  schedule_session_id: "session",
  day_of_week: 0,
  start_time: "08:00:00",
  end_time: "10:00:00",
  pending_reasons: [],
  ...overrides,
});
const sessions = [
  {
    id: "session",
    delivery_group_id: "group",
    day_of_week: 0,
    start_time: "08:00",
    end_time: "10:00",
  },
];

test("only an exact current-version group and slot is complete", () => {
  assert.equal(reconcileSourceRow(row(), sessions).stage, "complete");
  assert.equal(
    reconcileSourceRow(row({ schedule_session_id: "other-version" }), sessions).stage,
    "unlinked_session",
  );
  assert.equal(
    reconcileSourceRow(row({ end_time: "11:00:00" }), sessions).stage,
    "missing_session",
  );
});

test("missing plan, component, group and assignment are visible separately", () => {
  const result = reconcileSourceRow(
    row({
      plan_course_id: null,
      component_id: null,
      delivery_group_id: null,
      teaching_assignment_id: null,
      schedule_session_id: null,
    }),
    sessions,
  );
  assert.equal(result.stage, "missing_plan");
  assert.equal(result.issues.length, 5);
});

test("missing time and review reasons cannot be disguised by an old foreign key", () => {
  const result = reconcileSourceRow(
    row({ start_time: null, pending_reasons: ["هوية المحاضر غير مثبتة"] }),
    sessions,
  );
  assert.equal(result.stage, "missing_time");
  assert.ok(result.issues.some((issue) => issue.includes("المراجعة")));
});

test("shared participants reference one physical session and remain pending membership verification", () => {
  const members = [
    row(),
    row({
      delivery_group_id: "member",
      schedule_session_id: "session",
      shared_member: true,
    }),
  ];
  const status = sourceReconciliationSummary(members, sessions);
  assert.equal(status.sourceRows, 2);
  assert.equal(status.completeRows, 1);
  assert.equal(reconcileSourceRow(members[1], sessions).stage, "shared_review");
  assert.equal(reconcileSourceRow(members[1], sessions).sessionId, "session");
  assert.equal(status.sourceFilesVerified, false);
});

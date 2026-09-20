import test from "node:test";
import assert from "node:assert/strict";
import {
  wholeCohortGroupLabels,
  type ReportDeliveryGroup,
} from "../src/lib/reports/whole-cohort-group-labels";
import { mapRawSessions, timetableSessionsToRows } from "../src/lib/reports/session-mappers";
import { sessionToExportRow } from "../src/lib/print-center/export-rows";

const group = (id: string, overrides: Partial<ReportDeliveryGroup> = {}): ReportDeliveryGroup => ({
  id,
  cohort_id: "cohort",
  plan_course_id: "course",
  component_id: "lecture",
  group_code: "G1",
  active: true,
  is_obsolete: false,
  expected_students: 60,
  ...overrides,
});

test("whole cohort is All in instructor rows and program print/export; identity remains intact", () => {
  const original = group("one");
  const labels = {
    cohorts: new Map([["cohort", "دفعة 2026"]]),
    deliveryGroups: wholeCohortGroupLabels([original]),
  };
  const raw = {
    id: "session",
    day_of_week: 6,
    start_time: "08:00",
    end_time: "10:00",
    delivery_group_id: "one",
    cohort_id: "cohort",
  };
  assert.equal(mapRawSessions([raw], labels)[0].delivery_group_label, "All");
  assert.equal(timetableSessionsToRows(mapRawSessions([raw], labels))[0].delivery_group, "All");
  assert.equal(sessionToExportRow(raw, labels).group, "دفعة 2026 / All");
  assert.equal(original.group_code, "G1");
  assert.equal(raw.delivery_group_id, "one");
});

test("split theoretical lectures keep G1/G2 even when only one instructor/group is visible", () => {
  const groups = [group("one"), group("two", { group_code: "G2" })];
  const labels = {
    cohorts: new Map<string, string>(),
    deliveryGroups: wholeCohortGroupLabels(groups),
  };
  const visible = mapRawSessions(
    [{ id: "only-visible-session", delivery_group_id: "one" }],
    labels,
  );
  assert.equal(visible[0].delivery_group_label, "G1");
  assert.equal(labels.deliveryGroups.get("two"), "G2");
});

test("lecture and practical partitions are independent, including unscheduled peers", () => {
  const labels = wholeCohortGroupLabels([
    group("lecture"),
    group("lab1", { component_id: "lab" }),
    group("lab2", { component_id: "lab", group_code: "G2" }),
  ]);
  assert.equal(labels.get("lecture"), "All");
  assert.equal(labels.get("lab1"), "G1");
  assert.equal(labels.get("lab2"), "G2");
});

test("cohorts, study systems, courses and colleges do not share partition counts", () => {
  const labels = wholeCohortGroupLabels([
    group("regular"),
    group("parallel", { cohort_id: "parallel-cohort" }),
    group("other-course", { plan_course_id: "other" }),
  ]);
  assert.deepEqual([...labels.values()], ["All", "All", "All"]);
  assert.equal(wholeCohortGroupLabels([group("other-college")]).get("other-college"), "All");
});

test("inactive/obsolete groups keep stored labels and do not invent live splits", () => {
  const labels = wholeCohortGroupLabels([
    group("live"),
    group("old", { is_obsolete: true, group_code: "G2" }),
    group("inactive", { active: false, group_code: "G3" }),
  ]);
  assert.equal(labels.get("live"), "All");
  assert.equal(labels.get("old"), "G2");
  assert.equal(labels.get("inactive"), "G3");
});

test("known partial headcount or incomplete identity cannot be called All", () => {
  assert.equal(
    wholeCohortGroupLabels([group("partial")], new Map([["cohort", 120]])).get("partial"),
    "G1",
  );
  assert.equal(
    wholeCohortGroupLabels([group("unknown", { component_id: "" })]).get("unknown"),
    "G1",
  );
  assert.equal(
    wholeCohortGroupLabels([group("whole")], new Map([["cohort", 60]])).get("whole"),
    "All",
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_TEMPLATE_FILTERS,
  filterTimeTemplates,
  templateDayCounts,
  timeTemplatePage,
  TEMPLATE_PAGE_SIZE,
  type TimeTemplateRow,
} from "../src/lib/time-templates/template-directory";
import { diffAgainstExisting } from "../src/lib/time-templates/weekly-generator";

const row = (id: string, extra: Partial<TimeTemplateRow> = {}): TimeTemplateRow => ({
  id,
  study_system: "both",
  day_of_week: 6,
  start_time: "08:00:00",
  end_time: "10:00:00",
  slot_duration_minutes: 120,
  is_active: true,
  ...extra,
});
const records = [
  row("shared"),
  row("general", { study_system: "regular" }),
  row("parallel", { study_system: "parallel" }),
  row("inactive-shared", { is_active: false }),
  row("three-hours", { day_of_week: 0, end_time: "11:00:00", slot_duration_minutes: 180 }),
];
const ids = (rows: TimeTemplateRow[]) => rows.map((r) => r.id).sort();

test("available views include active shared templates and exclude the other system", () => {
  assert.deepEqual(
    ids(filterTimeTemplates(records, { ...EMPTY_TEMPLATE_FILTERS, scope: "available_regular" })),
    ["general", "shared", "three-hours"],
  );
  assert.deepEqual(
    ids(filterTimeTemplates(records, { ...EMPTY_TEMPLATE_FILTERS, scope: "available_parallel" })),
    ["parallel", "shared", "three-hours"],
  );
});
test("saved classification remains exact, including inactive templates for management", () => {
  assert.deepEqual(
    ids(filterTimeTemplates(records, { ...EMPTY_TEMPLATE_FILTERS, scope: "both" })),
    ["inactive-shared", "shared", "three-hours"],
  );
  assert.deepEqual(
    ids(filterTimeTemplates(records, { ...EMPTY_TEMPLATE_FILTERS, scope: "regular" })),
    ["general"],
  );
  assert.deepEqual(
    ids(filterTimeTemplates(records, { ...EMPTY_TEMPLATE_FILTERS, scope: "parallel" })),
    ["parallel"],
  );
});
test("duration and status compose with classification and day counts match those filters", () => {
  const filtered = filterTimeTemplates(records, {
    ...EMPTY_TEMPLATE_FILTERS,
    scope: "both",
    duration: "180",
    activity: "active",
  });
  assert.deepEqual(ids(filtered), ["three-hours"]);
  assert.equal(new Map(templateDayCounts(filtered)).get(0), 1);
  assert.equal(new Map(templateDayCounts(filtered)).get(6), 0);
  assert.deepEqual(
    ids(filterTimeTemplates(records, { ...EMPTY_TEMPLATE_FILTERS, activity: "inactive" })),
    ["inactive-shared"],
  );
});
test("Saturday starts the week, then times sort by start and end, without dropping Friday", () => {
  const rows = [
    row("friday", { day_of_week: 5 }),
    row("sun", { day_of_week: 0 }),
    row("long", { end_time: "11:00:00" }),
    row("short"),
    row("later", { start_time: "09:00:00", end_time: "11:00:00" }),
  ];
  assert.deepEqual(
    filterTimeTemplates(rows, EMPTY_TEMPLATE_FILTERS).map((r) => r.id),
    ["short", "long", "later", "sun", "friday"],
  );
  assert.equal(new Map(templateDayCounts(rows)).get(5), 1);
});
test("choosing a day returns only that day and pagination clamps on narrower results", () => {
  const rows = filterTimeTemplates(records, EMPTY_TEMPLATE_FILTERS);
  assert.deepEqual(ids(timeTemplatePage(rows, 0, 9).rows), ["three-hours"]);
  assert.equal(timeTemplatePage(rows, 0, 9).page, 1);
  assert.deepEqual(timeTemplatePage(rows, 4, 1).rows, []);
});
test("all pages cover each template exactly once without losing coincident shared and dedicated records", () => {
  const rows = Array.from({ length: TEMPLATE_PAGE_SIZE * 2 + 1 }, (_, i) => row(String(i)));
  assert.deepEqual(
    [1, 2, 3].flatMap((page) => timeTemplatePage(rows, "all", page).rows.map((r) => r.id)),
    rows.map((r) => r.id),
  );
  assert.equal(timeTemplatePage(rows, "all", 99).page, 3);
  assert.equal(timeTemplatePage(rows, "all", 0).page, 1);
});
test("display filtering cannot hide duplicates from the full-data generation preview", () => {
  const before = structuredClone(records);
  filterTimeTemplates(records, { ...EMPTY_TEMPLATE_FILTERS, scope: "parallel" });
  const diff = diffAgainstExisting([records[1]], records);
  assert.equal(diff.duplicates.length, 1);
  assert.equal(diff.toInsert.length, 0);
  assert.deepEqual(records, before);
});

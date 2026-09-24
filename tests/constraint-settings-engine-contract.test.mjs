import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routeSource = await readFile(
  new URL("../src/routes/_authenticated/constraint-settings.tsx", import.meta.url),
  "utf8",
);
const scorerSource = await readFile(
  new URL("../src/lib/conflict-engine/scorer.ts", import.meta.url),
  "utf8",
);

test("hard constraints are read-only and cannot be demoted from the UI", () => {
  assert.match(routeSource, /\.from\("constraint_types"\)/);
  assert.match(routeSource, /\.eq\("is_hard", true\)/);
  assert.match(routeSource, /إلزامية — لا يمكن تعطيلها أو تخفيف وزنها/);
  assert.doesNotMatch(routeSource, /\.from\("college_constraint_settings"\)/);
});

test("editable quality weights use the same tables consumed by the scorer", () => {
  for (const source of [routeSource, scorerSource]) {
    assert.match(source, /\.from\("quality_metrics"\)/);
    assert.match(source, /\.from\("college_quality_settings"\)/);
  }
  assert.match(routeSource, /quality_metric_id: metricId/);
  assert.match(routeSource, /\.eq\("college_id", active\.id\)/);
});

test("the UI states that quality weights never relax hard conflicts", () => {
  assert.match(routeSource, /لا\s+تعطل\s+القيود الصلبة/);
  assert.match(routeSource, /لا\s+تسمح بتعارض\s+محاضر أو قاعة/);
});

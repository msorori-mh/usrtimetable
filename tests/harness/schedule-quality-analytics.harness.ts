/**
 * schedule-quality-analytics.harness.ts — SCHEDULE-QUALITY-ANALYTICS-CENTER-01
 * Static read-only contract checks (no DB writes).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeScheduleQuality } from "../../src/lib/schedule-quality-analytics/analyze.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};

const route = read("src/routes/_authenticated/reports.quality-analytics.tsx");
assert(
  route.includes('createFileRoute("/_authenticated/reports/quality-analytics")'),
  "quality analytics route registered",
);
assert(route.includes("analyzeScheduleQuality"), "route uses pure analyzer");
assert(
  !/\.from\(\s*["']schedule_sessions["']\s*\)\s*\.(insert|update|upsert|delete)\s*\(/.test(
    route.replace(/\s+/g, " "),
  ),
  "no schedule_sessions DML",
);
assert(
  !/scoreScheduleVersion\s*\(/.test(route) || /persist:\s*false/.test(route),
  "must not persist quality runs from analytics center",
);
assert(!/validateScheduleVersion\s*\(/.test(route), "must not persist conflict checks");

const hub = read("src/routes/_authenticated/reports.index.tsx");
assert(hub.includes("/reports/quality-analytics"), "reports hub links analytics center");

const lib = read("src/lib/schedule-quality-analytics/analyze.ts");
assert(lib.includes("export function analyzeScheduleQuality"), "analyzer exported");
assert(lib.includes("study_system"), "regular/parallel isolation present");

const sample = analyzeScheduleQuality({
  sessions: [
    {
      id: "1",
      instructor_id: "i1",
      room_id: "r1",
      cohort_id: "c1",
      delivery_group_id: "d1",
      study_system: "regular",
      day_of_week: 0,
      start_time: "08:00",
      end_time: "10:00",
    },
  ],
});
assert(sample.session_count === 1, "analyzer runs in harness");
assert(typeof sample.total_score === "number", "score numeric");
assert(
  sample.findings.every((f) => f.formula.length > 0),
  "findings explainable",
);

console.log("schedule-quality-analytics.harness.ts: PASS");

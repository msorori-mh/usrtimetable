/**
 * schedule-version-comparison.harness.ts — SCHEDULE-VERSION-COMPARISON-01
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compareScheduleVersions } from "../../src/lib/schedule-version-comparison/compare.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};

const route = read("src/routes/_authenticated/reports.version-comparison.tsx");
assert(
  route.includes('createFileRoute("/_authenticated/reports/version-comparison")'),
  "comparison route registered",
);
assert(route.includes("compareScheduleVersions"), "uses pure compare");
assert(
  !/\.from\(\s*["']schedule_sessions["']\s*\)\s*\.(insert|update|upsert|delete)\s*\(/.test(
    route.replace(/\s+/g, " "),
  ),
  "no session DML",
);
assert(!/cloneVersion\s*\(/.test(route), "must not clone versions");

const hub = read("src/routes/_authenticated/reports.index.tsx");
assert(hub.includes("/reports/version-comparison"), "hub links comparison");

const sample = compareScheduleVersions({
  versionA: [
    {
      id: "1",
      instructor_id: "i",
      room_id: "r",
      delivery_group_id: "d",
      study_system: "regular",
      day_of_week: 0,
      start_time: "08:00",
      end_time: "10:00",
      course_offering_id: "c",
      teaching_assignment_id: "t",
    },
  ],
  versionB: [
    {
      id: "2",
      instructor_id: "i",
      room_id: "r",
      delivery_group_id: "d",
      study_system: "regular",
      day_of_week: 0,
      start_time: "08:00",
      end_time: "10:00",
      course_offering_id: "c",
      teaching_assignment_id: "t",
    },
  ],
});
assert(sample.changes.length === 0, "identical logical sessions => no changes");

console.log("schedule-version-comparison.harness.ts: PASS");

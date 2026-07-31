import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSmartSuggestions } from "../../src/lib/smart-suggestions/build.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(`FAIL: ${m}`);
};

const route = read("src/routes/_authenticated/reports.smart-suggestions.tsx");
assert(route.includes("buildSmartSuggestions"), "uses builder");
assert(route.includes("preview_only"), "preview badge");
assert(
  !/\.from\(\s*["']schedule_sessions["']\s*\)\s*\.(insert|update|upsert|delete)\s*\(/.test(
    route.replace(/\s+/g, " "),
  ),
  "no session writes",
);
assert(read("src/routes/_authenticated/reports.index.tsx").includes("/reports/smart-suggestions"));

const sample = buildSmartSuggestions({
  unscheduled: [{ id: "u", study_system: "regular", instructor_id: "i", expected_students: 10 }],
  existingSessions: [],
  rooms: [{ id: "r", capacity: 40 }],
});
assert(sample[0].auto_apply === false, "auto_apply false");
assert(sample[0].preview_only === true, "preview only");

console.log("smart-suggestions.harness.ts: PASS");

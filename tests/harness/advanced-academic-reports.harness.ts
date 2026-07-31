import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const assert = (c: unknown, m: string) => {
  if (!c) throw new Error(`FAIL: ${m}`);
};

const route = read("src/routes/_authenticated/reports.advanced-academic.tsx");
assert(route.includes("advanced-academic"), "route id");
assert(
  route.includes("بلا Migration") || route.includes("بلا مصدر بيانات جديد"),
  "no new schema claim",
);
assert(
  !/\.from\(\s*["']schedule_sessions["']\s*\)\s*\.(insert|update|upsert|delete)\s*\(/.test(
    route.replace(/\s+/g, " "),
  ),
  "no DML",
);
assert(read("src/routes/_authenticated/reports.index.tsx").includes("/reports/advanced-academic"));
console.log("advanced-academic-reports.harness.ts: PASS");

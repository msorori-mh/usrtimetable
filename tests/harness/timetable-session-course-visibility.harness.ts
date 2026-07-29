/**
 * Static harness: timetable/report session visibility must not use nested
 * course_offerings(...courses(...)) embeds (PGRST200).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};

const nestedCourses = (body: string) => {
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const literals = [...stripped.matchAll(/=\s*`([\s\S]*?)`/g)].map((m) => m[1]);
  return literals.some((lit) => /course_offerings\s*\([^)]*courses\s*\(/i.test(lit.replace(/\s+/g, " ")));
};

const timetable = read("src/routes/_authenticated/timetable.$versionId.tsx");
assert(
  timetable.includes("fetchHydratedVersionSessions"),
  "timetable editor loads sessions via fetchHydratedVersionSessions",
);
assert(!nestedCourses(timetable), "timetable editor has no nested courses() embed");

const sessionQueries = read("src/lib/reports/queries/session-queries.ts");
assert(
  sessionQueries.includes("hydrateWorkspaceSessions"),
  "reports session queries hydrate via hydrateWorkspaceSessions",
);
assert(!nestedCourses(sessionQueries), "session-queries has no nested courses() embed");
assert(
  sessionQueries.includes("selectContainsNestedCoursesEmbed"),
  "PGRST200 guard helper is exported",
);

const operational = read("src/lib/reports/queries/operational-queries.ts");
assert(
  operational.includes("hydrateWorkspaceSessions") && !nestedCourses(operational),
  "conflict evidence uses hydrate without nested courses()",
);

const queries = read("src/lib/schedule-builder/queries.ts");
assert(
  queries.includes("export async function fetchHydratedVersionSessions") &&
    queries.includes("export async function hydrateWorkspaceSessions"),
  "shared hydrate + version fetch are exported",
);

// Visibility fix surfaces must not introduce schedule_sessions DML in query modules.
for (const rel of [
  "src/lib/reports/queries/session-queries.ts",
  "src/lib/reports/queries/operational-queries.ts",
  "src/lib/schedule-builder/queries.ts",
]) {
  const body = read(rel);
  assert(
    !/\.from\(\s*["']schedule_sessions["']\s*\)\s*\.(insert|update|upsert|delete)\s*\(/.test(
      body.replace(/\s+/g, " "),
    ),
    `${rel} must not mutate schedule_sessions`,
  );
}

assert(
  timetable.includes("fetchHydratedVersionSessions") &&
    !timetable.includes("courses(code, name, department_id)"),
  "timetable visibility path is hydrate-only for courses",
);

console.log("PASS timetable-session-course-visibility");

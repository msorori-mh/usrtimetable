import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SPECIFIC_VERSION_STATUSES } from "../../src/lib/reports/filters.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const route = readFileSync(
  join(root, "src/routes/_authenticated/reports.instructor-schedule.tsx"),
  "utf8",
);
const universityQueries = readFileSync(
  join(root, "src/lib/reports/queries/university-instructor-schedule.ts"),
  "utf8",
);
const queries = readFileSync(join(root, "src/lib/reports/queries/session-queries.ts"), "utf8");

assert(SPECIFIC_VERSION_STATUSES.includes("draft"), "draft schedule versions remain reportable");
assert(route.includes("useReportContext"), "lecturer report resolves the selected draft version");
assert(
  route.includes("fetchUniversityInstructorSchedule") &&
    universityQueries.includes("fetchInstructorScheduleSessions") &&
    universityQueries.includes("versionId: scope.version.id") &&
    universityQueries.includes("collegeId: scope.collegeId"),
  "lecturer report uses the shared version-scoped read model",
);
assert(route.includes("ctx.versionId"), "selected version identity is part of the report query");
assert(
  route.includes('fixedStudySystem: "all"') && universityQueries.includes('studySystem: "all"'),
  "university totals explicitly include every study system",
);
assert(
  route.includes('setInsId("")') && route.includes("[ctx.collegeId]"),
  "lecturer selection resets when the active college changes",
);
assert(
  route.includes("directory.error") &&
    route.includes("schedule.error") &&
    route.includes("selection.error") &&
    route.includes("ctx.error") &&
    route.includes("queryError") &&
    universityQueries.includes("readAllReportRows"),
  "context, lecturer, and session query failures are not reported as empty data",
);
const loadingExpression = route.match(/const isLoading\s*=([\s\S]*?);/)?.[1] ?? "";
assert(
  ["ctx", "directory", "schedule", "currentUser", "teachingColleges"].every((source) =>
    loadingExpression.includes(`${source}.isLoading`),
  ),
  "context, lecturer, role and teaching-scope loading participate in the report loading state",
);
assert(
  !route.includes('.from("schedule_sessions")'),
  "lecturer route has no divergent direct session query",
);
assert(
  queries.includes('.eq("schedule_version_id", params.versionId)') &&
    queries.includes('.eq("instructor_id", params.instructorId)'),
  "shared read model scopes draft sessions to one version and lecturer",
);

console.log("draft-lecturer-report.harness.ts: PASS");

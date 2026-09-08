import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSchedulingHeadcount } from "../../src/lib/scheduling-headcount/resolve";
import { validateHeadcountValues } from "../../src/lib/scheduling-headcount/rules";
import { readPrimaryNavigationSource } from "./nav-source";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const migrationPath =
  "supabase/migrations/20260721180000_source_only_scheduling_headcount_foundation.sql";
assert.ok(existsSync(path.join(root, migrationPath)), "source-only migration must exist");
const migration = read(migrationPath);

assert.match(migration, /SOURCE ONLY/);
assert.match(migration, /NOT APPLIED/);
assert.doesNotMatch(migration, /\bBACKFILL\b/i);
assert.doesNotMatch(
  migration,
  /INSERT\s+INTO\s+public\.(academic_cohorts|course_offerings|plan_course_components|students)\b/i,
);
assert.doesNotMatch(migration, /\b(national_id|student_name|student_email|student_phone)\b/i);
for (const table of [
  "scheduling_cohort_term_headcounts",
  "scheduling_headcount_overrides",
  "scheduling_headcount_revisions",
]) {
  assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}`));
}
for (const fn of [
  "upsert_scheduling_cohort_term_headcount",
  "approve_scheduling_cohort_term_headcount",
  "upsert_scheduling_headcount_override",
  "archive_scheduling_headcount_override",
  "resolve_scheduling_headcount",
  "list_scheduling_headcount_revisions",
]) {
  assert.match(migration, new RegExp(`FUNCTION public\\.${fn}`));
}
assert.match(migration, /SECURITY DEFINER SET search_path = public, pg_temp/g);
assert.match(migration, /REVOKE ALL ON FUNCTION/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION/);
assert.doesNotMatch(migration, /teaching_assignments.*TRIGGER|TRIGGER.*teaching_assignments/i);

assert.deepEqual(
  validateHeadcountValues({
    registeredStudentCount: -1,
    eligibleStudentCount: 1,
    expectedAttendanceCount: 1,
    reserveMargin: 0,
    schedulingHeadcount: 1,
    examEligibleCount: 1,
  }),
  ["NEGATIVE_COUNT"],
);
assert.deepEqual(
  validateHeadcountValues({
    registeredStudentCount: 1,
    eligibleStudentCount: 1,
    expectedAttendanceCount: 2,
    reserveMargin: 0,
    schedulingHeadcount: 1,
    examEligibleCount: 1,
  }),
  ["OVER_ELIGIBLE_REQUIRES_REASON"],
);
assert.deepEqual(
  validateHeadcountValues({
    registeredStudentCount: 1,
    eligibleStudentCount: 1,
    expectedAttendanceCount: 2,
    reserveMargin: 0,
    schedulingHeadcount: 1,
    examEligibleCount: 1,
    allowOverEligible: true,
    notes: "approved exception",
  }),
  [],
);
assert.equal(resolveSchedulingHeadcount(null, null).blocker, true);
assert.equal(resolveSchedulingHeadcount(null, null).code, "SCHEDULING_HEADCOUNT_MISSING");

const resolveSource = read("src/lib/scheduling-headcount/resolve.ts");
assert.doesNotMatch(resolveSource, /registeredStudentCount|expected_students/);
assert.match(read("src/lib/reports/readiness.ts"), /SCHEDULING_HEADCOUNT_MISSING/);
assert.match(
  read("src/lib/academic-delivery/generate-delivery-groups.ts"),
  /SCHEDULING_HEADCOUNT_MISSING/,
);
assert.match(
  read("src/routes/_authenticated/scheduling-headcounts.tsx"),
  /أعداد الدفعات المعتمدة للجدولة/,
);
assert.match(readPrimaryNavigationSource(root), /أعداد الدفعات المعتمدة للجدولة/);

console.log(
  JSON.stringify({ harness: "scheduling-headcount-foundation", status: "pass" }, null, 2),
);

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const migrationPath =
  "supabase/migrations/20260722090000_source_only_shared_lecture_groups.sql";
assert.ok(existsSync(path.join(root, migrationPath)), "source-only migration must exist");
const migration = read(migrationPath);

assert.match(migration, /SOURCE ONLY/);
assert.match(migration, /NOT APPLIED/);
assert.match(migration, /APPROVE_DB_MIGRATION_APPLY/);
assert.match(migration, /20260721180000/, "must declare the headcount prerequisite");
assert.doesNotMatch(migration, /\bBACKFILL\b/i);
// The legacy model must never appear in this migration.
assert.doesNotMatch(migration, /\bsections?\b/i);
// No DML against operational business rows.
assert.doesNotMatch(
  migration,
  /INSERT\s+INTO\s+public\.(academic_cohorts|delivery_groups|plan_course_components|course_offerings|scheduling_cohort_term_headcounts)\b/i,
);
assert.doesNotMatch(migration, /\b(national_id|student_name|student_email|student_phone)\b/i);

for (const table of [
  "shared_lecture_groups",
  "shared_lecture_group_components",
  "shared_lecture_group_cohorts",
  "shared_lecture_group_revisions",
]) {
  assert.match(migration, new RegExp(`CREATE TABLE public\\.${table}`));
  assert.match(
    migration,
    new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`),
  );
}

for (const fn of [
  "create_shared_lecture_group",
  "add_component_to_shared_lecture_group",
  "add_cohort_to_shared_lecture_group",
  "remove_cohort_from_shared_lecture_group",
  "resolve_shared_lecture_group_capacity",
  "list_shared_lecture_group_revisions",
]) {
  assert.match(migration, new RegExp(`FUNCTION public\\.${fn}`));
}

assert.match(migration, /SECURITY DEFINER SET search_path = public, pg_temp/g);
assert.match(migration, /REVOKE ALL ON FUNCTION/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION/);
assert.match(migration, /REVOKE INSERT, UPDATE, DELETE/);
assert.match(migration, /can_view_college\(auth\.uid\(\), college_id\)/);
assert.match(migration, /can_manage_college/);
assert.match(migration, /is_super_admin/);
assert.match(migration, /INSERT INTO public\.audit_logs/);
assert.match(migration, /set_updated_at\(\)/);

// Fail-closed capacity + governance invariants.
assert.match(migration, /SHARED_GROUP_HEADCOUNT_MISSING/);
assert.match(migration, /SHARED_GROUP_NO_COHORTS/);
assert.match(migration, /CROSS_COLLEGE_REQUIRES_SUPER_ADMIN/);
assert.match(migration, /STUDY_SYSTEM_MIX_REJECTED/);
assert.match(migration, /approval_status = 'approved'/);
assert.match(migration, /sum\(h\.scheduling_headcount\)/i);
assert.match(migration, /UNIQUE \(group_id, cohort_id\)/);
assert.match(migration, /UNIQUE \(group_id, plan_course_component_id\)/);
assert.match(migration, /FOREIGN KEY \(group_id, college_id\) REFERENCES public\.shared_lecture_groups\(id, college_id\)/);
assert.match(migration, /FOREIGN KEY \(cohort_id, college_id\) REFERENCES public\.academic_cohorts\(id, college_id\)/);
assert.match(migration, /FOREIGN KEY \(plan_course_component_id, college_id\) REFERENCES public\.plan_course_components\(id, college_id\)/);

// Removing a cohort must only touch the membership link table.
assert.match(migration, /DELETE FROM public\.shared_lecture_group_cohorts/);
assert.doesNotMatch(migration, /DELETE FROM public\.delivery_groups/);

const reportPath =
  "implementation-reports/USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01/A2-1-SHARED-LECTURE-GROUPS-DOMAIN-MODEL-01.md";
assert.ok(existsSync(path.join(root, reportPath)), "domain model report must exist");
const report = read(reportPath);
assert.match(report, /NOT APPLIED/);
assert.match(report, /A2\.2/);
assert.match(report, /A2\.3/);
assert.match(report, /A2\.4/);

console.log(
  JSON.stringify({ harness: "shared-lecture-groups", status: "pass" }, null, 2),
);

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const migrationPath =
  "supabase/migrations/20260722120000_source_only_shared_lecture_groups_authz.sql";
assert.ok(existsSync(path.join(root, migrationPath)), "source-only authz migration must exist");
const migration = read(migrationPath);

const firstLine = migration.split("\n", 1)[0];
assert.match(firstLine, /^-- SOURCE ONLY — NOT APPLIED — gate APPROVE_DB_MIGRATION_APPLY/);
assert.match(migration, /20260722090000/, "must declare the A2.1 prerequisite");
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

// A2.1 migration file must exist and must NOT be rewritten by A2.2 (stacked forward-hardening).
const a21Path =
  "supabase/migrations/20260722090000_source_only_shared_lecture_groups.sql";
assert.ok(existsSync(path.join(root, a21Path)), "A2.1 migration must still exist");
const a21 = read(a21Path);
assert.match(a21, /CROSS_COLLEGE_GROUP_NOT_SUPPORTED/, "A2.1 file must remain the A2.1 version");
assert.doesNotMatch(a21, /transition_shared_lecture_group_status/, "A2.2 RPCs must not be back-ported into the A2.1 file");

// Status lifecycle via gated RPC; direct table writes stay revoked.
assert.match(migration, /ADD CONSTRAINT shared_lecture_groups_status_check/);
assert.match(migration, /CHECK \(status IN \('draft', 'active', 'locked', 'archived'\)\)/);
assert.match(migration, /FUNCTION public\.transition_shared_lecture_group_status/);
assert.match(migration, /INVALID_STATUS_TRANSITION/);
assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON public\.shared_lecture_groups/);
assert.doesNotMatch(migration, /GRANT UPDATE ON public\.shared_lecture_groups/);

// Activation is fail-closed.
assert.match(migration, /SHARED_GROUP_NO_COMPONENTS/);
assert.match(migration, /SHARED_GROUP_NO_COHORTS/);
assert.match(migration, /SHARED_GROUP_HEADCOUNT_MISSING/);
assert.match(migration, /approval_status = 'approved'/);

// Component unlink RPC with fail-closed UNKNOWN session dependency.
assert.match(migration, /FUNCTION public\.remove_component_from_shared_lecture_group/);
assert.match(migration, /SHARED_GROUP_COMPONENT_UNLINK_BLOCKED/);
assert.match(migration, /dependency_evidence', 'UNKNOWN'/);
assert.match(migration, /DELETE FROM public\.shared_lecture_group_components/);
assert.doesNotMatch(migration, /DELETE FROM public\.plan_course_components/);
assert.doesNotMatch(migration, /DELETE FROM public\.delivery_groups/);

// super_admin cross-college path on a dedicated table; composite same-college FKs untouched.
assert.match(migration, /CREATE TABLE public\.shared_lecture_group_cross_college_cohorts/);
assert.match(migration, /ALTER TABLE public\.shared_lecture_group_cross_college_cohorts ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /FUNCTION public\.add_cross_college_cohort_to_shared_lecture_group/);
assert.match(migration, /FUNCTION public\.remove_cross_college_cohort_from_shared_lecture_group/);
assert.match(migration, /CROSS_COLLEGE_REQUIRES_SUPER_ADMIN/);
assert.match(migration, /CROSS_COLLEGE_USE_SUPER_ADMIN_PATH/);
assert.match(migration, /is_super_admin/);
assert.match(migration, /REFERENCES public\.shared_lecture_groups\(id, college_id\)/);
assert.doesNotMatch(
  migration,
  /ALTER TABLE public\.shared_lecture_group_(components|cohorts)\s+DROP CONSTRAINT/,
  "A2.1 composite FKs must not be weakened",
);

// Locked groups reject membership/component changes in every write RPC.
assert.match(migration, /GROUP_LOCKED/);
assert.match(migration, /GROUP_ARCHIVED/);

// Regular/parallel mixing stays rejected across both membership paths.
assert.match(migration, /STUDY_SYSTEM_MIX_REJECTED/);

// Revision kinds extended without dropping A2.1 kinds.
assert.match(migration, /'create', 'add_component', 'add_cohort', 'remove_cohort'/);
assert.match(migration, /'remove_component', 'status_transition'/);
assert.match(migration, /'add_cross_college_cohort', 'remove_cross_college_cohort'/);

// Every write RPC audits.
const auditCount = (migration.match(/INSERT INTO public\.audit_logs/g) ?? []).length;
assert.ok(auditCount >= 8, `expected >= 8 audit inserts, found ${auditCount}`);

// House privilege discipline.
assert.match(migration, /SECURITY DEFINER SET search_path = public, pg_temp/g);
assert.match(migration, /REVOKE ALL ON FUNCTION/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION/);
assert.match(migration, /TO authenticated, service_role/);
assert.match(migration, /can_view_college\(auth\.uid\(\), college_id\)/);
assert.match(migration, /can_manage_college/);
assert.match(migration, /sum\(h\.scheduling_headcount\)/i);

const reportPath =
  "implementation-reports/USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01/A2-2-SHARED-LECTURE-GROUPS-AUTHZ-01.md";
assert.ok(existsSync(path.join(root, reportPath)), "A2.2 report must exist");
const report = read(reportPath);
assert.match(report, /NOT APPLIED/);
assert.match(report, /UNKNOWN/);
assert.match(report, /super_admin/);
assert.match(report, /SHARED_GROUP_COMPONENT_UNLINK_BLOCKED/);

console.log(
  JSON.stringify({ harness: "shared-lecture-groups-authz", status: "pass" }, null, 2),
);

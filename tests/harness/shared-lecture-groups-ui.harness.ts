import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const pagePath = "src/routes/_authenticated/shared-lecture-groups.tsx";
const apiPath = "src/lib/shared-lecture-groups/api.ts";
const rulesPath = "src/lib/shared-lecture-groups/rules.ts";
const typesPath = "src/lib/shared-lecture-groups/types.ts";
const reportPath =
  "implementation-reports/USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01/A2-3-SHARED-LECTURE-GROUPS-UI-01.md";
for (const p of [pagePath, apiPath, rulesPath, typesPath, reportPath]) {
  assert.ok(existsSync(path.join(root, p)), `${p} must exist`);
}
const page = read(pagePath);
const api = read(apiPath);
const rules = read(rulesPath);
const types = read(typesPath);

// A2.1/A2.2 source-only migrations are the contract; RPC names + p_* args must match.
const a21 = read("supabase/migrations/20260722090000_source_only_shared_lecture_groups.sql");
const a22 = read("supabase/migrations/20260722120000_source_only_shared_lecture_groups_authz.sql");
const contract = `${a21}\n${a22}`;

const RPCS: Array<{ name: string; args: string[] }> = [
  { name: "create_shared_lecture_group", args: ["p_college_id", "p_term_id", "p_name", "p_notes"] },
  { name: "add_component_to_shared_lecture_group", args: ["p_group_id", "p_plan_course_component_id", "p_notes"] },
  { name: "remove_component_from_shared_lecture_group", args: ["p_group_id", "p_plan_course_component_id", "p_notes"] },
  { name: "add_cohort_to_shared_lecture_group", args: ["p_group_id", "p_cohort_id", "p_notes"] },
  { name: "remove_cohort_from_shared_lecture_group", args: ["p_group_id", "p_cohort_id", "p_notes"] },
  { name: "add_cross_college_cohort_to_shared_lecture_group", args: ["p_group_id", "p_cohort_id", "p_notes"] },
  { name: "remove_cross_college_cohort_from_shared_lecture_group", args: ["p_group_id", "p_cohort_id", "p_notes"] },
  { name: "transition_shared_lecture_group_status", args: ["p_group_id", "p_target_status", "p_notes"] },
  { name: "resolve_shared_lecture_group_capacity", args: ["p_group_id"] },
  { name: "list_shared_lecture_group_revisions", args: ["p_group_id"] },
];
for (const rpc of RPCS) {
  assert.match(contract, new RegExp(`FUNCTION public\\.${rpc.name}\\(`), `${rpc.name} must exist in A2.1/A2.2 migrations`);
  assert.ok(api.includes(`"${rpc.name}"`), `api.ts must call ${rpc.name}`);
  for (const arg of rpc.args) {
    assert.ok(api.includes(`${arg}:`), `api.ts must pass ${arg} to ${rpc.name}`);
    assert.match(contract, new RegExp(`${arg} (uuid|text)`), `${rpc.name} must declare ${arg} in the migration`);
  }
}

// PR #62 style: local types + rpc(name as never); generated types.ts untouched.
assert.match(api, /rpc\(name as never, args as never\)/);
assert.doesNotMatch(api, /integrations\/supabase\/types/);
assert.match(types, /SharedLectureGroup/);
assert.match(types, /SharedGroupRpcResult/);

// Writes are RPC-only: no direct DML anywhere in the UI layer.
assert.doesNotMatch(api, /\.from\(/, "api.ts must contain no table access at all (RPC-only)");
for (const source of [page, api]) {
  assert.doesNotMatch(
    source,
    /\.(insert|update|delete|upsert)\s*\(/,
    "no direct DML (insert/update/delete/upsert) allowed in the UI layer",
  );
}

// No legacy Section model references in the New Flow UI.
for (const [name, source] of Object.entries({ page, api, rules, types })) {
  assert.doesNotMatch(source, /\bsection_id\b/i, `${name}: no section_id`);
  assert.doesNotMatch(source, /\bcourse_offerings\b/i, `${name}: no course_offerings`);
  assert.doesNotMatch(source, /\bsection_number\b/i, `${name}: no section_number`);
}

// Readiness blocker documented inside the page (source-only NOT APPLIED).
assert.match(page, /NOT APPLIED/);
assert.match(page, /APPROVE_DB_MIGRATION_APPLY/);
assert.match(page, /مانع جاهزية موثق/);

// Official terminology (المصطلحات الرسمية).
assert.match(page, /المجموعات المشتركة للمحاضرات/);
assert.match(page, /الدفعات الدراسية/);
assert.match(page, /أعداد الدفعات المعتمدة للجدولة/);
assert.match(page, /مجموعات المحاضرات والمعامل/);

// Fail-closed codes surfaced with clear Arabic messages.
for (const code of [
  "SHARED_GROUP_NO_COMPONENTS",
  "SHARED_GROUP_NO_COHORTS",
  "SHARED_GROUP_HEADCOUNT_MISSING",
  "GROUP_LOCKED",
  "GROUP_ARCHIVED",
  "SHARED_GROUP_COMPONENT_IN_USE",
  "SHARED_GROUP_COMPONENT_UNLINK_BLOCKED",
  "STUDY_SYSTEM_MIX_REJECTED",
  "INVALID_STATUS_TRANSITION",
  "CROSS_COLLEGE_REQUIRES_SUPER_ADMIN",
]) {
  assert.ok(rules.includes(code), `rules.ts must map ${code} to an Arabic message`);
}
// Regular/parallel mixing rejection is shown clearly (لا خلط منتظم/موازي).
assert.match(page, /STUDY_SYSTEM_MIX_REJECTED/);
assert.match(rules, /منتظم\/موازي/);

// Capacity stays fail-closed: RPC-resolved, blocked state, never computed in the UI.
assert.match(page, /resolveSharedLectureGroupCapacity/);
assert.match(page, /حالة blocked/);
assert.doesNotMatch(page, /\.reduce\(/, "UI must never sum headcounts itself");
assert.match(api, /resolve_shared_lecture_group_capacity/);

// Role isolation: super_admin-only cross-college UI; canManage gates all write buttons.
assert.match(page, /isSuperAdmin/);
assert.match(page, /addCrossCollegeCohortToSharedLectureGroup/);
assert.match(page, /useCanManageActiveCollege/);
assert.match(page, /وضع قراءة فقط/);

// Status lifecycle labels/edges mirror the A2.2 contract (no rollback; archive from any).
assert.match(rules, /draft:\s*\["active",\s*"archived"\]/);
assert.match(rules, /active:\s*\["locked",\s*"archived"\]/);
assert.match(rules, /locked:\s*\["archived"\]/);
assert.match(rules, /archived:\s*\[\]/);
assert.match(page, /SHARED_GROUP_ALLOWED_TRANSITIONS/);

// NAV entry with the official label + route registration (house manual style).
const appLayout = read("src/components/app-layout.tsx");
assert.match(appLayout, /المجموعات المشتركة للمحاضرات/);
assert.match(appLayout, /"\/shared-lecture-groups"/);
const routeTree = read("src/routeTree.gen.ts");
assert.match(routeTree, /AuthenticatedSharedLectureGroupsRouteImport/);
assert.match(routeTree, /'\/_authenticated\/shared-lecture-groups'/);
assert.match(routeTree, /'\/shared-lecture-groups'/);

// Registered in the harness runner.
const runner = read("tests/harness/run.mjs");
assert.match(runner, /"shared-lecture-groups-ui\.harness\.ts"/);

// Report exists and is honest about the readiness blocker and unknowns.
const report = read(reportPath);
assert.match(report, /NOT APPLIED/);
assert.match(report, /APPROVE_DB_MIGRATION_APPLY/);
assert.match(report, /UNKNOWN/);

console.log(
  JSON.stringify({ harness: "shared-lecture-groups-ui", status: "pass" }, null, 2),
);

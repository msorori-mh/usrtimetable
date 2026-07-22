import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

// A4: Audit Viewer + Readiness Dashboard UI (source-only, read-only).
const auditRoute = read("src/routes/_authenticated/audit-logs.tsx");
const auditModel = read("src/lib/audit-logs/model.ts");
const dashRoute = read("src/routes/_authenticated/readiness-dashboard.tsx");
const checksLib = read("src/lib/readiness/checks.ts");
const routeTree = read("src/routeTree.gen.ts");
const layout = read("src/components/app-layout.tsx");

// 1) Routes registered (TanStack Router file-based routing + committed routeTree)
assert.ok(
  auditRoute.includes('createFileRoute("/_authenticated/audit-logs")'),
  "audit-logs route must be /_authenticated/audit-logs",
);
assert.ok(
  dashRoute.includes('createFileRoute("/_authenticated/readiness-dashboard")'),
  "readiness-dashboard route must be /_authenticated/readiness-dashboard",
);
for (const token of [
  "'/_authenticated/audit-logs'",
  "'/_authenticated/readiness-dashboard'",
  "AuthenticatedAuditLogsRouteImport",
  "AuthenticatedReadinessDashboardRouteImport",
]) {
  assert.ok(routeTree.includes(token), `routeTree.gen.ts missing: ${token}`);
}
assert.ok(layout.includes('to: "/audit-logs"'), "audit-logs nav entry missing");
assert.ok(layout.includes('to: "/readiness-dashboard"'), "readiness-dashboard nav entry missing");

// 2) No-write guarantee: no DML, no RPC, no logAudit in any of the new files.
//    (Enforcement stays in RLS/grants; the UI must not even attempt writes.)
for (const [name, content] of [
  ["audit-logs.tsx", auditRoute],
  ["audit-logs/model.ts", auditModel],
  ["readiness-dashboard.tsx", dashRoute],
  ["readiness/checks.ts", checksLib],
] as Array<[string, string]>) {
  assert.equal(
    /\.(insert|update|delete|upsert)\(/.test(content),
    false,
    `${name} must not contain direct DML (insert/update/delete/upsert)`,
  );
  assert.equal(content.includes("supabase.rpc("), false, `${name} must not call RPCs`);
  assert.equal(content.includes("logAudit"), false, `${name} must not write audit logs`);
}

// 3) Keyset pagination (never offset) for the append-heavy audit table
assert.ok(auditModel.includes('.lt("created_at"'), "audit model must use keyset cursor pagination");
assert.equal(auditModel.includes(".range("), false, "audit model must not use offset pagination");

// 4) Sensitive-field redaction (design §4.2)
assert.ok(
  auditModel.includes("token|secret|password|apikey|api_key|jwt"),
  "redaction key pattern missing",
);
assert.ok(auditModel.includes("•••"), "redaction placeholder missing");

// 5) RLS posture: no college selector for non-super_admin (selector = UX only)
assert.ok(
  auditRoute.includes("{isSuperAdmin && <CollegeSwitcher />}"),
  "college selector must be gated to super_admin (UX only; RLS is the boundary)",
);

// 6) No Legacy data access in New Flow screens (Legacy read-paths stay in legacy routes only)
for (const [name, content] of [
  ["audit-logs.tsx", auditRoute],
  ["audit-logs/model.ts", auditModel],
  ["readiness-dashboard.tsx", dashRoute],
  ["readiness/checks.ts", checksLib],
] as Array<[string, string]>) {
  assert.equal(content.includes('from("sections")'), false, `${name} must not read sections`);
  assert.equal(
    content.includes('from("course_offering_sections")'),
    false,
    `${name} must not read course_offering_sections`,
  );
  assert.equal(
    content.includes('from("section_groups")'),
    false,
    `${name} must not read section_groups`,
  );
  assert.equal(
    /\.eq\("section_id"/.test(content),
    false,
    `${name} must not filter by section_id`,
  );
  assert.equal(content.includes("مجموعات التدريس"), false, `${name} must not use legacy term`);
}

// 7) Official terminology (mandated terms present)
for (const term of [
  "الدفعات الدراسية",
  "المقررات الاختيارية المعتمدة",
  "أيام وفترات الدوام",
  "مجموعات المحاضرات والمعامل",
  "الإسناد التدريسي",
  "المجموعات المشتركة للمحاضرات",
  "أعداد الدفعات المعتمدة للجدولة",
]) {
  assert.ok(
    `${checksLib}${dashRoute}${auditRoute}${auditModel}`.includes(term),
    `missing official term: ${term}`,
  );
}

// 8) All 15 readiness checks registered (B1..B15) with status vocabulary
for (const id of ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12", "B13", "B14", "B15"]) {
  assert.ok(checksLib.includes(`id: "${id}"`), `readiness check ${id} missing`);
}
assert.ok(
  checksLib.includes('"PASS" | "BLOCKED" | "UNKNOWN"'),
  "check status vocabulary must be PASS/BLOCKED/UNKNOWN",
);

// 9) B11 migration manifest mirrors STATE.json (fail-closed, APPROVE gate)
for (const token of [
  "20260721180000_source_only_scheduling_headcount_foundation.sql",
  "20260721090000_source_only_legacy_write_hardening.sql",
  "APPROVE_DB_MIGRATION_APPLY",
  "HELD",
  "APPROVE_LEGACY_DATA_REMEDIATION",
]) {
  assert.ok(checksLib.includes(token), `migration manifest missing: ${token}`);
}

// 10) Fail-closed headcount link (PR #62 pattern): B4 degrades to UNKNOWN pre-apply
assert.ok(
  checksLib.includes("scheduling_cohort_term_headcounts"),
  "B4 must link to scheduling headcount (fail-closed UNKNOWN pre-apply)",
);

console.log(JSON.stringify({ harness: "audit-readiness-ui", status: "pass" }));

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const name = "20261002010000_assignment_workspace_version_view.sql";

test("the per-version read model is derived from the operational workspace and stays additive", async () => {
  const sql = await read(`supabase/migrations/${name}`);

  // Same source of truth as the publish gate and version allocation checks.
  assert.match(sql, /public\.version_effective_assignments\(p_schedule_version_id\)/);
  assert.match(sql, /e\.college_id = p_college_id/);
  // Derived from the live operational function, with a drift guard per patch.
  assert.match(sql, /pg_get_functiondef\(src\)/);
  assert.match(sql, /ASSIGNMENT_WORKSPACE_VERSION_VIEW_DRIFT/);
  assert.match(sql, /occurrences <> 1/);
  // The version must belong to the college the caller was authorised for.
  assert.match(sql, /SCHEDULE_VERSION_NOT_IN_COLLEGE/);
  assert.match(sql, /sv\.id = p_schedule_version_id AND sv\.college_id = p_college_id/);
  // Read model only: no write affordance and no anonymous access.
  assert.match(sql, /'can_manage', false/);
  assert.match(sql, /FROM PUBLIC, anon;/);
  assert.match(sql, /TO authenticated;/);
  assert.match(sql, /'version_scoped', ta\.scope_version_id IS NOT NULL/);

  // Nothing existing is rewritten.
  assert.doesNotMatch(
    sql,
    /CREATE OR REPLACE FUNCTION public\.list_teaching_assignment_workspace\(/,
  );
  assert.doesNotMatch(sql, /\b(INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE|DROP)\b/);
});

test("rollback removes only the added function", async () => {
  const sql = await read(`supabase/rollbacks/${name}`);
  const statements = sql
    .split(";")
    .map((statement) => statement.replace(/--.*$/gm, "").trim())
    .filter(Boolean);
  assert.deepEqual(
    statements.map((statement) => statement.split(/\s+/).slice(0, 2).join(" ")),
    ["BEGIN", "DROP FUNCTION", "COMMIT"],
  );
  assert.match(sql, /list_teaching_assignment_workspace_for_version\(/);
});

test("the page offers the version view as read-only and keeps writes operational", async () => {
  const [page, service, model] = await Promise.all([
    read("src/routes/_authenticated/teaching-assignments.tsx"),
    read("src/lib/academic-delivery/teaching-assignments-v2-service.ts"),
    read("src/lib/academic-delivery/teaching-assignments-v2.ts"),
  ]);

  assert.match(service, /"list_teaching_assignment_workspace_for_version"/);
  assert.match(service, /"list_teaching_assignment_workspace"/);
  assert.match(model, /p_schedule_version_id: filters\.scheduleVersionId/);
  assert.match(model, /SCHEDULE_VERSION_NOT_IN_COLLEGE/);

  assert.match(page, /ta-v2-view-version/);
  // Only a version of the active college and term is ever sent to the server.
  assert.match(page, /scheduleVersionId: viewVersion\?\.id \?\? null/);
  // Days and lecturers come from the same version once one is chosen.
  assert.match(
    page,
    /if \(viewVersion\) return loadAssignmentSchedule\(supabase, active!\.id, \[viewVersion\]\)/,
  );
  // A stale selection (other college or term) falls back to the operational view.
  assert.match(
    page,
    /\(workingVersions \?\? \[\]\)\.find\(\(version\) => version\.id === viewVersionId\)/,
  );
  assert.match(page, /ta-v2-version-scoped-badge/);
  assert.match(page, /ta-v2-operational-vs-version-hint/);
  // The existing permission gate is untouched; the RPC answers can_manage=false.
  assert.ok(page.includes("const readOnly = !canManage || workspace.data?.can_manage === false;"));
});

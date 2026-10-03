import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const name = "20261003010000_shared_lecture_counts_once.sql";

test("a merged member of the published timetable carries no standard load", async () => {
  const sql = await read(`supabase/migrations/${name}`);

  // The rule reads the version-level merges of the newest published timetable.
  assert.match(sql, /schedule_version_delivery_private\.shared_link_facts l/);
  assert.match(sql, /l\.member_group_id = p_group/);
  assert.match(sql, /v\.status = 'published'/);
  assert.match(sql, /later\.created_at > v\.created_at/);
  // A member that is still taught separately keeps its hours.
  assert.match(sql, /s\.schedule_version_id = v\.id AND s\.delivery_group_id = p_group/);
  // Private facts are reached through a definer helper, never by anonymous callers.
  assert.match(sql, /STABLE SECURITY DEFINER/);
  assert.match(sql, /FROM PUBLIC, anon;/);
  assert.match(sql, /TO authenticated, service_role;/);
});

test("every load reader gets the same rule, guarded against drift and re-runs", async () => {
  const sql = await read(`supabase/migrations/${name}`);

  for (const target of [
    "public.v_instructor_delivery_workload",
    "public.list_teaching_assignment_workspace(uuid,uuid,uuid,uuid,text,uuid,text,text)",
    "public.list_teaching_assignment_workspace_for_version(uuid,uuid,uuid,uuid,uuid,text,uuid,text,text)",
    "public.preview_instructor_workload_after_assignment(uuid,uuid,numeric,uuid)",
  ]) {
    assert.ok(sql.includes(`'${target}'`), `missing reader ${target}`);
  }
  // The preview has two tests (the group being assigned and the existing rows).
  assert.match(sql, /'v_dg'\)/);
  assert.match(sql, /OR public\.delivery_group_shared_in_published\(%1\$s\.id\)/);
  assert.match(sql, /SHARED_LECTURE_LOAD_DRIFT/);
  assert.match(sql, /IF n <> 1 THEN/);
  assert.match(
    sql,
    /CONTINUE WHEN position\(format\('delivery_group_shared_in_published\(%s\.id\)'/,
  );

  // Derived from the live definitions; no data and no stored flag is touched.
  assert.match(sql, /pg_get_viewdef\(t\.target::regclass, true\)/);
  assert.match(sql, /pg_get_functiondef\(t\.target::regprocedure\)/);
  assert.doesNotMatch(sql, /\b(INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE|DROP)\b/);
});

test("rollback restores the stored-flag test and removes the helper", async () => {
  const sql = await read(`supabase/rollbacks/${name}`);
  assert.match(sql, /' OR public\.delivery_group_shared_in_published\(%s\.id\)'/);
  assert.match(sql, /' OR delivery_group_shared_in_published\(%s\.id\)'/);
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.delivery_group_shared_in_published\(uuid\);/);
  assert.doesNotMatch(sql, /\b(INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\b/);
});

const workspaceName = "20261003020000_published_merges_in_assignment_workspace.sql";

test("the workspace lists a published merge once, on its anchor", async () => {
  const sql = await read(`supabase/migrations/${workspaceName}`);

  // Members come from the newest published timetable, through the same rule.
  assert.match(sql, /l\.anchor_group_id = p_anchor/);
  assert.match(sql, /public\.delivery_group_shared_in_published\(l\.member_group_id\)/);
  // Global links keep working: the operational helpers are a union with them.
  assert.match(sql, /FROM public\.shared_lecture_group_ids\(p_group\) g\s+UNION/);
  // The member is not a row of its own and the anchor is labelled as merged.
  assert.match(sql, /AND NOT public\.delivery_group_shared_in_published\(dg\.id\)/);
  assert.match(sql, /SELECT 1 FROM public\.published_shared_lecture_members\(dg\.id\)/);
  // Labels, head counts and every filter follow the merge.
  assert.match(sql, /\(4, \$b1\$public\.shared_lecture_group_ids\(\$b1\$/);
  assert.match(
    sql,
    /public\.operational_shared_lecture_matches\(dg\.id, p_cohort_id, p_study_system\)/,
  );
  // Both workspace functions, guarded against drift and safe to re-run.
  assert.match(sql, /'public\.list_teaching_assignment_workspace\(uuid,/);
  assert.match(sql, /'public\.list_teaching_assignment_workspace_for_version\(uuid,/);
  assert.match(sql, /PUBLISHED_MERGE_WORKSPACE_DRIFT/);
  assert.match(
    sql,
    /CONTINUE WHEN position\('public\.operational_shared_lecture_group_ids\(' IN d\) > 0;/,
  );
  assert.match(sql, /FROM PUBLIC, anon;/);
  assert.doesNotMatch(sql, /\b(INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE|DROP)\b/);
});

test("the workspace rollback restores the global-links-only read model", async () => {
  const sql = await read(`supabase/rollbacks/${workspaceName}`);
  assert.match(
    sql,
    /'public\.operational_shared_lecture_group_ids\(', 'public\.shared_lecture_group_ids\('/,
  );
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.published_shared_lecture_members\(uuid\);/);
  assert.doesNotMatch(sql, /\b(INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\b/);
});

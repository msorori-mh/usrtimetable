import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fixture } from "./faculty-workflow-db.test.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration = fs.readFileSync(
  "supabase/migrations/20261001002000_manual_assignment_scope_consistency.sql",
  "utf8",
);
const rollback = fs.readFileSync(
  "supabase/rollbacks/20261001002000_manual_assignment_scope_consistency.sql",
  "utf8",
);

async function scopedFixture(apply = true) {
  const f = await fixture();
  const { db } = f;
  await db.exec(`
 ALTER TABLE teaching_assignments ADD COLUMN scope_version_id uuid;
 ALTER TABLE instructors ADD COLUMN availability_status text DEFAULT 'available';
 CREATE SCHEMA assignment_version_private;
 CREATE TABLE assignment_version_private.scope(assignment_id uuid PRIMARY KEY,version_id uuid,replaces_assignment_id uuid);
 CREATE TABLE assignment_version_private.request_scope(request_id uuid PRIMARY KEY,version_id uuid,replaces_assignment_id uuid);
 CREATE TABLE assignment_version_private.suppressed(assignment_id uuid PRIMARY KEY);
 -- Test dependency implements the existing operational-counting contract:
 -- drafts do not count; promoted scoped rows count and suppress their roots.
 CREATE FUNCTION assignment_version_private.is_counted(a uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
 SELECT NOT EXISTS(SELECT 1 FROM assignment_version_private.suppressed WHERE assignment_id=a)
 AND NOT EXISTS(SELECT 1 FROM assignment_version_private.scope s JOIN schedule_versions v ON v.id=s.version_id WHERE s.assignment_id=a AND v.status='draft') $$;
 CREATE FUNCTION assignment_version_private.is_replacement_pair(a uuid,b uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM assignment_version_private.scope WHERE (assignment_id=a AND replaces_assignment_id=b) OR (assignment_id=b AND replaces_assignment_id=a)) $$;
 CREATE FUNCTION version_effective_assignments(v uuid) RETURNS TABLE(assignment_id uuid) LANGUAGE sql AS $$
 SELECT a.id FROM teaching_assignments a WHERE a.is_active AND (a.scope_version_id=v OR (a.scope_version_id IS NULL AND NOT EXISTS(SELECT 1 FROM assignment_version_private.scope s WHERE s.version_id=v AND s.replaces_assignment_id=a.id))) $$;
 CREATE FUNCTION operational_delivery_group(p uuid) RETURNS delivery_groups LANGUAGE sql STABLE AS $$SELECT g FROM delivery_groups g WHERE id=p$$;
 CREATE FUNCTION shared_lecture_group_ids(p uuid) RETURNS TABLE(group_id uuid) LANGUAGE sql STABLE AS $$SELECT p$$;
 CREATE SCHEMA schedule_version_delivery_private;
 CREATE TABLE schedule_version_delivery_private.instructor_hour_waivers(version_id uuid,source_assignment_id uuid,group_id uuid,assignment_id uuid,instructor_id uuid,college_id uuid,term_id uuid);
 UPDATE teaching_assignments SET is_active=false WHERE id='${id(401)}';
 INSERT INTO schedule_versions(id,college_id,academic_term_id,name,status) VALUES('${id(800)}','${id(10)}','${id(301)}','TEST_ONLY draft','draft');
 INSERT INTO assignment_version_private.scope VALUES('${id(801)}','${id(800)}','${id(401)}');
 INSERT INTO teaching_assignments(id,college_id,course_offering_id,instructor_id,section_number,session_type,weekly_hours,cohort_id,plan_course_component_id,delivery_group_id,assigned_component_hours,is_active,scope_version_id)
 VALUES('${id(801)}','${id(10)}','${id(341)}','${id(101)}','G10','lecture',3,'${id(321)}','${id(351)}','${id(361)}',3,true,'${id(800)}');
 `);
  await db.exec("DROP FUNCTION compute_delivery_group_allocation(uuid)");
  await db.exec(fs.readFileSync("tests/fixtures/manual-assignment-scope-functions.sql", "utf8"));
  await db.exec(`CREATE OR REPLACE VIEW v_instructor_delivery_workload AS SELECT a.instructor_id,o.term_id,a.college_id,
 sum(CASE WHEN g.excluded_from_standard_workload OR NOT p.counts_toward_regular_load THEN 0 ELSE coalesce(a.assigned_component_hours,p.weekly_contact_hours) END) AS standard_assigned_hours,
 sum(CASE WHEN p.component_type='project' AND NOT p.counts_toward_regular_load THEN a.assigned_component_hours ELSE 0 END) AS project_supervision_hours
 FROM teaching_assignments a JOIN course_offerings o ON o.id=a.course_offering_id JOIN delivery_groups g ON g.id=a.delivery_group_id JOIN plan_course_components p ON p.id=g.component_id
 WHERE a.is_active AND assignment_version_private.is_counted(a.id) AND g.active AND NOT g.is_obsolete GROUP BY a.instructor_id,o.term_id,a.college_id;`);
  const defsQuery =
    "SELECT n.nspname,p.proname,pg_get_functiondef(p.oid) definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','faculty_private') ORDER BY n.nspname,p.proname,p.oid";
  f.definitions = async () => (await db.query(defsQuery)).rows;
  f.definitionsBefore = await f.definitions();
  if (apply) await db.exec(migration);
  await f.actor(1);
  return f;
}

test("manual scope: reproduces false split/over-allocation, then fixes preview without changing rows", async () => {
  const f = await scopedFixture(false);
  try {
    const before = (
      await f.db.query("SELECT jsonb_agg(a ORDER BY id) x FROM teaching_assignments a")
    ).rows[0].x;
    const preview = (h) =>
      f.rpc("preview_instructor_workload_after_assignment", [id(104), id(361), h, null]);
    assert.ok(
      (await preview(null)).assignment_conflicts.includes("CO_TEACHING_HOURS_SPLIT_REQUIRED"),
    );
    assert.ok((await preview(3)).assignment_conflicts.includes("CO_TEACHING_HOURS_OVER_ALLOCATED"));
    await f.db.exec("RESET ROLE");
    await f.db.exec(migration);
    await f.actor(1);
    assert.deepEqual((await preview(null)).assignment_conflicts, []);
    assert.deepEqual((await preview(3)).assignment_conflicts, []);
    assert.equal((await f.rpc("compute_delivery_group_allocation", [id(361)])).remaining_hours, 3);
    assert.deepEqual(
      (await f.db.query("SELECT jsonb_agg(a ORDER BY id) x FROM teaching_assignments a")).rows[0].x,
      before,
    );
  } finally {
    await f.db.close();
  }
});

test("manual scope: reactivate the global row despite same lecturer in a draft; preserve schedules and scoped row", async () => {
  const f = await scopedFixture();
  try {
    const snapshot = async () => ({
      sessions: (await f.db.query("SELECT jsonb_agg(s ORDER BY id) x FROM schedule_sessions s"))
        .rows[0].x,
      scoped: (
        await f.db.query(`SELECT to_jsonb(a) x FROM teaching_assignments a WHERE id='${id(801)}'`)
      ).rows[0].x,
    });
    const before = await snapshot();
    const result = await f.rpc("create_teaching_assignment_v2", [id(361), id(101), 3, null]);
    assert.equal(result.ok, true);
    assert.equal(result.action, "reactivated");
    assert.equal(result.assignment_id, id(401));
    assert.deepEqual(await snapshot(), before);
    const allocation = await f.rpc("compute_delivery_group_allocation", [id(361)]);
    assert.equal(allocation.assignment_count, 1);
    assert.equal(allocation.assigned_hours_total, 3);
    await assert.rejects(
      () => f.rpc("create_teaching_assignment_v2", [id(361), id(101), 3, null]),
      /DUPLICATE_ACTIVE_ASSIGNMENT/,
    );
    await assert.rejects(
      () => f.rpc("create_teaching_assignment_v2", [id(361), id(104), 3, null]),
      /CO_TEACHING_HOURS_OVER_ALLOCATED/,
    );
  } finally {
    await f.db.close();
  }
});

test("manual scope: a different global instructor can fill the vacant group and true hours stay enforced", async () => {
  const f = await scopedFixture();
  try {
    assert.equal(
      (await f.rpc("create_teaching_assignment_v2", [id(361), id(104), 3, null])).ok,
      true,
    );
    assert.equal((await f.rpc("compute_delivery_group_allocation", [id(361)])).assignment_count, 1);
    assert.ok(
      (
        await f.rpc("preview_instructor_workload_after_assignment", [id(101), id(361), 3, null])
      ).assignment_conflicts.includes("CO_TEACHING_HOURS_OVER_ALLOCATED"),
    );
  } finally {
    await f.db.close();
  }
});

test("manual scope: promoted assignments count and cannot be over-allocated", async () => {
  const f = await scopedFixture();
  try {
    await f.db.exec("RESET ROLE");
    await f.db.exec(`UPDATE schedule_versions SET status='published' WHERE id='${id(800)}'`);
    await f.actor(1);
    const a = await f.rpc("compute_delivery_group_allocation", [id(361)]);
    assert.equal(a.assignment_count, 1);
    assert.equal(a.assigned_hours_total, 3);
    assert.ok(
      (
        await f.rpc("preview_instructor_workload_after_assignment", [id(104), id(361), 3, null])
      ).assignment_conflicts.includes("CO_TEACHING_HOURS_OVER_ALLOCATED"),
    );
    await assert.rejects(
      () => f.rpc("create_teaching_assignment_v2", [id(361), id(104), 3, null]),
      /CO_TEACHING_HOURS_OVER_ALLOCATED/,
    );
  } finally {
    await f.db.close();
  }
});

test("manual scope: authorization and home-college approval are preserved", async () => {
  const f = await scopedFixture();
  try {
    await f.actor(5);
    await assert.rejects(
      () => f.rpc("create_teaching_assignment_v2", [id(361), id(104), 3, null]),
      /insufficient_privilege/,
    );
    await f.actor(1);
    await f.rpc("reconcile_faculty_home", [
      id(203),
      id(30),
      id(103),
      true,
      "TEST_ONLY official quota verified",
      null,
    ]);
    await f.actor(2);
    const request = await f.rpc("create_teaching_assignment_v2", [id(361), id(103), 3, null]);
    assert.equal(request.action, "requested");
    await assert.rejects(
      () => f.rpc("decide_faculty_teaching_request", [request.request_id, "approved", null]),
      /insufficient_privilege/,
    );
    await f.actor(4);
    const approved = await f.rpc("decide_faculty_teaching_request", [
      request.request_id,
      "approved",
      "TEST_ONLY",
    ]);
    assert.equal(approved.ok, true);
    assert.equal(approved.allocation, null);
    await assert.rejects(
      () => f.rpc("compute_delivery_group_allocation", [id(361)]),
      /insufficient_privilege/,
    );
    await f.actor(2);
    const edit = await f.rpc("update_teaching_assignment_v2", [
      approved.assignment_id,
      approved.updated_at,
      2,
      "TEST_ONLY reduced hours",
    ]);
    assert.equal(edit.action, "requested");
    await f.actor(4);
    const updated = await f.rpc("decide_faculty_teaching_request", [
      edit.request_id,
      "approved",
      "TEST_ONLY",
    ]);
    assert.equal(updated.ok, true);
    assert.equal(updated.allocation, null);
  } finally {
    await f.db.close();
  }
});

test("manual scope: explicit split edit excludes itself and a rollback restores exact definitions", async () => {
  const f = await scopedFixture();
  try {
    const created = await f.rpc("create_teaching_assignment_v2", [id(361), id(104), 2, null]);
    const p = await f.rpc("preview_instructor_workload_after_assignment", [
      id(104),
      id(361),
      3,
      created.assignment_id,
    ]);
    assert.deepEqual(p.assignment_conflicts, []);
    await f.rpc("update_teaching_assignment_v2", [
      created.assignment_id,
      created.updated_at,
      3,
      null,
    ]);
    assert.equal(
      (await f.rpc("compute_delivery_group_allocation", [id(361)])).assigned_hours_total,
      3,
    );
    await f.db.exec("RESET ROLE");
    await f.db.exec(rollback);
    assert.deepEqual(await f.definitions(), f.definitionsBefore);
    await f.db.exec(migration);
    await assert.rejects(() => f.db.exec(migration), /MANUAL_ASSIGNMENT_SCOPE_FUNCTION_DRIFT/);
  } finally {
    await f.db.close();
  }
});

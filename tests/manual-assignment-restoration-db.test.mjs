import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scopedFixture } from "./manual-assignment-scope-db.test.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const migration = await read(
  "../supabase/migrations/20261001012000_restore_historical_manual_assignment.sql",
);
const rollback = await read(
  "../supabase/rollbacks/20261001012000_restore_historical_manual_assignment.sql",
);

async function historicalFixture(apply = true) {
  const f = await scopedFixture();
  await f.db.exec(`RESET ROLE;
    CREATE TABLE assignment_version_private.promotions(version_id uuid PRIMARY KEY,promoted_at timestamptz NOT NULL);
    INSERT INTO assignment_version_private.promotions VALUES('${id(800)}','2026-09-28');
    UPDATE teaching_assignments SET is_active=false WHERE id='${id(801)}';
    INSERT INTO assignment_version_private.suppressed VALUES('${id(401)}');
    UPDATE teaching_assignments SET is_active=true WHERE id='${id(401)}';
    CREATE OR REPLACE FUNCTION assignment_version_private.is_counted(a uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT CASE WHEN EXISTS(SELECT 1 FROM assignment_version_private.suppressed WHERE assignment_id=a) THEN false
      WHEN EXISTS(SELECT 1 FROM assignment_version_private.scope s JOIN schedule_versions v ON v.id=s.version_id WHERE s.assignment_id=a AND v.status='draft') THEN false ELSE true END $$;
  `);
  if (apply) await f.db.exec(migration);
  await f.actor(1);
  return f;
}

test("manual restoration: approved reassignment restores the hidden historical root without moving sessions", async () => {
  const f = await historicalFixture(false);
  try {
    await f.rpc("reconcile_faculty_home", [
      id(201),
      id(20),
      id(101),
      true,
      "TEST_ONLY confirmed home and quota",
      null,
    ]);
    await assert.rejects(
      () => f.rpc("create_teaching_assignment_v2", [id(361), id(101), 3, null]),
      /DUPLICATE_ACTIVE_ASSIGNMENT/,
    );
    const sessions = (
      await f.db.query("SELECT jsonb_agg(s ORDER BY id) x FROM schedule_sessions s")
    ).rows;
    const scoped = (
      await f.db.query(`SELECT to_jsonb(a) x FROM teaching_assignments a WHERE id='${id(801)}'`)
    ).rows;
    await f.db.exec("RESET ROLE");
    await f.db.exec(migration);
    await f.actor(1);
    const result = await f.rpc("create_teaching_assignment_v2", [id(361), id(101), 3, null]);
    assert.equal(result.action, "reactivated");
    assert.equal(result.assignment_id, id(401));
    assert.equal(
      (await f.rpc("compute_delivery_group_allocation", [id(361)])).assigned_hours_total,
      3,
    );
    assert.deepEqual(
      (await f.db.query("SELECT jsonb_agg(s ORDER BY id) x FROM schedule_sessions s")).rows,
      sessions,
    );
    assert.deepEqual(
      (await f.db.query(`SELECT to_jsonb(a) x FROM teaching_assignments a WHERE id='${id(801)}'`))
        .rows,
      scoped,
    );
    await assert.rejects(
      () => f.rpc("create_teaching_assignment_v2", [id(361), id(101), 3, null]),
      /DUPLICATE_ACTIVE_ASSIGNMENT/,
    );
    await f.db.exec("RESET ROLE");
    const row = (
      await f.db.query(
        "SELECT r.request_id,q.status FROM assignment_version_private.manual_restorations r JOIN faculty_teaching_requests q ON q.id=r.request_id",
      )
    ).rows[0];
    assert.equal(row.status, "approved");
    assert.equal(row.request_id, result.request_id);
    await assert.rejects(() => f.db.exec(rollback), /MANUAL_RESTORATION_IN_USE/);
  } finally {
    await f.db.close();
  }
});

test("manual restoration: authorization and true allocation failures leave no restoration", async () => {
  const f = await historicalFixture();
  try {
    await f.actor(5);
    await assert.rejects(
      () => f.rpc("create_teaching_assignment_v2", [id(361), id(101), 3, null]),
      /insufficient_privilege/,
    );
    await f.actor(1);
    await f.rpc("create_teaching_assignment_v2", [id(361), id(104), 3, null]);
    await assert.rejects(
      () => f.rpc("create_teaching_assignment_v2", [id(361), id(101), 3, null]),
      /CO_TEACHING_HOURS_OVER_ALLOCATED/,
    );
    await f.db.exec("RESET ROLE");
    assert.equal(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM assignment_version_private.manual_restorations",
        )
      ).rows[0].n,
      0,
    );
    await f.db.exec("SET ROLE authenticated");
    await assert.rejects(
      () =>
        f.db.query(
          `INSERT INTO assignment_version_private.manual_restorations(assignment_id,college_id,term_id,restored_by,request_id) VALUES('${id(401)}','${id(10)}','${id(301)}','${id(1)}','${id(1)}')`,
        ),
      /permission denied/,
    );
  } finally {
    await f.db.close();
  }
});

test("manual restoration: projected and later promotions retain version precedence; unused rollback is exact", async () => {
  const f = await historicalFixture(false);
  try {
    await f.db.exec("RESET ROLE");
    const defs = async () =>
      (
        await f.db.query(
          "SELECT pg_get_functiondef(p) d FROM unnest(ARRAY['assignment_version_private.is_counted(uuid)'::regprocedure,'faculty_private.apply_create_assignment(uuid,uuid,numeric,text)'::regprocedure]) p",
        )
      ).rows;
    const before = await defs();
    await f.db.exec(migration);
    await f.db.exec(rollback);
    assert.deepEqual(await defs(), before);
    await f.db.exec(migration);
    await f.actor(1);
    await f.rpc("create_teaching_assignment_v2", [id(361), id(101), 3, null]);
    await f.db.exec("RESET ROLE");
    await f.db.query(
      "INSERT INTO schedule_versions(id,college_id,academic_term_id,name,status) VALUES($1,$2,$3,'TEST_ONLY next','draft')",
      [id(900), id(10), id(301)],
    );
    const counted = async () =>
      (await f.db.query("SELECT assignment_version_private.is_counted($1) x", [id(401)])).rows[0].x;
    assert.equal(await counted(), true);
    await f.db.query("SELECT set_config('app.assume_promoted_version',$1,false)", [id(900)]);
    assert.equal(await counted(), false, "manual choice never overrides version projection");
    await f.db.query("SELECT set_config('app.assume_promoted_version','',false)");
    assert.equal(await counted(), true);
    await f.db.query("INSERT INTO assignment_version_private.promotions VALUES($1,now())", [
      id(900),
    ]);
    assert.equal(await counted(), false, "later promotion supersedes the manual choice");
  } finally {
    await f.db.close();
  }
});

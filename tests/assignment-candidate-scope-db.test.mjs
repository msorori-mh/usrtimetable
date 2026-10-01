import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture } from "./faculty-workflow-db.test.mjs";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const migration = await read(
  "../supabase/migrations/20261001011000_assignment_candidate_operational_scope.sql",
);
const rollback = await read(
  "../supabase/rollbacks/20261001011000_assignment_candidate_operational_scope.sql",
);

async function candidateFixture() {
  const f = await fixture();
  await f.db.exec(`
    ALTER TABLE instructors ADD COLUMN availability_status text DEFAULT 'available';
    CREATE OR REPLACE VIEW operational_delivery_groups AS SELECT * FROM delivery_groups;
    CREATE SCHEMA assignment_version_private;
    CREATE TABLE assignment_version_private.not_counted(assignment_id uuid PRIMARY KEY);
    CREATE FUNCTION assignment_version_private.is_counted(p uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT NOT EXISTS(SELECT 1 FROM assignment_version_private.not_counted WHERE assignment_id=p) $$;
  `);
  await f.db.exec(await read("./fixtures/assignment-candidate-scope.sql"));
  await f.actor(1);
  return f;
}

test("candidate scope: hidden draft/history assignments cannot remove the lecturer from the picker", async () => {
  const f = await candidateFixture();
  try {
    const candidate = async () =>
      (await f.rpc("get_delivery_group_assignment_candidates", [id(361)])).candidates.find(
        (c) => c.instructor_id === id(101),
      );
    await f.db.exec("RESET ROLE");
    await f.db.query("INSERT INTO assignment_version_private.not_counted VALUES($1)", [id(401)]);
    await f.actor(1);
    assert.equal((await candidate()).already_assigned, true, "reproduce the false exclusion");
    const before = (
      await f.db.query("SELECT jsonb_agg(a ORDER BY id) x FROM teaching_assignments a")
    ).rows;
    await f.db.exec("RESET ROLE");
    await f.db.exec(migration);
    await f.actor(1);
    assert.equal((await candidate()).already_assigned, false);
    assert.deepEqual(
      (await f.db.query("SELECT jsonb_agg(a ORDER BY id) x FROM teaching_assignments a")).rows,
      before,
    );
    await f.db.exec("RESET ROLE");
    await f.db.exec("DELETE FROM assignment_version_private.not_counted");
    await f.actor(1);
    assert.equal(
      (await candidate()).already_assigned,
      true,
      "a current operational assignment remains excluded",
    );
  } finally {
    await f.db.close();
  }
});

test("candidate scope: read boundaries and management permission remain enforced", async () => {
  const f = await candidateFixture();
  try {
    await f.db.exec("RESET ROLE");
    await f.db.exec(migration);
    await f.actor(3);
    await assert.rejects(
      () => f.rpc("get_delivery_group_assignment_candidates", [id(361)]),
      /insufficient_privilege/,
    );
    await f.actor(5);
    assert.equal(
      (await f.rpc("get_delivery_group_assignment_candidates", [id(361)])).assignable,
      false,
    );
    await f.actor(1);
    assert.equal(
      (await f.rpc("get_delivery_group_assignment_candidates", [id(361)])).assignable,
      true,
    );
  } finally {
    await f.db.close();
  }
});

test("candidate scope: rollback restores the exact function and unexpected reapplication fails", async () => {
  const f = await candidateFixture();
  try {
    const definition = async () =>
      (
        await f.db.query(
          "SELECT pg_get_functiondef('get_delivery_group_assignment_candidates(uuid)'::regprocedure) d",
        )
      ).rows[0].d;
    const before = await definition();
    await f.db.exec("RESET ROLE");
    await f.db.exec(migration);
    await f.db.exec(rollback);
    assert.equal(await definition(), before);
    await f.db.exec(migration);
    await assert.rejects(() => f.db.exec(migration), /CANDIDATE_SCOPE_ALREADY_PATCHED/);
  } finally {
    await f.db.close();
  }
});

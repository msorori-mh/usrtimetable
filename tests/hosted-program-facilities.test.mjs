import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(
  process.env.HOSTING_DB_MODULE ||
    "../.test-runtime/node_modules/@electric-sql/pglite/dist/index.js"
);
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const migration = await readFile(
  new URL(
    "../supabase/migrations/20260919110000_hosted_program_facilities.sql",
    import.meta.url,
  ),
  "utf8",
);

async function fixture() {
  const db = new PGlite();
  await db.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated;
  CREATE SCHEMA auth; CREATE SCHEMA schedule_coordination_private;
  CREATE TABLE schedule_coordination_private.write_gate(id boolean PRIMARY KEY, revision bigint);
  INSERT INTO schedule_coordination_private.write_gate VALUES(true,0);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
   $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
  CREATE FUNCTION public.is_super_admin(u uuid) RETURNS boolean LANGUAGE sql AS $$SELECT u='${id(1)}'::uuid$$;
  CREATE FUNCTION public.can_view_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS
   $$SELECT public.is_super_admin(u) OR (u='${id(2)}'::uuid AND c='${id(10)}'::uuid) OR (u='${id(3)}'::uuid AND c='${id(11)}'::uuid)$$;
  CREATE TABLE colleges(id uuid PRIMARY KEY,university_id uuid,name text);
  CREATE TABLE academic_programs(id uuid PRIMARY KEY,college_id uuid REFERENCES colleges,id_dummy boolean,is_archived boolean);
  CREATE TABLE rooms(id uuid PRIMARY KEY,college_id uuid REFERENCES colleges,code text,name text,room_type text,capacity integer,is_active boolean);
  CREATE TABLE course_offerings(id uuid PRIMARY KEY,program_id uuid);
  CREATE TABLE schedule_versions(id uuid PRIMARY KEY,status text);
  CREATE TABLE schedule_sessions(id uuid PRIMARY KEY,course_offering_id uuid,room_id uuid,schedule_version_id uuid,replaced_by_split boolean);
  CREATE TABLE audit_logs(actor_id uuid,action text,entity text,entity_id uuid,college_id uuid,details jsonb);
  INSERT INTO colleges VALUES('${id(10)}','${id(90)}','Jawf'),('${id(11)}','${id(90)}','ITCS'),('${id(12)}','${id(91)}','Other university');
  INSERT INTO academic_programs(id,college_id,is_archived) VALUES('${id(20)}','${id(10)}',false),('${id(21)}','${id(11)}',false);
  INSERT INTO rooms VALUES('${id(30)}','${id(11)}','L1','Lab 1','computer_lab',42,true),('${id(31)}','${id(12)}','X1','Other','lecture_hall',75,true);
 `);
  await db.exec(migration);
  return db;
}
async function as(db, user, sql) {
  await db.exec(
    `SET ROLE authenticated; SELECT set_config('test.uid','${user ? id(user) : ""}',false)`,
  );
  try {
    return await db.query(sql);
  } finally {
    await db.exec("RESET ROLE");
  }
}
const grant = (enabled = true, room = 30) =>
  `SELECT public.set_hosted_program_room('${id(20)}','${id(room)}',${enabled},'User approved hosting 2026-09-19')`;
const list = `SELECT public.list_hosted_program_rooms('${id(10)}','${id(20)}') AS rooms`;

test("only admin grants; guest can read exact program; physical room stays owned by host", async () => {
  const db = await fixture();
  try {
    assert.deepEqual((await as(db, 2, list)).rows[0].rooms, []);
    await assert.rejects(as(db, 2, grant()), /FORBIDDEN/);
    await assert.rejects(as(db, 3, grant()), /FORBIDDEN/);
    await assert.rejects(as(db, null, grant()), /FORBIDDEN/);
    await as(db, 1, grant());
    const rows = (await as(db, 2, list)).rows[0].rooms;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, id(30));
    assert.equal(rows[0].is_hosted, true);
    assert.equal(rows[0].host_college_id, id(11));
    await assert.rejects(as(db, 3, list), /FORBIDDEN/);
    await assert.rejects(
      as(
        db,
        2,
        `SELECT public.list_hosted_program_rooms('${id(10)}','${id(21)}')`,
      ),
      /HOSTING_PROGRAM_SCOPE_INVALID/,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM rooms")).rows[0].n,
      2,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

test("scope, evidence, null enable and raw grants are rejected", async () => {
  const db = await fixture();
  try {
    await assert.rejects(as(db, 1, grant(true, 31)), /HOSTING_SCOPE_INVALID/);
    await assert.rejects(
      as(
        db,
        1,
        `SELECT public.set_hosted_program_room('${id(20)}','${id(30)}',true,'short')`,
      ),
      /HOSTING_EVIDENCE_REQUIRED/,
    );
    await assert.rejects(
      as(
        db,
        1,
        `SELECT public.set_hosted_program_room('${id(20)}','${id(30)}',null,'Sufficient evidence here')`,
      ),
      /HOSTING_EVIDENCE_REQUIRED/,
    );
    await assert.rejects(
      as(db, 2, "SELECT * FROM hosting_private.program_rooms"),
      /permission denied/,
    );
    await assert.rejects(
      as(db, 1, "SELECT * FROM hosting_private.program_rooms"),
      /permission denied/,
    );
    await as(db, 1, grant());
    await as(db, 1, grant());
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM hosting_private.program_rooms",
        )
      ).rows[0].n,
      1,
    );
    await db.exec(`UPDATE rooms SET is_active=false WHERE id='${id(30)}'`);
    assert.deepEqual((await as(db, 2, list)).rows[0].rooms, []);
  } finally {
    await db.close();
  }
});

test("cannot revoke occupied room; archived history survives revocation", async () => {
  const db = await fixture();
  try {
    await as(db, 1, grant());
    await db.exec(
      `INSERT INTO course_offerings VALUES('${id(40)}','${id(20)}'); INSERT INTO schedule_versions VALUES('${id(50)}','published'); INSERT INTO schedule_sessions VALUES('${id(60)}','${id(40)}','${id(30)}','${id(50)}',false)`,
    );
    await assert.rejects(as(db, 1, grant(false)), /HOSTING_ROOM_IN_USE/);
    assert.equal((await as(db, 2, list)).rows[0].rooms.length, 1);
    await db.exec(
      `UPDATE schedule_versions SET status='archived' WHERE id='${id(50)}'`,
    );
    await as(db, 1, grant(false));
    assert.deepEqual((await as(db, 2, list)).rows[0].rooms, []);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM schedule_sessions"))
        .rows[0].n,
      1,
    );
  } finally {
    await db.close();
  }
});

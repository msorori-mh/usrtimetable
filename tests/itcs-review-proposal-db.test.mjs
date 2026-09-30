import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { PGlite } = await import(process.env.CLONE_DB_MODULE ?? "@electric-sql/pglite");
const migration = readFileSync(
  "supabase/migrations/20260930090000_itcs_review_proposal.sql",
  "utf8",
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = id(1),
  college = id(2),
  admin = id(3),
  viewer = id(4),
  outsider = id(5),
  teacher = id(6);
const profile = "itcs_proposal15_review_20260930";
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE SCHEMA itcs_cutover_private; CREATE SCHEMA schedule_coordination_private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE FUNCTION is_super_admin(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u='${admin}' $$;
    CREATE FUNCTION can_view_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u IN('${admin}','${viewer}') AND c='${college}' $$;
    CREATE TABLE colleges(id uuid PRIMARY KEY);
    CREATE TABLE schedule_versions(id uuid PRIMARY KEY,status text,snapshot text);
    CREATE TABLE schedule_sessions(id uuid PRIMARY KEY,payload text);
    CREATE TABLE teaching_assignments(id uuid PRIMARY KEY,payload text);
    CREATE TABLE audit_logs(actor_id uuid,action text,entity text,entity_id uuid,college_id uuid,details jsonb);
    INSERT INTO colleges VALUES('${college}');
    INSERT INTO schedule_versions VALUES('${source}','published','baseline');
    INSERT INTO schedule_sessions VALUES('${id(10)}','published unchanged');
    INSERT INTO teaching_assignments VALUES('${id(11)}','assignment unchanged');
    CREATE FUNCTION schedule_version_session_snapshot(v uuid) RETURNS text LANGUAGE sql AS $$ SELECT snapshot FROM public.schedule_versions WHERE id=v $$;
    CREATE FUNCTION schedule_coordination_private.busy(v uuid) RETURNS TABLE(instructor_id uuid,day_of_week integer,start_time time,end_time time)
    LANGUAGE sql AS $$ SELECT '${teacher}'::uuid,1,'08:00'::time,'10:00'::time $$;
    CREATE FUNCTION itcs_cutover_execute(p_stage text,p_version uuid,p_published uuid,p_manifest jsonb,p_manifest_sha text,p_expected_published_snapshot text)
    RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
  IF p_stage='rooms' THEN RETURN '{}'; END IF;
      RAISE EXCEPTION 'LEGACY_ENTRYPOINT'; END $$;
    GRANT EXECUTE ON FUNCTION itcs_cutover_execute(text,uuid,uuid,jsonb,text,text) TO authenticated;
  `);
  await db.exec(migration);
  const payload = {
    title: "Review",
    report_data: {
      sessions: Array.from({ length: 282 }, (_, n) => [
        id(100 + n),
        n === 0 ? 1 : 2,
        "08:00:00",
        n < 80 ? "11:00:00" : "10:00:00",
        "lecture",
        40,
        "G1",
        id(7),
        "CS-L1",
        "regular",
        1,
        id(8),
        "CS",
        "M1",
        "Math",
        n === 0 ? teacher : id(9),
        "Lecturer",
        "Room",
        75,
        id(1000 + n),
      ]),
    },
  };
  await db.query(
    `INSERT INTO itcs_cutover_private.review_proposal_registry(profile,college_id,source_version_id,source_snapshot,payload,payload_hash) VALUES($1,$2,$3,'baseline',$4,md5($4::jsonb::text))`,
    [profile, college, source, payload],
  );
  const hash = (
    await db.query(`SELECT payload_hash FROM itcs_cutover_private.review_proposal_registry`)
  ).rows[0].payload_hash;
  const as = async (uid) => db.query("SELECT set_config('test.uid',$1,false)", [uid]);
  const get = async () =>
    (await db.query("SELECT itcs_review_proposal_get($1) r", [profile])).rows[0].r;
  const save = async (
    stage = "save_review_proposal",
    manifest = { profile },
    expected = "baseline",
    h = hash,
  ) =>
    (
      await db.query("SELECT itcs_cutover_execute($1,$2,$2,$3,$4,$5) r", [
        stage,
        source,
        manifest,
        h,
        expected,
      ])
    ).rows[0].r;
  await as(admin);
  return { db, payload, as, get, save };
}
test("review proposal keeps strict authenticated reads, admin writes, exact payload and source CAS", async () => {
  const { db, as, get, save } = await fixture();
  try {
    await as("");
    await assert.rejects(get, /AUTH_REQUIRED/);
    await assert.rejects(save, /SUPER_ADMIN_REQUIRED/);
    await as(outsider);
    await assert.rejects(get, /FORBIDDEN/);
    await assert.rejects(save, /SUPER_ADMIN_REQUIRED/);
    await as(viewer);
    await assert.rejects(get, /FORBIDDEN/);
    await as(admin);
    await assert.rejects(() => save("publish"), /REVIEW_PROPOSAL_DRAFT_ONLY/);
    await assert.rejects(
      () => save("save_review_proposal", { profile, sessions: [] }),
      /UNREGISTERED_REVIEW_PROPOSAL/,
    );
    await assert.rejects(
      () => save("save_review_proposal", { profile }, "wrong"),
      /UNREGISTERED_REVIEW_PROPOSAL/,
    );
    await assert.rejects(
      () => save("save_review_proposal", { profile }, "baseline", "wrong"),
      /UNREGISTERED_REVIEW_PROPOSAL/,
    );
    await db.exec("UPDATE schedule_versions SET snapshot='changed'");
    await assert.rejects(save, /REVIEW_PROPOSAL_SOURCE_DRIFT/);
    assert.equal(
      (await db.query("SELECT count(*) n FROM itcs_cutover_private.review_proposals")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
test("saves all 282 sessions and 644 hours as an idempotent review document, preserving operational data", async () => {
  const { db, payload, as, get, save } = await fixture();
  try {
    const before = (
      await db.query(
        "SELECT (SELECT jsonb_agg(s) FROM schedule_sessions s) sessions,(SELECT jsonb_agg(a) FROM teaching_assignments a) assignments,(SELECT jsonb_agg(v) FROM schedule_versions v) versions",
      )
    ).rows;
    const result = await save();
    assert.equal(result.saved, true);
    assert.equal(result.native_schedule_created, false);
    assert.equal(result.checks.sessions, 282);
    assert.equal(result.checks.hours, 644);
    assert.equal(result.checks.external_conflict_sessions, 1);
    const replay = await save();
    assert.equal(replay.id, result.id);
    assert.equal(replay.replayed, true);
    await as(viewer);
    const read = await get();
    assert.deepEqual(read.payload, payload);
    assert.equal(read.saved, true);
    await assert.rejects(save, /SUPER_ADMIN_REQUIRED/);
    const after = (
      await db.query(
        "SELECT (SELECT jsonb_agg(s) FROM schedule_sessions s) sessions,(SELECT jsonb_agg(a) FROM teaching_assignments a) assignments,(SELECT jsonb_agg(v) FROM schedule_versions v) versions",
      )
    ).rows;
    assert.deepEqual(after, before);
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      () => db.query("SELECT * FROM itcs_cutover_private.review_proposals"),
      /permission denied/,
    );
    await db.exec("RESET ROLE");
  } finally {
    await db.close();
  }
});
test("failed audit rolls back the saved review document", async () => {
  const { db, save } = await fixture();
  try {
    await db.exec(`CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'AUDIT_FAILED'; END $$;
      CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_audit();`);
    await assert.rejects(save, /AUDIT_FAILED/);
    assert.equal(
      (await db.query("SELECT count(*) n FROM itcs_cutover_private.review_proposals")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fixture } from "./itcs-scoped-cohort-decisions-db.test.mjs";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration = fs.readFileSync(
  "supabase/migrations/20260930110000_itcs_native_review_draft.sql",
  "utf8",
);
test("native draft scope preserves global and per-version uniqueness and rejects forged scope", async () => {
  const db = await fixture();
  try {
    await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
    const begin = migration.indexOf("CREATE TABLE itcs_cutover_private.native_review_profiles");
    const end = migration.indexOf(
      "CREATE FUNCTION itcs_cutover_private.assert_native_review_source",
    );
    await db.exec(migration.slice(begin, end));
    await db.exec(`INSERT INTO itcs_cutover_private.native_review_profiles(profile,manifest,manifest_sha,source_version_id,source_snapshot,source_full_snapshot,source_facts_snapshot,source_assignments,draft_version_id)
    VALUES('fixture','{}','hash','${id(11)}','a','b','c','[]','${id(10)}');`);
    await assert.rejects(
      () =>
        db.exec(
          `UPDATE teaching_assignments SET scope_version_id='${id(10)}' WHERE id='${id(80)}'`,
        ),
      /ASSIGNMENT_SCOPE_MISMATCH/,
    );
    const before = (
      await db.query(
        `SELECT jsonb_agg(s ORDER BY s.id) x FROM schedule_sessions s WHERE schedule_version_id='${id(11)}'`,
      )
    ).rows[0].x;
    await db.exec("BEGIN");
    await db.exec(
      `SELECT decide_faculty_teaching_request('${id(90)}','approved','test');SELECT decide_faculty_teaching_request('${id(91)}','approved','test');`,
    );
    await db.exec("COMMIT");
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int n FROM teaching_assignments WHERE scope_version_id='${id(10)}'`,
        )
      ).rows[0].n,
      2,
    );
    assert.deepEqual(
      (
        await db.query(
          `SELECT jsonb_agg(s ORDER BY s.id) x FROM schedule_sessions s WHERE schedule_version_id='${id(11)}'`,
        )
      ).rows[0].x,
      before,
    );
    // Both replacement identities still have one row in this version.
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int n FROM pg_indexes WHERE indexname IN('ta_global_unique','ta_scope_unique','ta_global_group_instructor_unique','ta_scope_group_instructor_unique')`,
        )
      ).rows[0].n,
      4,
    );
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int n FROM teaching_assignments WHERE id IN('${id(80)}','${id(81)}') AND scope_version_id IS NULL AND is_active`,
        )
      ).rows[0].n,
      2,
    );
    await db.exec(`
    UPDATE schedule_versions SET status='published' WHERE id='${id(10)}';
    INSERT INTO schedule_versions VALUES('${id(12)}','${id(2)}','${id(3)}','draft');
    INSERT INTO assignment_version_private.enabled_versions VALUES('${id(12)}');
    INSERT INTO itcs_cutover_private.native_review_profiles(profile,manifest,manifest_sha,source_version_id,source_snapshot,source_full_snapshot,source_facts_snapshot,source_assignments,draft_version_id)
     VALUES('second','{}','second','${id(10)}','a','b','c','[]','${id(12)}');
    INSERT INTO schedule_sessions(schedule_version_id,teaching_assignment_id,instructor_id,day_of_week,start_time,end_time,room_id,delivery_group_id,cohort_id)
     SELECT '${id(12)}',teaching_assignment_id,instructor_id,day_of_week,start_time,end_time,room_id,delivery_group_id,cohort_id
     FROM schedule_sessions WHERE schedule_version_id='${id(11)}';
    INSERT INTO faculty_teaching_requests(id,delivery_group_id,instructor_id,college_id,assigned_hours,status,identity_id,home_college_id,term_id)
     SELECT CASE id WHEN '${id(90)}' THEN '${id(92)}'::uuid ELSE '${id(93)}'::uuid END,delivery_group_id,instructor_id,college_id,assigned_hours,'pending',identity_id,home_college_id,term_id
     FROM faculty_teaching_requests WHERE id IN('${id(90)}','${id(91)}');
    INSERT INTO assignment_version_private.request_scope VALUES('${id(92)}','${id(12)}','${id(80)}'),('${id(93)}','${id(12)}','${id(81)}');
    CREATE OR REPLACE FUNCTION assignment_version_private.is_counted(a uuid) RETURNS boolean LANGUAGE sql AS $$
     SELECT CASE WHEN EXISTS(SELECT 1 FROM assignment_version_private.scope WHERE assignment_id=a AND version_id='${id(10)}') THEN true
      WHEN EXISTS(SELECT 1 FROM assignment_version_private.scope WHERE assignment_id=a OR replaces_assignment_id=a) THEN false ELSE true END $$;
  `);
    await assert.rejects(
      () => db.exec(`SELECT decide_faculty_teaching_request('${id(92)}','approved','second')`),
      /CO_TEACHING_HOURS_OVER_ALLOCATED/,
    );
    await db.exec(
      fs.readFileSync(
        "supabase/migrations/20260930113000_scoped_assignment_version_peers.sql",
        "utf8",
      ),
    );
    await db.exec(
      `BEGIN; SELECT decide_faculty_teaching_request('${id(92)}','approved','second'); SELECT decide_faculty_teaching_request('${id(93)}','approved','second'); COMMIT;`,
    );
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int n FROM teaching_assignments WHERE scope_version_id='${id(12)}'`,
        )
      ).rows[0].n,
      2,
    );
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int n FROM teaching_assignments WHERE scope_version_id='${id(10)}' AND is_active`,
        )
      ).rows[0].n,
      2,
    );
    await db.exec(`
      ALTER TABLE schedule_versions ADD COLUMN created_at timestamptz DEFAULT '2026-09-28';
      UPDATE schedule_versions SET created_at='2026-09-30' WHERE id='${id(12)}';
      CREATE TABLE assignment_version_private.promotions(version_id uuid PRIMARY KEY,promoted_at timestamptz);
      INSERT INTO assignment_version_private.promotions VALUES('${id(10)}','2026-09-29');
      CREATE FUNCTION assignment_version_private.is_promoted(v uuid) RETURNS boolean LANGUAGE sql AS $$
       SELECT EXISTS(SELECT 1 FROM assignment_version_private.promotions WHERE version_id=v)
        OR coalesce(current_setting('app.assume_promoted_version',true),'')=v::text $$;
    `);
    await db.exec(
      fs.readFileSync(
        "supabase/migrations/20260930113500_projected_scoped_assignment_lineage.sql",
        "utf8",
      ),
    );
    const counted = async () =>
      (
        await db.query(
          `SELECT s.version_id,count(*) FILTER(WHERE assignment_version_private.new_side_wins(s.assignment_id))::int n FROM assignment_version_private.scope s GROUP BY 1 ORDER BY 1`,
        )
      ).rows;
    assert.deepEqual(await counted(), [
      { version_id: id(10), n: 2 },
      { version_id: id(12), n: 0 },
    ]);
    await db.exec(`SELECT set_config('app.assume_promoted_version','${id(12)}',false)`);
    assert.deepEqual(await counted(), [
      { version_id: id(10), n: 0 },
      { version_id: id(12), n: 2 },
    ]);
    await db.exec(`SELECT set_config('app.assume_promoted_version','',false)`);
    assert.deepEqual(await counted(), [
      { version_id: id(10), n: 2 },
      { version_id: id(12), n: 0 },
    ]);
    await db.exec(
      `UPDATE schedule_versions SET status='published' WHERE id='${id(12)}'; INSERT INTO assignment_version_private.promotions VALUES('${id(12)}','2026-09-30');`,
    );
    assert.deepEqual(await counted(), [
      { version_id: id(10), n: 0 },
      { version_id: id(12), n: 2 },
    ]);
  } finally {
    await db.close();
  }
});

test("native importer rejects unauthorized, unregistered, stale and publication actions atomically", async () => {
  const db = await fixture();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
   CREATE TABLE itcs_cutover_private.review_proposal_registry(profile text PRIMARY KEY,payload jsonb);
   CREATE OR REPLACE FUNCTION public.itcs_cutover_execute(p_stage text,p_version uuid,p_published uuid,p_manifest jsonb,p_manifest_sha text,p_expected_published_snapshot text)
   RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
  IF p_stage='rooms' THEN RETURN '{}'; END IF;
   RAISE EXCEPTION 'OTHER_PROFILE'; END $$;
   CREATE FUNCTION public.schedule_version_session_snapshot(v uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'baseline'::text $$;
   CREATE FUNCTION itcs_cutover_private.delivery_facts_snapshot(v uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'facts'::text $$;
   CREATE FUNCTION public.clone_schedule_version_current(uuid,uuid,uuid,text,text,boolean,boolean)
   RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
    INSERT INTO public.schedule_versions VALUES(gen_random_uuid(),'${id(2)}','${id(3)}','draft');
    RAISE EXCEPTION 'INJECTED_CLONE_FAILURE'; END $$;
  `);
    await db.exec(migration);
    // The historical fixture loads Rev2's writer. Live Rev3 also validates
    // projected workload before returning; reproduce that deployed contract.
    await db.exec(`DO $$ DECLARE d text:=pg_get_functiondef('assignment_version_private.apply_replacement(uuid,uuid,uuid,numeric,uuid)'::regprocedure); BEGIN
      EXECUTE replace(d,'  RETURN jsonb_build_object',E'  PERFORM assignment_version_private.assert_projected_load(p_version);\n  RETURN jsonb_build_object'); END $$;`);
    await db.exec(
      fs.readFileSync(
        "supabase/migrations/20260930114000_atomic_native_assignment_load.sql",
        "utf8",
      ),
    );
    const profile = "itcs_proposal16_review_20260930";
    const invoke = (stage = "review_check", hash = "hash", expected = "baseline") =>
      db.query(`SELECT itcs_cutover_execute($1,$2,$2,$3,$4,$5)`, [
        stage,
        id(11),
        { profile },
        hash,
        expected,
      ]);
    await db.exec(`SELECT set_config('test.uid','',false);`);
    await assert.rejects(invoke, /SUPER_ADMIN_REQUIRED/);
    await db.exec(`SELECT set_config('test.uid','${id(1)}',false);`);
    await assert.rejects(invoke, /UNREGISTERED_REVIEW_PROFILE/);
    await db.query(
      `INSERT INTO itcs_cutover_private.native_review_profiles(profile,manifest,manifest_sha,source_version_id,source_snapshot,source_full_snapshot,source_facts_snapshot,source_assignments)
   SELECT $1,jsonb_build_object('college_id',$2::text,'term_id',$3::text,'name','test'),'hash',$4,'baseline',
   (SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM schedule_sessions s WHERE schedule_version_id=$4),'facts',
   (SELECT jsonb_agg(to_jsonb(a)) FROM teaching_assignments a)`,
      [profile, id(2), id(3), id(11)],
    );
    await assert.rejects(() => invoke("publish"), /REVIEW_DRAFT_ONLY/);
    await assert.rejects(() => invoke("review_save", "wrong"), /UNREGISTERED_REVIEW_PROFILE/);
    await assert.rejects(
      () => invoke("review_check", "hash", "stale"),
      /UNREGISTERED_REVIEW_PROFILE/,
    );
    const before = (await db.query("SELECT count(*)::int n FROM schedule_versions")).rows[0].n;
    await assert.rejects(invoke, /INJECTED_CLONE_FAILURE/);
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM schedule_versions")).rows[0].n,
      before,
    );
    await db.exec(
      `CREATE OR REPLACE FUNCTION assignment_version_private.assert_projected_load(uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'PROJECTED_LIMIT_TEST'; END $$;`,
    );
    await assert.rejects(
      () =>
        db.exec(
          `SELECT decide_faculty_teaching_request('${id(90)}','approved','outside atomic import')`,
        ),
      /PROJECTED_LIMIT_TEST/,
    );
    await assert.rejects(
      () =>
        db.exec(`BEGIN;
      UPDATE itcs_cutover_private.native_review_profiles SET draft_version_id='${id(10)}',applying_txid=txid_current() WHERE profile='${profile}';
      SELECT decide_faculty_teaching_request('${id(90)}','approved','batch');
      SELECT decide_faculty_teaching_request('${id(91)}','approved','batch');
      SELECT assignment_version_private.assert_projected_load('${id(10)}');
      COMMIT;`),
      /PROJECTED_LIMIT_TEST/,
    );
    await db.exec("ROLLBACK");
    assert.equal(
      (await db.query("SELECT count(*)::int n FROM assignment_version_private.scope")).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          `SELECT count(*)::int n FROM faculty_teaching_requests WHERE status='pending'`,
        )
      ).rows[0].n,
      2,
    );
    await db.exec(
      `UPDATE schedule_sessions SET start_time='07:00' WHERE schedule_version_id='${id(11)}'`,
    );
    await assert.rejects(invoke, /REVIEW_SOURCE_DRIFT/);
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      () => db.query("SELECT * FROM itcs_cutover_private.native_review_profiles"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

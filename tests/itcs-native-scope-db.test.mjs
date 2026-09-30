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

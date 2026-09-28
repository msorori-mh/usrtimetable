import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { PGlite } = await import(process.env.CLONE_DB_MODULE ?? "@electric-sql/pglite");
const sql = readFileSync("supabase/migrations/20260928194000_registered_itcs_relayout.sql", "utf8");
const moves = readFileSync("tests/fixtures/itcs-room-moves-live.sql", "utf8").split(
  "CREATE OR REPLACE FUNCTION public.is_assignment_room_compatible",
)[0];
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const source = "258f6f60-539e-43e1-a4bb-f0b07c20c9ab",
  college = "7168345f-cf9d-4789-b2ad-547abb687dc8",
  term = "18dd364a-76d7-40b8-a217-fa929c082a7f";
const tables = [
  "scope",
  "cohort_facts",
  "group_facts",
  "partner_group_facts",
  "partition_facts",
  "group_partition_facts",
  "shared_link_facts",
  "partner_partition_facts",
  "component_room_type_facts",
  "instructor_hour_waivers",
];
async function fixture() {
  const db = new PGlite();
  await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA itcs_cutover_private; CREATE SCHEMA assignment_version_private; CREATE SCHEMA schedule_version_delivery_private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
 CREATE FUNCTION is_super_admin(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u='${uid(1)}' $$;
 CREATE FUNCTION can_manage_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT is_super_admin(u) $$;
 CREATE TABLE schedule_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),college_id uuid,academic_term_id uuid,status text DEFAULT 'draft',eligibility_revision integer DEFAULT 0);
 CREATE TABLE schedule_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),college_id uuid,schedule_version_id uuid,course_offering_id uuid,teaching_assignment_id uuid,instructor_id uuid,room_id uuid,section_id uuid,section_group_id uuid,section_subgroup_id uuid,cohort_id uuid,delivery_group_id uuid,plan_course_component_id uuid,study_system text,day_of_week smallint,start_time time,end_time time,session_type text,expected_students integer,source_type text,is_locked boolean DEFAULT false,lock_reason text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),auto_schedule_run_id uuid);
 CREATE TABLE teaching_assignments(id uuid PRIMARY KEY,delivery_group_id uuid,instructor_id uuid,college_id uuid,is_active boolean);
 CREATE TABLE schedule_version_conflict_exceptions(schedule_version_id uuid,status text);
 CREATE TABLE schedule_quality_runs(id uuid DEFAULT gen_random_uuid(),schedule_version_id uuid,college_id uuid,created_at timestamptz DEFAULT now(),eligibility_revision integer,hard_conflicts_count integer);
 CREATE TABLE audit_logs(actor_id uuid,action text,entity text,entity_id uuid,college_id uuid,details jsonb);
 CREATE TABLE itcs_cutover_private.runs(version_id uuid,manifest_sha text,stage text,result jsonb,actor uuid,created_at timestamptz DEFAULT now(),PRIMARY KEY(version_id,manifest_sha,stage));
 CREATE TABLE assignment_version_private.publish_expectation(version_id uuid PRIMARY KEY,expected_sessions integer,expected_snapshot text,set_by uuid,set_at timestamptz DEFAULT now());
 CREATE TABLE assignment_version_private.move_receipts(version_id uuid,before_snapshot text,after_snapshot text,moved integer,actor uuid,applied_at timestamptz DEFAULT now());
 CREATE TABLE schedule_version_delivery_private.clone_provenance(version_id uuid PRIMARY KEY,source_version_id uuid);
 ${tables.map((t) => `CREATE TABLE schedule_version_delivery_private.${t}(version_id uuid,payload jsonb);`).join("\n")}
 CREATE FUNCTION assignment_version_private.assert_version_instructors(uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
 CREATE FUNCTION itcs_cutover_path_rules(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('ok',coalesce(current_setting('test.fail_rules',true),'false')<>'true') $$;
 CREATE FUNCTION version_scoped_publish_gate(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"ok":true}'::jsonb $$;
 CREATE FUNCTION itcs_cutover_preview(uuid,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
 CREATE FUNCTION itcs_cutover_execute(p_stage text,p_version uuid,p_published uuid,p_manifest jsonb,p_manifest_sha text,p_expected_published_snapshot text) RETURNS jsonb LANGUAGE plpgsql SET search_path='public' AS $$ BEGIN
  IF p_stage='rooms' THEN RETURN '{}'; END IF;
  RAISE EXCEPTION 'LEGACY_ONLY'; END $$;
 CREATE FUNCTION test_final_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
 CREATE CONSTRAINT TRIGGER coordination_sessions_final AFTER UPDATE ON schedule_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_final_guard();
 CREATE CONSTRAINT TRIGGER instructor_daily_session_cap_final AFTER UPDATE ON schedule_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_final_guard();
 CREATE FUNCTION transition_schedule_version(c uuid,v uuid,f text,t text,n text) RETURNS jsonb LANGUAGE plpgsql SET search_path='public' AS $$ BEGIN UPDATE schedule_versions SET status=t WHERE id=v AND college_id=c AND status=f; IF NOT FOUND THEN RAISE EXCEPTION 'STATUS_CAS'; END IF; RETURN '{}'; END $$;
 INSERT INTO schedule_versions(id,college_id,academic_term_id,status) VALUES('${source}','${college}','${term}','published');
 INSERT INTO schedule_sessions(id,college_id,schedule_version_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,cohort_id,delivery_group_id,plan_course_component_id,study_system,day_of_week,start_time,end_time,session_type,expected_students,source_type)
 SELECT ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,'${college}','${source}','${uid(10)}',('00000000-0000-4000-8000-'||lpad((2000+n)::text,12,'0'))::uuid,'${uid(20)}','${uid(30)}','${uid(40)}',('00000000-0000-4000-8000-'||lpad((3000+n)::text,12,'0'))::uuid,'${uid(50)}','regular',1,'08:00',CASE WHEN n<=80 THEN '11:00'::time ELSE '10:00'::time END,'lecture',42,'manual' FROM generate_series(1,282)n;
 INSERT INTO teaching_assignments SELECT teaching_assignment_id,delivery_group_id,instructor_id,college_id,id NOT IN('${uid(1001)}','${uid(1002)}') FROM schedule_sessions;
 INSERT INTO teaching_assignments VALUES('${uid(9001)}','${uid(3001)}','${uid(91)}','${college}',true),('${uid(9002)}','${uid(3002)}','${uid(92)}','${college}',true);
 INSERT INTO schedule_version_delivery_private.group_facts VALUES('${source}','{"students":125}');
 CREATE FUNCTION clone_schedule_version_current(c uuid,s uuid,t uuid,n text,notes text,disposable boolean,complete boolean) RETURNS jsonb LANGUAGE plpgsql SET search_path='public' AS $$
 DECLARE v uuid; skipped jsonb; copied integer; tn text;
 BEGIN
 INSERT INTO schedule_versions(college_id,academic_term_id) VALUES(c,t) RETURNING id INTO v;
 INSERT INTO schedule_version_delivery_private.clone_provenance VALUES(v,s);
 INSERT INTO schedule_version_delivery_private.group_facts SELECT v,payload FROM schedule_version_delivery_private.group_facts WHERE version_id=s;
 INSERT INTO schedule_sessions SELECT (jsonb_populate_record(NULL::schedule_sessions,to_jsonb(ss)||jsonb_build_object('id',gen_random_uuid(),'schedule_version_id',v))).* FROM schedule_sessions ss JOIN teaching_assignments a ON a.id=ss.teaching_assignment_id WHERE ss.schedule_version_id=s AND a.is_active;
 GET DIAGNOSTICS copied=ROW_COUNT;
 SELECT jsonb_agg(jsonb_build_object('session_id',ss.id,'reason','inactive_assignment','teaching_assignment_id',ss.teaching_assignment_id)) INTO skipped FROM schedule_sessions ss JOIN teaching_assignments a ON a.id=ss.teaching_assignment_id WHERE ss.schedule_version_id=s AND NOT a.is_active;
 RETURN jsonb_build_object('version_id',v,'sessions_copied',copied,'sessions_skipped',jsonb_array_length(skipped),'skipped_sessions',skipped);
 END $$;
 `);
  await db.exec(moves);
  await db.exec(sql);
  const rows = (await db.query("SELECT * FROM schedule_sessions ORDER BY id")).rows;
  const manifest = {
    profile: "compliance_20260928_wathiq08",
    draft_version_id: source,
    published_version_id: source,
    term_id: term,
    replacements: [],
    sessions: rows.map((s) => ({
      session_id: s.id,
      delivery_group_id: s.delivery_group_id,
      changed: true,
      old: {
        day: s.day_of_week,
        start: s.start_time,
        end: s.end_time,
        room: s.room_id,
        instructor: s.instructor_id,
        teaching_assignment_id: s.teaching_assignment_id,
      },
      new: { day: 2, start: s.start_time, end: s.end_time, room: s.room_id },
    })),
    assignment_updates: [1, 2].map((n) => ({
      source_session_id: uid(1000 + n),
      group_id: uid(3000 + n),
      old_assignment: uid(2000 + n),
      new_assignment: uid(9000 + n),
      new_instructor: uid(90 + n),
    })),
  };
  await db.query(
    `UPDATE itcs_cutover_private.relayout_profiles SET manifest_sha=md5($1::jsonb::text),source_snapshot=schedule_version_session_snapshot(source_version_id),history=(SELECT jsonb_build_array(jsonb_build_object('version_id',$2::uuid,'sessions',282,'snapshot',schedule_version_session_snapshot($2),'full_snapshot',md5(jsonb_agg(to_jsonb(ss) ORDER BY id)::text))) FROM schedule_sessions ss),target_fingerprint=(SELECT md5(jsonb_agg((to_jsonb(ss)-ARRAY['id','schedule_version_id','created_at','updated_at','auto_schedule_run_id'])||jsonb_build_object('day_of_week',2,'teaching_assignment_id',CASE ss.id WHEN '${uid(1001)}' THEN '${uid(9001)}'::uuid WHEN '${uid(1002)}' THEN '${uid(9002)}'::uuid ELSE ss.teaching_assignment_id END,'instructor_id',CASE ss.id WHEN '${uid(1001)}' THEN '${uid(91)}'::uuid WHEN '${uid(1002)}' THEN '${uid(92)}'::uuid ELSE ss.instructor_id END) ORDER BY delivery_group_id)::text) FROM schedule_sessions ss)`,
    [manifest, source],
  );
  await db.exec(`SELECT set_config('test.uid','${uid(1)}',false)`);
  return {
    db,
    manifest,
    run: async (stage = "apply", m = manifest) =>
      (
        await db.query(
          `SELECT public.itcs_cutover_execute($1,$2,$2,$3,md5($3::jsonb::text),schedule_version_session_snapshot($2)) r`,
          [stage, source, m],
        )
      ).rows[0].r,
  };
}

test("registered relayout rejects unauthorized users, tampering and source drift", async () => {
  const { db, manifest, run } = await fixture();
  try {
    await db.exec(`SELECT set_config('test.uid','${uid(99)}',false)`);
    await assert.rejects(() => run(), /SUPER_ADMIN_REQUIRED/);
    await db.exec(`SELECT set_config('test.uid','${uid(1)}',false)`);
    const bad = structuredClone(manifest);
    bad.sessions[0].new.day = 3;
    await assert.rejects(() => run("apply", bad), /UNREGISTERED_RELAYOUT_MANIFEST/);
    await db.exec("UPDATE schedule_sessions SET expected_students=99 WHERE id='" + uid(1001) + "'");
    await assert.rejects(() => run(), /RELAYOUT_HISTORY_DRIFT/);
    assert.equal((await db.query("SELECT count(*) n FROM schedule_versions")).rows[0].n, 1);
  } finally {
    await db.close();
  }
});
test("clone, two active assignments and moves roll back together on a failed final gate", async () => {
  const { db, run } = await fixture();
  try {
    await db.exec("SELECT set_config('test.fail_rules','true',false)");
    await assert.rejects(() => run(), /PATH_RULES_FAILED/);
    assert.equal((await db.query("SELECT count(*) n FROM schedule_versions")).rows[0].n, 1);
    assert.equal(
      (await db.query("SELECT count(*) n FROM assignment_version_private.move_receipts")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("SELECT draft_version_id d FROM itcs_cutover_private.relayout_profiles"))
        .rows[0].d,
      null,
    );
  } finally {
    await db.close();
  }
});
test("successful relayout preserves 282 sessions, 644 hours, facts and history; publication requires current quality", async () => {
  const { db, run } = await fixture();
  try {
    const applied = await run();
    assert.equal(applied.stage, "applied");
    const v = applied.version_id;
    assert.equal((await run()).replayed, true);
    const s = (
      await db.query(
        "SELECT count(*) n,sum(extract(epoch FROM end_time-start_time)/3600) h FROM schedule_sessions WHERE schedule_version_id=$1",
        [v],
      )
    ).rows[0];
    assert.equal(s.n, 282);
    assert.equal(Number(s.h), 644);
    assert.equal(
      (
        await db.query(
          "SELECT count(*) n FROM teaching_assignments WHERE id IN($1,$2) AND is_active",
          [uid(2001), uid(2002)],
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(() => run("publish"), /QUALITY_RUN_REQUIRED_AT_CURRENT_REVISION/);
    await db.query(
      "INSERT INTO schedule_quality_runs(schedule_version_id,college_id,eligibility_revision,hard_conflicts_count) VALUES($1,$2,-1,0)",
      [v, college],
    );
    await assert.rejects(() => run("publish"), /QUALITY_RUN_REQUIRED_AT_CURRENT_REVISION/);
    await db.query(
      "INSERT INTO schedule_quality_runs(schedule_version_id,college_id,eligibility_revision,hard_conflicts_count) VALUES($1,$2,0,0)",
      [v, college],
    );
    const published = await run("publish");
    assert.equal(published.stage, "published");
    assert.equal((await run("publish")).replayed, true);
    assert.deepEqual(
      (
        await db.query(
          "SELECT status,count(*) n FROM schedule_versions GROUP BY status ORDER BY status",
        )
      ).rows,
      [
        { status: "archived", n: 1 },
        { status: "published", n: 1 },
      ],
    );
    await db.query("UPDATE schedule_sessions SET instructor_id=$2 WHERE schedule_version_id=$1", [
      v,
      uid(77),
    ]);
    await assert.rejects(() => run("publish"), /RELAYOUT_DRAFT_DRIFT/);
  } finally {
    await db.close();
  }
});

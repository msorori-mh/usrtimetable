import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { PGlite } = await import(process.env.PGLITE_TEST_MODULE ?? "@electric-sql/pglite");
const migrationPath = "supabase/migrations/20261002220000_itcs_current_operational_adoption.sql";
const rollbackPath = "supabase/rollbacks/20261002220000_itcs_current_operational_adoption.sql";
const read = (path) => fs.readFileSync(path, "utf8");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = id(1),
  outsider = id(2),
  college = id(10),
  term = id(20);
const target = id(101),
  source = id(102),
  profile = "itcs_current_operational_20261002";
const timestamp = "2026-01-01T00:00:00+00:00";

function functionSql(sql, name) {
  const start = new RegExp(
    "^CREATE (?:OR REPLACE )?FUNCTION " + name.replaceAll(".", "\\.") + "\\(",
    "m",
  ).exec(sql);
  assert.ok(start, name);
  const tail = sql.slice(start.index);
  const delimiter = /\bAS\s+(\$[a-z_]*\$)/i.exec(tail);
  assert.ok(delimiter, name);
  const close = tail.indexOf(delimiter[1], delimiter.index + delimiter[0].length);
  assert.ok(close > 0, name);
  return tail.slice(0, close + delimiter[1].length) + ";";
}

// All entities are invented. This fixture delegates scheduling validators to
// explicit stubs: it proves the SQL API transaction/security contract, not the
// production schedule, workload, memberships, availability or canonical guards.
async function fixture({ register = true } = {}) {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA auth;CREATE SCHEMA assignment_version_private;CREATE SCHEMA itcs_cutover_private;CREATE SCHEMA faculty_private;
      CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
      CREATE FUNCTION public.is_super_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT $1='${actor}'::uuid$$;
      CREATE FUNCTION public.can_manage_college(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT public.is_super_admin($1)$$;
      SELECT set_config('test.uid','${actor}',false);
      CREATE TABLE schedule_versions(id uuid PRIMARY KEY,college_id uuid,academic_term_id uuid,status text,eligibility_revision bigint DEFAULT 7,updated_at timestamptz DEFAULT '${timestamp}',created_at timestamptz DEFAULT '${timestamp}',is_coordination boolean DEFAULT false,disposable_test boolean DEFAULT false);
      CREATE TABLE schedule_sessions(id uuid PRIMARY KEY,college_id uuid,schedule_version_id uuid,teaching_assignment_id uuid,instructor_id uuid,delivery_group_id uuid,cohort_id uuid,plan_course_component_id uuid,course_offering_id uuid,section_id uuid,study_system text,expected_students integer,day_of_week smallint,start_time time,end_time time,room_id uuid,updated_at timestamptz DEFAULT '${timestamp}',is_locked boolean DEFAULT false,replaced_by_split boolean DEFAULT false);
      CREATE TABLE teaching_assignments(id uuid PRIMARY KEY,college_id uuid,course_offering_id uuid,instructor_id uuid,delivery_group_id uuid,assigned_component_hours numeric,weekly_hours numeric,updated_at timestamptz DEFAULT '${timestamp}',is_active boolean DEFAULT true);
      CREATE TABLE instructors(id uuid PRIMARY KEY,is_active boolean DEFAULT true,availability_status text DEFAULT 'available');
      CREATE TABLE course_offerings(id uuid PRIMARY KEY,term_id uuid);
      CREATE TABLE plan_course_components(id uuid PRIMARY KEY,weekly_contact_hours numeric);
      CREATE TABLE faculty_teaching_requests(id uuid,assignment_id uuid,status text,identity_id uuid,instructor_id uuid,college_id uuid,home_college_id uuid,delivery_group_id uuid,term_id uuid,assigned_hours numeric,decided_by uuid,decided_at timestamptz);
      CREATE TABLE faculty_identity_links(instructor_id uuid,identity_id uuid);
      CREATE TABLE faculty_private.home_profiles(identity_id uuid,home_college_id uuid,is_active boolean);
      CREATE TABLE assignment_version_private.scope(assignment_id uuid PRIMARY KEY,version_id uuid,replaces_assignment_id uuid,created_by uuid,created_at timestamptz DEFAULT '${timestamp}');
      CREATE TABLE assignment_version_private.enabled_versions(version_id uuid PRIMARY KEY);
      CREATE TABLE assignment_version_private.promotions(version_id uuid PRIMARY KEY,promoted_at timestamptz DEFAULT now(),promoted_by uuid);
      CREATE TABLE assignment_version_private.publish_expectation(version_id uuid PRIMARY KEY,expected_sessions integer,expected_snapshot text,set_by uuid,set_at timestamptz DEFAULT now());
      CREATE TABLE itcs_cutover_private.runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version_id uuid,manifest_sha text,stage text CHECK(stage IN('requests','applied','published')),result jsonb,actor uuid,created_at timestamptz DEFAULT now(),UNIQUE(version_id,manifest_sha,stage));
      CREATE TABLE schedule_quality_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),college_id uuid,schedule_version_id uuid,eligibility_revision bigint,hard_conflicts_count integer,created_at timestamptz DEFAULT now());
      CREATE TABLE audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid,action text,entity text,entity_id uuid,college_id uuid,details jsonb);
      CREATE TABLE synthetic_transition_calls(id integer GENERATED ALWAYS AS IDENTITY,version_id uuid,previous_status text,next_status text);
      CREATE FUNCTION public.itcs_cutover_execute(p_stage text,p_version uuid,p_published uuid,p_manifest jsonb,p_manifest_sha text,p_expected_published_snapshot text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
 RETURN jsonb_build_object('legacy',p_stage);
END
$$;
      REVOKE ALL ON FUNCTION public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text) FROM PUBLIC,anon;
      GRANT EXECUTE ON FUNCTION public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text) TO authenticated;
      CREATE FUNCTION assignment_version_private.is_promoted(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM assignment_version_private.promotions WHERE version_id=$1)$$;
      SET check_function_bodies=off;`);
    // These existing generic policies are real repository definitions. No
    // captured catalog file or operational payload is imported.
    for (const [path, name] of [
      [
        "supabase/migrations/20260928090000_scoped_effective_before_relink.sql",
        "public.version_effective_assignments",
      ],
      [
        "supabase/migrations/20260930113500_projected_scoped_assignment_lineage.sql",
        "assignment_version_private.new_side_wins",
      ],
      [
        "supabase/migrations/20260928082500_version_scoped_workload.sql",
        "assignment_version_private.is_counted",
      ],
      [
        "supabase/migrations/20260928082000_version_scoped_assignments.sql",
        "public.guard_session_version_scoped_assignment",
      ],
      [
        "supabase/migrations/20260928082000_version_scoped_assignments.sql",
        "public.schedule_version_session_snapshot",
      ],
    ])
      await db.exec(functionSql(read(path), name));
    await db.exec(`CREATE FUNCTION itcs_cutover_private.delivery_facts_snapshot(uuid) RETURNS text LANGUAGE sql STABLE AS $$SELECT md5('synthetic-frozen-facts')$$;
      CREATE FUNCTION public._sb_v2_assignment_guard(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"ok":true}'::jsonb$$;
      CREATE FUNCTION public.validate_version_assignment_allocation(uuid,uuid,numeric) RETURNS void LANGUAGE plpgsql AS $$BEGIN IF current_setting('test.reject_validator',true)='yes' THEN RAISE EXCEPTION 'SYNTHETIC_VALIDATOR_REJECTED';END IF;END$$;
      CREATE FUNCTION public._collect_schedule_session_move_conflicts(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer,integer,time,time,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"blocking_conflicts":[],"warnings":[],"approved_exceptions":[]}'::jsonb$$;
      CREATE FUNCTION public.schedule_version_delivery_coverage(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"complete":true}'::jsonb$$;
      CREATE FUNCTION assignment_version_private.assert_version_instructors(uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
      CREATE FUNCTION assignment_version_private.assert_projected_load(uuid) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN;END$$;
      CREATE FUNCTION public.seal_version_publish_expectation(uuid,integer,text) RETURNS void LANGUAGE sql AS $$INSERT INTO assignment_version_private.publish_expectation(version_id,expected_sessions,expected_snapshot,set_by) VALUES($1,$2,$3,auth.uid()) ON CONFLICT(version_id) DO UPDATE SET expected_sessions=$2,expected_snapshot=$3$$;
      CREATE FUNCTION public.version_scoped_publish_gate(uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT jsonb_build_object('ok',EXISTS(SELECT 1 FROM assignment_version_private.publish_expectation WHERE version_id=$1 AND expected_snapshot=public.schedule_version_session_snapshot($1)))$$;
      CREATE FUNCTION public.transition_schedule_version(uuid,uuid,text,text,text) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$BEGIN
       IF NOT public.can_manage_college(auth.uid(),$1) THEN RAISE EXCEPTION 'SCHEDULE_VERSION_TRANSITION_FORBIDDEN';END IF;
       IF NOT (($3,$4) IN (('review','draft'),('draft','review'),('review','approved'),('approved','published'),('published','archived'))) THEN RAISE EXCEPTION 'SYNTHETIC_TRANSITION_INVALID';END IF;
       UPDATE schedule_versions SET status=$4 WHERE id=$2 AND college_id=$1 AND status=$3;
       IF NOT FOUND THEN RAISE EXCEPTION 'SYNTHETIC_TRANSITION_CAS';END IF;
       INSERT INTO synthetic_transition_calls(version_id,previous_status,next_status) VALUES($2,$3,$4);
       IF $4='published' THEN INSERT INTO assignment_version_private.promotions(version_id,promoted_by) VALUES($2,auth.uid());END IF;
      END$$;
      CREATE TRIGGER synthetic_scoped_guard BEFORE INSERT OR UPDATE OF teaching_assignment_id,schedule_version_id ON schedule_sessions FOR EACH ROW EXECUTE FUNCTION public.guard_session_version_scoped_assignment();
      GRANT USAGE ON SCHEMA public,auth TO authenticated;
      GRANT SELECT ON schedule_sessions,schedule_versions TO authenticated;`);
    const migration = read(migrationPath);
    assert.doesNotMatch(migration, /EXACT PROFILE REGISTRATION|\$manifest\$/);
    await db.exec(migration);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::integer n FROM itcs_cutover_private.operational_adoption_profiles",
        )
      ).rows[0].n,
      0,
    );
    db.syntheticInputs = {
      manifest_sha: "unregistered",
      payload: {
        version_id: target,
        published_version_id: source,
        published_snapshot: "unregistered",
      },
    };
    if (register) await registerProfile(db);
    await db.exec("SET ROLE authenticated");
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function registerProfile(db) {
  await db.query(
    "INSERT INTO schedule_versions(id,college_id,academic_term_id,status) VALUES($1,$3,$4,'review'),($2,$3,$4,'published')",
    [target, source, college, term],
  );
  for (let n = 1; n <= 3; n++) {
    await db.query("INSERT INTO instructors(id) VALUES($1)", [id(200 + n)]);
    await db.query("INSERT INTO course_offerings VALUES($1,$2)", [id(700 + n), term]);
    await db.query("INSERT INTO plan_course_components VALUES($1,2)", [id(800 + n)]);
    await db.query(
      "INSERT INTO teaching_assignments(id,college_id,course_offering_id,instructor_id,delivery_group_id,assigned_component_hours,weekly_hours) VALUES($1,$2,$3,$4,$5,2,2)",
      [id(400 + n), college, id(700 + n), id(200 + n), id(300 + n)],
    );
  }
  await db.query(
    "INSERT INTO teaching_assignments(id,college_id,course_offering_id,instructor_id,delivery_group_id,assigned_component_hours,weekly_hours) VALUES($1,$2,$3,$4,$5,2,2)",
    [id(501), college, id(701), id(203), id(301)],
  );
  await db.query(
    "INSERT INTO assignment_version_private.scope(assignment_id,version_id,replaces_assignment_id,created_by) VALUES($1,$2,$3,$4)",
    [id(501), target, id(401), actor],
  );
  await db.query("INSERT INTO assignment_version_private.enabled_versions VALUES($1)", [target]);
  const sessions = [];
  for (let n = 1; n <= 3; n++) {
    const changed = n === 1,
      assignment = changed ? id(501) : id(400 + n),
      instructor = changed ? id(203) : id(200 + n);
    await db.query(
      "INSERT INTO schedule_sessions(id,college_id,schedule_version_id,teaching_assignment_id,instructor_id,delivery_group_id,cohort_id,plan_course_component_id,course_offering_id,day_of_week,start_time,end_time,room_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'08:00','10:00',$11)",
      [
        id(600 + n),
        college,
        target,
        assignment,
        instructor,
        id(300 + n),
        id(900 + n),
        id(800 + n),
        id(700 + n),
        n,
        id(1000 + n),
      ],
    );
    sessions.push({
      session_id: id(600 + n),
      expected_updated_at: timestamp,
      delivery_group_id: id(300 + n),
      old_assignment_id: assignment,
      old_instructor_id: instructor,
      expected_assignment_updated_at: timestamp,
      hours: 2,
      old: { day_of_week: n, start_time: "08:00:00", end_time: "10:00:00", room_id: id(1000 + n) },
      new: {
        assignment_id: id(400 + n),
        instructor_id: id(200 + n),
        day_of_week: n,
        start_time: changed ? "10:00:00" : "08:00:00",
        end_time: changed ? "12:00:00" : "10:00:00",
        room_id: id(1000 + n),
      },
      assignment_changed: changed,
      placement_changed: changed,
    });
  }
  await db.query(
    "INSERT INTO schedule_sessions SELECT (jsonb_populate_record(NULL::schedule_sessions,to_jsonb(s)||jsonb_build_object('id',$1::text,'schedule_version_id',$2::text,'teaching_assignment_id',$3::text,'instructor_id',$4::text))).* FROM schedule_sessions s WHERE id=$5",
    [id(699), source, id(401), id(201), id(601)],
  );
  const snapshot = async (v) =>
    (await db.query("SELECT schedule_version_session_snapshot($1) x", [v])).rows[0].x;
  const full = async (v) =>
    (
      await db.query(
        "SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) x FROM schedule_sessions s WHERE schedule_version_id=$1",
        [v],
      )
    ).rows[0].x;
  const payload = {
    profile,
    college_id: college,
    term_id: term,
    version_id: target,
    published_version_id: source,
    expected_version_status: "review",
    expected_version_updated_at: timestamp,
    expected_eligibility_revision: 7,
    before_snapshot: await snapshot(target),
    before_full_snapshot: await full(target),
    facts_snapshot: (
      await db.query("SELECT itcs_cutover_private.delivery_facts_snapshot($1) x", [target])
    ).rows[0].x,
    published_snapshot: await snapshot(source),
    history: [
      {
        version_id: source,
        sessions: 1,
        full_snapshot: await full(source),
        snapshot: await snapshot(source),
      },
    ],
    counts: {
      sessions: 3,
      hours: 6,
      assignment_changes: 1,
      placement_changes: 1,
      joint_session_changes: 1,
      withdrawals: 1,
      promoted_reuses: 0,
      preserved_inactive_scopes: 0,
    },
    waiting: {
      net_student_hours: 0,
      worsened_students: 0,
      worsened_student_hours: 0,
      added_student_days: 0,
    },
    sessions,
    withdrawals: [
      {
        assignment_id: id(501),
        version_id: target,
        replaces_assignment_id: id(401),
        adopted_assignment_id: id(401),
        expected_scope_created_at: timestamp,
      },
    ],
    promoted_reuses: [],
    preserved_inactive_scope_ids: [],
    foreign_approvals: [],
    limitations: ["Synthetic contract fixture; scheduling validators are explicit stubs."],
  };
  await db.query(
    "INSERT INTO itcs_cutover_private.operational_adoption_profiles(profile,payload,manifest_sha,immutable_session_snapshot,assignment_snapshot,scope_snapshot) VALUES($1,$2,md5($2::jsonb::text),itcs_cutover_private.operational_adoption_immutable_snapshot($3),'pending','pending')",
    [profile, payload, target],
  );
  await db.query(
    "UPDATE itcs_cutover_private.operational_adoption_profiles SET assignment_snapshot=itcs_cutover_private.operational_adoption_assignment_snapshot($1),scope_snapshot=itcs_cutover_private.operational_adoption_scope_snapshot($1) WHERE profile=$1",
    [profile],
  );
  db.syntheticInputs = (
    await db.query(
      "SELECT manifest_sha,payload FROM itcs_cutover_private.operational_adoption_profiles WHERE profile=$1",
      [profile],
    )
  ).rows[0];
}

async function invoke(db, stage = "operational_apply", overrides = {}) {
  const p = db.syntheticInputs;
  return (
    await db.query("SELECT public.itcs_cutover_execute($1,$2,$3,$4,$5,$6) x", [
      stage,
      overrides.version ?? target,
      source,
      overrides.manifest ?? { profile },
      overrides.sha ?? p.manifest_sha,
      p.payload.published_snapshot,
    ])
  ).rows[0].x;
}
async function preview(db) {
  return (await db.query("SELECT public.itcs_operational_adoption_preview($1) x", [profile]))
    .rows[0].x;
}
async function owner(db, sql) {
  await db.exec("RESET ROLE");
  await db.exec(sql);
  await db.exec("SET ROLE authenticated");
}
async function state(db) {
  await db.exec("RESET ROLE");
  const x = (
    await db.query(
      `SELECT jsonb_build_object('sessions',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM schedule_sessions s),'assignments',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM teaching_assignments a),'scope',(SELECT jsonb_agg(to_jsonb(a) ORDER BY assignment_id) FROM assignment_version_private.scope a),'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM schedule_versions v),'runs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM itcs_cutover_private.runs r),'withdrawals',(SELECT jsonb_agg(to_jsonb(w) ORDER BY assignment_id) FROM assignment_version_private.operational_scope_withdrawals w),'seal',(SELECT jsonb_agg(to_jsonb(e) ORDER BY version_id) FROM assignment_version_private.publish_expectation e),'transitions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM synthetic_transition_calls t),'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_logs a)) x`,
    )
  ).rows[0].x;
  await db.exec("SET ROLE authenticated");
  return x;
}

test("synthetic API denies unregistered profiles, missing/outsider actors, helper access and unauthorized receipt replay", async () => {
  const unregistered = await fixture({ register: false });
  try {
    await assert.rejects(() => preview(unregistered), /OPERATIONAL_ADOPTION_PROFILE_MISMATCH/);
  } finally {
    await unregistered.close();
  }
  const db = await fixture();
  try {
    const before = await state(db);
    for (const uid of ["", outsider]) {
      await db.query("SELECT set_config('test.uid',$1,false)", [uid]);
      await assert.rejects(() => preview(db), /SUPER_ADMIN_REQUIRED/);
      for (const stage of ["operational_check", "operational_apply", "operational_publish"])
        await assert.rejects(() => invoke(db, stage), /SUPER_ADMIN_REQUIRED/);
      assert.deepEqual(await state(db), before);
    }
    await db.query("SELECT set_config('test.uid',$1,false)", [actor]);
    for (const role of ["authenticated", "anon", "service_role"]) {
      await db.exec(`RESET ROLE;SET ROLE ${role}`);
      await assert.rejects(
        () => db.query("SELECT * FROM itcs_cutover_private.operational_adoption_profiles"),
        /permission denied/,
      );
      await assert.rejects(
        () => db.query("SELECT * FROM assignment_version_private.operational_scope_withdrawals"),
        /permission denied/,
      );
      await assert.rejects(
        () =>
          db.query("SELECT itcs_cutover_private.assert_operational_adoption_target($1)", [profile]),
        /permission denied/,
      );
    }
    await db.exec("RESET ROLE;SET ROLE authenticated");
    await invoke(db);
    const applied = await state(db);
    await db.query("SELECT set_config('test.uid',$1,false)", [outsider]);
    await assert.rejects(() => invoke(db), /SUPER_ADMIN_REQUIRED/);
    assert.deepEqual(await state(db), applied);
  } finally {
    await db.close();
  }
});

test("synthetic profile identity, stale CAS and post-mutation validator failure leave all persisted state intact", async () => {
  const db = await fixture();
  try {
    const before = await state(db);
    for (const overrides of [
      { sha: "forged" },
      { version: outsider },
      { manifest: { profile, client_moves: [] } },
    ]) {
      await assert.rejects(
        () => invoke(db, "operational_apply", overrides),
        /OPERATIONAL_ADOPTION_PROFILE_MISMATCH/,
      );
      assert.deepEqual(await state(db), before);
    }
    await owner(db, `UPDATE schedule_versions SET eligibility_revision=8 WHERE id='${target}'`);
    const stale = await state(db);
    await assert.rejects(() => invoke(db), /OPERATIONAL_ADOPTION_BASELINE_DRIFT/);
    assert.deepEqual(await state(db), stale);
    await owner(db, `UPDATE schedule_versions SET eligibility_revision=7 WHERE id='${target}'`);
    await db.exec("SELECT set_config('test.reject_validator','yes',false)");
    await assert.rejects(() => invoke(db), /SYNTHETIC_VALIDATOR_REJECTED/);
    assert.deepEqual(await state(db), before);
    await db.exec("SELECT set_config('test.reject_validator','',false)");
    const checked = await invoke(db, "operational_check");
    assert.equal(checked.rolled_back, true);
    assert.equal(checked.sealed, true);
    assert.deepEqual(await state(db), before);
  } finally {
    await db.close();
  }
});

test("synthetic apply seals exactly one withdrawal and publish requires fresh quality before ordered lifecycle callbacks", async () => {
  const db = await fixture();
  try {
    await assert.rejects(
      () => invoke(db, "operational_publish"),
      /OPERATIONAL_ADOPTION_APPLY_REQUIRED/,
    );
    const before = await state(db);
    const applied = await invoke(db);
    assert.equal(applied.stage, "applied");
    assert.equal(applied.counts.sessions, 3);
    assert.equal(applied.counts.hours, 6);
    const after = await state(db);
    assert.deepEqual(after.assignments, before.assignments);
    assert.deepEqual(after.scope, before.scope);
    assert.equal(after.withdrawals.length, 1);
    assert.equal(after.withdrawals[0].assignment_id, id(501));
    assert.deepEqual(after.withdrawals[0].scope_before, before.scope[0]);
    assert.equal((await preview(db)).sealed, true);
    assert.equal((await invoke(db)).replayed, true);
    await assert.rejects(
      () => invoke(db, "operational_publish"),
      /OPERATIONAL_ADOPTION_QUALITY_REQUIRED/,
    );
    for (const [revision, hard] of [
      [7, 0],
      [8, 1],
    ]) {
      await owner(
        db,
        `DELETE FROM schedule_quality_runs;INSERT INTO schedule_quality_runs(college_id,schedule_version_id,eligibility_revision,hard_conflicts_count,created_at) VALUES('${college}','${target}',${revision},${hard},'2099-01-01')`,
      );
      await assert.rejects(
        () => invoke(db, "operational_publish"),
        /OPERATIONAL_ADOPTION_QUALITY_REQUIRED/,
      );
    }
    await owner(
      db,
      `DELETE FROM schedule_quality_runs;INSERT INTO schedule_quality_runs(college_id,schedule_version_id,eligibility_revision,hard_conflicts_count,created_at) VALUES('${college}','${target}',8,0,'2099-01-01')`,
    );
    const result = await invoke(db, "operational_publish");
    assert.equal(result.stage, "published");
    const published = await state(db);
    assert.equal(published.versions.find((v) => v.id === target).status, "published");
    assert.equal(published.versions.find((v) => v.id === source).status, "archived");
    assert.deepEqual(
      published.transitions.map((t) => [t.previous_status, t.next_status]),
      [
        ["review", "draft"],
        ["draft", "review"],
        ["review", "approved"],
        ["approved", "published"],
        ["published", "archived"],
      ],
    );
    assert.deepEqual(published.sessions, after.sessions);
    assert.deepEqual(published.assignments, before.assignments);
    assert.deepEqual(published.scope, before.scope);
    assert.equal((await invoke(db, "operational_publish")).replayed, true);
    await db.exec("RESET ROLE");
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::integer n FROM assignment_version_private.promotions WHERE version_id=$1",
          [target],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("SELECT assignment_version_private.new_side_wins($1) x", [id(501)])).rows[0]
        .x,
      false,
    );
  } finally {
    await db.close();
  }
});

test("synthetic rollback restores patched definitions/ACL before apply and refuses a populated adoption ledger", async () => {
  const db = await fixture();
  try {
    await db.exec("RESET ROLE");
    const originals = (
      await db.query(
        "SELECT signature,definition FROM itcs_cutover_private.operational_adoption_original_defs ORDER BY signature",
      )
    ).rows;
    const sig = "public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text)";
    const acl = (
      await db.query("SELECT proacl::text x FROM pg_proc WHERE oid=$1::regprocedure", [sig])
    ).rows[0].x;
    await db.exec(read(rollbackPath));
    for (const row of originals)
      assert.equal(
        (await db.query("SELECT pg_get_functiondef($1::regprocedure) x", [row.signature])).rows[0]
          .x,
        row.definition,
      );
    assert.equal(
      (await db.query("SELECT proacl::text x FROM pg_proc WHERE oid=$1::regprocedure", [sig]))
        .rows[0].x,
      acl,
    );
  } finally {
    await db.close();
  }
  const adopted = await fixture();
  try {
    await invoke(adopted);
    const before = await state(adopted);
    await adopted.exec("RESET ROLE");
    await assert.rejects(
      () => adopted.exec(read(rollbackPath)),
      /OPERATIONAL_ADOPTION_ROLLBACK_AFTER_DATA_APPLY_FORBIDDEN/,
    );
    await adopted.exec("ROLLBACK");
    assert.deepEqual(await state(adopted), before);
  } finally {
    await adopted.close();
  }
});

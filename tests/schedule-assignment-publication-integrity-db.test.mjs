import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { PGlite } = await import(
  process.env.PGLITE_TEST_MODULE ?? process.env.CLONE_DB_MODULE ?? "@electric-sql/pglite"
);
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read(
  "../supabase/migrations/20261002050000_schedule_assignment_publication_integrity.sql",
);
const lifecycle = read("./fixtures/schedule-assignment-integrity-lifecycle.sql");
const rollback = read(
  "../supabase/rollbacks/20261002050000_schedule_assignment_publication_integrity.sql",
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const college = id(1),
  actor = id(2),
  version = id(3),
  session = id(4);
const assignment = id(5),
  lecturer = id(6),
  group = id(7);
const historicalVersion = id(20),
  historicalSession = id(21);

// The fixture installs the complete observed lifecycle definition. Its existing
// coverage/quality inputs are controlled independently of session links, exactly
// the boundary that previously permitted stale assignment links to pass.
async function fixture({ install = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('test.uid', true), '')::uuid
    $$;
    CREATE TABLE schedule_versions (
      id uuid PRIMARY KEY, college_id uuid, status text, eligibility_revision bigint
    );
    CREATE TABLE teaching_assignments (
      id uuid PRIMARY KEY, college_id uuid, instructor_id uuid,
      delivery_group_id uuid, is_active boolean, assigned_component_hours numeric
    );
    CREATE TABLE schedule_sessions (
      id uuid PRIMARY KEY, college_id uuid, schedule_version_id uuid,
      teaching_assignment_id uuid, instructor_id uuid,
      replaced_by_split boolean DEFAULT false, day_of_week integer,
      start_time time, end_time time, room_id uuid
    );
    CREATE TABLE effective_membership (version_id uuid, assignment_id uuid);
    CREATE FUNCTION version_effective_assignments(p_version uuid)
    RETURNS TABLE (assignment_id uuid, delivery_group_id uuid, college_id uuid, assigned_component_hours numeric)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT a.id, a.delivery_group_id, a.college_id, a.assigned_component_hours
      FROM teaching_assignments a JOIN effective_membership e ON e.assignment_id=a.id
      WHERE e.version_id=p_version AND a.is_active
    $$;
    CREATE TABLE quality_inputs (coverage_complete boolean);
    INSERT INTO quality_inputs VALUES (true);
    CREATE FUNCTION schedule_version_delivery_coverage(uuid,uuid)
    RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT jsonb_build_object('complete', coverage_complete) FROM quality_inputs
    $$;
    CREATE FUNCTION can_manage_college(p_actor uuid,p_college uuid)
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT p_actor='${actor}'::uuid AND p_college='${college}'::uuid
    $$;
    CREATE TABLE schedule_quality_runs (
      id uuid PRIMARY KEY, college_id uuid, schedule_version_id uuid,
      total_score numeric, hard_conflicts_count integer, eligibility_revision bigint,
      created_at timestamptz DEFAULT now()
    );
    CREATE TABLE schedule_version_events (
      college_id uuid, schedule_version_id uuid, event_type text,
      from_status text, to_status text, performed_by uuid, notes text, metadata jsonb
    );
    INSERT INTO schedule_versions VALUES
      ('${version}','${college}','draft',829),
      ('${historicalVersion}','${college}','published',829);
    INSERT INTO teaching_assignments VALUES
      ('${assignment}','${college}','${lecturer}','${group}',true,3),
      ('${id(22)}','${college}','${id(23)}','${group}',false,3);
    INSERT INTO effective_membership VALUES ('${version}','${assignment}');
    INSERT INTO schedule_sessions VALUES
      ('${session}','${college}','${version}','${assignment}','${lecturer}',false,0,'08:00','11:00','${id(8)}'),
      ('${historicalSession}','${college}','${historicalVersion}','${id(22)}','${id(23)}',false,0,'08:00','11:00','${id(8)}');
    INSERT INTO schedule_quality_runs VALUES ('${id(9)}','${college}','${version}',100,0,829,now());
    ALTER TABLE schedule_sessions ENABLE ROW LEVEL SECURITY;
    CREATE POLICY read_history ON schedule_sessions FOR SELECT TO authenticated USING (true);
    GRANT USAGE ON SCHEMA public,auth TO authenticated;
    GRANT SELECT ON schedule_sessions,schedule_versions,schedule_version_events TO authenticated;
  `);
  await db.exec(lifecycle);
  if (install) await db.exec(migration);
  await db.exec(`SET test.uid='${actor}'; SET ROLE authenticated`);
  return db;
}

async function ownerExec(db, sql) {
  await db.exec("RESET ROLE");
  try {
    await db.exec(sql);
  } finally {
    await db.exec("SET ROLE authenticated");
  }
}
const transition = (db, from, to, selectedVersion = version, selectedCollege = college) =>
  db.query("SELECT transition_schedule_version($1,$2,$3,$4,'test') result", [
    selectedCollege,
    selectedVersion,
    from,
    to,
  ]);
const status = async (db, selectedVersion = version) =>
  (await db.query("SELECT status FROM schedule_versions WHERE id=$1", [selectedVersion])).rows[0]
    .status;
const events = async (db) =>
  Number((await db.query("SELECT count(*) n FROM schedule_version_events")).rows[0].n);

test("zero hard conflicts and complete coverage cannot release stale links at any forward stage", async () => {
  const db = await fixture({ install: false });
  try {
    await ownerExec(
      db,
      `
      UPDATE teaching_assignments SET is_active=false WHERE id='${assignment}';
      INSERT INTO teaching_assignments VALUES ('${id(10)}','${college}','${id(11)}','${group}',true,3);
      INSERT INTO effective_membership VALUES ('${version}','${id(10)}');
    `,
    );
    // Reproduce the prior false pass using the actual unpatched lifecycle RPC.
    await transition(db, "draft", "review");
    assert.equal(await status(db), "review");
    await ownerExec(db, "UPDATE schedule_versions SET status='draft' WHERE id='" + version + "'");
    await ownerExec(db, migration);
    const priorEvents = await events(db);
    for (const [from, to] of [
      ["draft", "review"],
      ["review", "approved"],
      ["approved", "published"],
    ]) {
      await ownerExec(db, `UPDATE schedule_versions SET status='${from}' WHERE id='${version}'`);
      await assert.rejects(
        () => transition(db, from, to),
        (error) => {
          assert.match(error.message, /PUBLISH_BLOCKER:SCHEDULE_SESSION_ASSIGNMENT_INTEGRITY/);
          const detail = JSON.parse(error.detail);
          assert.equal(detail.schedule_version_id, version);
          assert.deepEqual(
            detail.invalid_sessions.map((s) => [s.session_id, s.reason]),
            [[session, "inactive_assignment"]],
          );
          assert.match(error.hint, /مسودة/);
          return true;
        },
      );
      assert.equal(await status(db), from);
      assert.equal(await events(db), priorEvents);
    }
  } finally {
    await db.close();
  }
});

test("missing, wrong lecturer and non-effective assignment links are rejected with session IDs", async () => {
  const db = await fixture();
  try {
    for (const [setup, reason] of [
      [
        `UPDATE schedule_sessions SET teaching_assignment_id='${id(999)}' WHERE id='${session}'`,
        "missing_assignment",
      ],
      [
        `UPDATE schedule_sessions SET teaching_assignment_id='${assignment}',instructor_id='${id(999)}' WHERE id='${session}'`,
        "assignment_instructor_mismatch",
      ],
      [
        `UPDATE schedule_sessions SET instructor_id='${lecturer}' WHERE id='${session}'; DELETE FROM effective_membership`,
        "assignment_not_effective_in_version",
      ],
    ]) {
      await ownerExec(db, setup);
      await assert.rejects(
        () => transition(db, "draft", "review"),
        (error) => {
          assert.equal(JSON.parse(error.detail).invalid_sessions[0].session_id, session);
          assert.equal(JSON.parse(error.detail).invalid_sessions[0].reason, reason);
          return true;
        },
      );
      assert.equal(await status(db), "draft");
    }
    assert.equal(await events(db), 0);
  } finally {
    await db.close();
  }
});

test("effective assignment identity adds no college ownership policy or version management permission", async () => {
  const db = await fixture();
  try {
    // The existing assignment/session and coverage policies decide whether this
    // home-college row is accepted. The new guard checks its exact
    // effective identity and lecturer, without inventing a local ownership rule.
    await ownerExec(
      db,
      `UPDATE teaching_assignments SET college_id='${id(40)}' WHERE id='${assignment}'`,
    );
    await transition(db, "draft", "review");
    assert.equal(await status(db), "review");
    await assert.rejects(
      () => transition(db, "review", "approved", version, id(40)),
      /SCHEDULE_VERSION_NOT_FOUND/,
    );
    await db.exec(`SET test.uid='${id(99)}'`);
    await assert.rejects(
      () => transition(db, "review", "approved"),
      /SCHEDULE_VERSION_TRANSITION_FORBIDDEN/,
    );
    assert.equal(await status(db), "review");
  } finally {
    await db.close();
  }
});

test("valid version releases through the existing authenticated workflow and preserves historical sessions", async () => {
  const db = await fixture();
  try {
    const historyBefore = (
      await db.query("SELECT * FROM schedule_sessions WHERE id=$1", [historicalSession])
    ).rows;
    await transition(db, "draft", "review");
    await transition(db, "review", "approved");
    await transition(db, "approved", "published");
    assert.equal(await status(db), "published");
    assert.equal(await events(db), 3);
    assert.equal(await status(db, historicalVersion), "published");
    assert.deepEqual(
      (await db.query("SELECT * FROM schedule_sessions WHERE id=$1", [historicalSession])).rows,
      historyBefore,
    );
    assert.equal(
      (await db.query("SELECT bool_and(performed_by=$1) ok FROM schedule_version_events", [actor]))
        .rows[0].ok,
      true,
    );
    await assert.rejects(
      () => db.exec("UPDATE schedule_sessions SET instructor_id=NULL"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("legacy null assignment source sessions, active legacy assignments and retired split rows retain existing semantics", async () => {
  const db = await fixture();
  try {
    await ownerExec(
      db,
      `
      UPDATE teaching_assignments SET delivery_group_id=NULL WHERE id='${assignment}';
      INSERT INTO schedule_sessions VALUES
        ('${id(30)}','${college}','${version}',NULL,'${lecturer}',false,1,'08:00','11:00','${id(8)}'),
        ('${id(31)}','${college}','${version}','${id(999)}','${lecturer}',true,2,'08:00','11:00','${id(8)}');
    `,
    );
    await transition(db, "draft", "review");
    assert.equal(await status(db), "review");
    // Null assignments remain subject to the existing source/coverage gate.
    await ownerExec(db, `UPDATE quality_inputs SET coverage_complete=false`);
    await assert.rejects(
      () => transition(db, "review", "approved"),
      /INCOMPLETE_DELIVERY_COVERAGE/,
    );
  } finally {
    await db.close();
  }
});

test("authentication, college permission, status CAS and private helper privileges remain enforced", async () => {
  const db = await fixture();
  try {
    await db.exec("SET test.uid=''");
    await assert.rejects(() => transition(db, "draft", "review"), /AUTHENTICATION_REQUIRED/);
    await db.exec(`SET test.uid='${id(99)}'`);
    await assert.rejects(
      () => transition(db, "draft", "review"),
      /SCHEDULE_VERSION_TRANSITION_FORBIDDEN/,
    );
    await db.exec(`SET test.uid='${actor}'`);
    await assert.rejects(() => transition(db, "review", "approved"), /STALE_VERSION_STATUS/);
    await assert.rejects(
      () => transition(db, "draft", "published"),
      /INVALID_SCHEDULE_VERSION_TRANSITION/,
    );
    for (const role of ["authenticated", "anon", "service_role"]) {
      await db.exec(`RESET ROLE; SET ROLE ${role}`);
      await assert.rejects(
        () =>
          db.query("SELECT public._assert_schedule_version_assignment_integrity($1,$2)", [
            college,
            version,
          ]),
        /permission denied/,
      );
    }
    await db.exec("RESET ROLE; SET ROLE authenticated");
    assert.equal(await status(db), "draft");
    assert.equal(await events(db), 0);
  } finally {
    await db.close();
  }
});

test("review rollback and historical archival stay available when links need repair", async () => {
  const db = await fixture();
  try {
    await ownerExec(
      db,
      `UPDATE teaching_assignments SET is_active=false WHERE id='${assignment}'; UPDATE schedule_versions SET status='review' WHERE id='${version}'`,
    );
    await transition(db, "review", "draft");
    assert.equal(await status(db), "draft");
    await ownerExec(db, `UPDATE schedule_versions SET status='approved' WHERE id='${version}'`);
    await transition(db, "approved", "review");
    await transition(db, "review", "draft");
    assert.equal(await status(db), "draft");
    await transition(db, "published", "archived", historicalVersion);
    assert.equal(await status(db, historicalVersion), "archived");
    assert.equal(
      (
        await db.query("SELECT teaching_assignment_id FROM schedule_sessions WHERE id=$1", [
          historicalSession,
        ])
      ).rows[0].teaching_assignment_id,
      id(22),
    );
  } finally {
    await db.close();
  }
});

test("coverage, quality freshness and hard-conflict gates continue to block valid links", async () => {
  const db = await fixture();
  try {
    for (const [setup, code] of [
      ["UPDATE quality_inputs SET coverage_complete=false", "INCOMPLETE_DELIVERY_COVERAGE"],
      [
        "UPDATE quality_inputs SET coverage_complete=true; UPDATE schedule_quality_runs SET eligibility_revision=828",
        "QUALITY_RUN_STALE",
      ],
      [
        "UPDATE schedule_quality_runs SET eligibility_revision=829,hard_conflicts_count=1",
        "UNAPPROVED_HARD_CONFLICTS",
      ],
      ["DELETE FROM schedule_quality_runs", "QUALITY_RUN_REQUIRED"],
    ]) {
      await ownerExec(db, setup);
      await assert.rejects(() => transition(db, "draft", "review"), new RegExp(code));
      assert.equal(await status(db), "draft");
    }
    assert.equal(await events(db), 0);
  } finally {
    await db.close();
  }
});

test("migration aborts atomically when the live lifecycle patch marker drifts", async () => {
  const db = await fixture({ install: false });
  try {
    await db.exec("RESET ROLE");
    await db.exec(
      lifecycle.replace(
        "IF p_target_status IN ('review', 'approved', 'published') THEN",
        "IF p_target_status = ANY(ARRAY['review', 'approved', 'published']) THEN",
      ),
    );
    await assert.rejects(() => db.exec(migration), /SCHEDULE_ASSIGNMENT_INTEGRITY_LIFECYCLE_DRIFT/);
    await db.exec("ROLLBACK");
    assert.equal(
      (
        await db.query(
          "SELECT to_regprocedure('public._assert_schedule_version_assignment_integrity(uuid,uuid)') helper",
        )
      ).rows[0].helper,
      null,
    );
  } finally {
    await db.close();
  }
});

test("apply and exact rollback restore the observed lifecycle definition and ACL", async () => {
  const db = await fixture({ install: false });
  try {
    await db.exec("RESET ROLE");
    const definitionAndAcl = () =>
      db.query(`
      SELECT pg_get_functiondef(oid) definition, proacl::text acl
      FROM pg_proc WHERE oid='public.transition_schedule_version(uuid,uuid,text,text,text)'::regprocedure
    `);
    const before = (await definitionAndAcl()).rows;
    await db.exec(migration);
    assert.notEqual((await definitionAndAcl()).rows[0].definition, before[0].definition);
    assert.equal((await definitionAndAcl()).rows[0].acl, before[0].acl);
    await db.exec(rollback);
    assert.deepEqual((await definitionAndAcl()).rows, before);
    assert.equal(
      (
        await db.query(
          "SELECT to_regprocedure('public._assert_schedule_version_assignment_integrity(uuid,uuid)') helper",
        )
      ).rows[0].helper,
      null,
    );
    await db.exec("SET ROLE authenticated");
    await transition(db, "draft", "review");
    assert.equal(await status(db), "review");
  } finally {
    await db.close();
  }
});

test("rollback drift fails atomically without removing the helper or rewriting live checks", async () => {
  const db = await fixture();
  try {
    await db.exec("RESET ROLE");
    const before = (
      await db.query(
        "SELECT pg_get_functiondef('public.transition_schedule_version(uuid,uuid,text,text,text)'::regprocedure) definition",
      )
    ).rows[0].definition;
    // A later change to the injected call needs explicit review, not a guessed
    // replacement or a saved full-function definition overwriting newer work.
    const drifted = before.replace(
      "PERFORM public._assert_schedule_version_assignment_integrity(p_college_id, p_schedule_version_id);",
      "PERFORM public._assert_schedule_version_assignment_integrity(p_college_id, p_schedule_version_id); -- reviewed later",
    );
    await db.exec(drifted);
    await assert.rejects(() => db.exec(rollback), /SCHEDULE_ASSIGNMENT_INTEGRITY_ROLLBACK_DRIFT/);
    await db.exec("ROLLBACK");
    assert.equal(
      (
        await db.query(
          "SELECT pg_get_functiondef('public.transition_schedule_version(uuid,uuid,text,text,text)'::regprocedure) definition",
        )
      ).rows[0].definition,
      drifted,
    );
    assert.notEqual(
      (
        await db.query(
          "SELECT to_regprocedure('public._assert_schedule_version_assignment_integrity(uuid,uuid)') helper",
        )
      ).rows[0].helper,
      null,
    );
    await db.exec("SET ROLE authenticated");
    await ownerExec(db, `UPDATE teaching_assignments SET is_active=false WHERE id='${assignment}'`);
    await assert.rejects(
      () => transition(db, "draft", "review"),
      /SCHEDULE_SESSION_ASSIGNMENT_INTEGRITY/,
    );
  } finally {
    await db.close();
  }
});

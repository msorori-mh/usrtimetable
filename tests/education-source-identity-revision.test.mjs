import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.CLONE_DB_MODULE || "@electric-sql/pglite");
const sql = await readFile(
  new URL(
    "../supabase/migrations/20260928120000_education_source_identity_revision.sql",
    import.meta.url,
  ),
  "utf8",
);
const policySql = await readFile(
  new URL(
    "../supabase/migrations/20260928120500_education_source_revision_policy.sql",
    import.meta.url,
  ),
  "utf8",
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const college = "1ee291b2-bec9-43d3-b42b-5a4f46946399";
const term = "93705393-609d-4605-ae94-9572cd8b2090";
const source = "7430bad7-2de7-5c90-9368-b214a199d6c3";
const tableNames = [
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
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    -- Mock authentication exists only in this isolated in-memory test database.
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
    CREATE FUNCTION public.is_super_admin(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u='${id(1)}'::uuid $$;
    CREATE TABLE public.schedule_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),college_id uuid,academic_term_id uuid,name text,status text,notes text,created_by uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),is_coordination boolean DEFAULT false,disposable_test boolean DEFAULT false,eligibility_revision bigint DEFAULT 0);
    CREATE TABLE public.instructors(id uuid PRIMARY KEY,college_id uuid,affiliation_college_id uuid,full_name text,is_active boolean DEFAULT true,external_source text);
    CREATE TABLE public.schedule_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),college_id uuid,schedule_version_id uuid REFERENCES schedule_versions,course_offering_id uuid,teaching_assignment_id uuid,instructor_id uuid REFERENCES instructors,room_id uuid,delivery_group_id uuid,cohort_id uuid,plan_course_component_id uuid,day_of_week smallint,start_time time,end_time time,session_type text DEFAULT 'lecture',study_system text DEFAULT 'regular',expected_students integer,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),is_locked boolean DEFAULT false,source_type text DEFAULT 'manual',replaced_by_split boolean DEFAULT false,split_source_session_id uuid);
    CREATE TABLE public.existing_schedule_source_rows(id uuid PRIMARY KEY,schedule_version_id uuid REFERENCES schedule_versions,schedule_session_id uuid REFERENCES schedule_sessions,college_id uuid,term_id uuid,delivery_group_id uuid,status text,instructor_ids uuid[],notes text,raw_teacher text,raw_course text);
    CREATE TABLE public.schedule_version_conflict_exceptions(schedule_version_id uuid,status text);
    CREATE TABLE public.schedule_version_events(college_id uuid,schedule_version_id uuid,event_type text,from_status text,to_status text,performed_by uuid,notes text,metadata jsonb);
    CREATE SCHEMA schedule_version_delivery_private;
    CREATE TABLE schedule_version_delivery_private.clone_provenance(version_id uuid PRIMARY KEY,source_version_id uuid);
    ${tableNames.map((name) => `CREATE TABLE schedule_version_delivery_private.${name}(version_id uuid,payload jsonb);`).join("\n")}
    INSERT INTO schedule_versions(id,college_id,academic_term_id,name,status) VALUES('${source}','${college}','${term}','Source','draft');
    INSERT INTO instructors(id,college_id,affiliation_college_id,full_name) VALUES('${id(2)}','${id(90)}','${id(90)}','Wrong Person'),('${id(3)}','${college}','${college}','Correct Person');
    INSERT INTO schedule_sessions(id,college_id,schedule_version_id,course_offering_id,instructor_id,room_id,delivery_group_id,cohort_id,plan_course_component_id,day_of_week,start_time,end_time,expected_students)
      SELECT ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,'${college}','${source}','${id(10)}','${id(2)}','${id(11)}',gen_random_uuid(),'${id(12)}','${id(13)}',6,'12:00','14:00',40 FROM generate_series(1,339) n;
    INSERT INTO existing_schedule_source_rows
      SELECT gen_random_uuid(),'${source}',id,'${college}','${term}',delivery_group_id,'imported',ARRAY[instructor_id],'original note','source name','course' FROM schedule_sessions ORDER BY id LIMIT 309;
    INSERT INTO existing_schedule_source_rows
      SELECT gen_random_uuid(),'${source}',NULL,'${college}','${term}',NULL,'pending',ARRAY[]::uuid[],'pending note','unresolved name','pending course' FROM generate_series(1,68);
    INSERT INTO schedule_version_delivery_private.cohort_facts VALUES('${source}','{"headcount":40}');
    UPDATE schedule_versions SET status='published' WHERE id='${source}';
    CREATE FUNCTION immutable_sessions() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP IN ('UPDATE','DELETE') AND EXISTS(SELECT 1 FROM schedule_versions WHERE id=OLD.schedule_version_id AND status IN ('published','archived')) THEN RAISE EXCEPTION 'PUBLISHED_IMMUTABLE'; END IF;
      IF TG_OP IN ('INSERT','UPDATE') AND EXISTS(SELECT 1 FROM schedule_versions WHERE id=NEW.schedule_version_id AND status IN ('published','archived')) THEN RAISE EXCEPTION 'PUBLISHED_IMMUTABLE'; END IF;
      RETURN COALESCE(NEW,OLD);
    END $$;
    CREATE TRIGGER immutable BEFORE INSERT OR UPDATE OR DELETE ON schedule_sessions FOR EACH ROW EXECUTE FUNCTION immutable_sessions();
    CREATE FUNCTION transition_schedule_version(p_college_id uuid,p_schedule_version_id uuid,p_expected_status text,p_target_status text,p_notes text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN
      IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
      UPDATE schedule_versions SET status=p_target_status WHERE id=p_schedule_version_id AND college_id=p_college_id AND status=p_expected_status;
      IF NOT FOUND THEN RAISE EXCEPTION 'STALE_VERSION_STATUS'; END IF;
      RETURN jsonb_build_object('status',p_target_status);
    END $$;
  `);
  await db.exec(sql);
  return db;
}

async function baseline(db) {
  return (
    await db.query(`SELECT
    (SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM schedule_sessions s WHERE schedule_version_id='${source}') sh,
    (SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM existing_schedule_source_rows s WHERE schedule_version_id='${source}') lh`)
  ).rows[0];
}
async function clone(db, overrides = {}) {
  const hashes = await baseline(db);
  return (
    await db.query(
      "SELECT education_source_revision_private.create_revision($1,$2,$3,$4,$5,$6,$7) r",
      [
        source,
        id(1001),
        id(3),
        overrides.sh ?? hashes.sh,
        overrides.lh ?? hashes.lh,
        "Identity correction",
        "Explicit user identity confirmation",
      ],
    )
  ).rows[0].r;
}
async function authenticate(db) {
  await db.query("SELECT set_config('test.actor',$1,false)", [id(1)]);
}

test("copies every session and source fact, changes one identity, preserves published history", async () => {
  const db = await fixture();
  const before = await baseline(db);
  const result = await clone(db);
  assert.equal(result.sessions_copied, 339);
  assert.deepEqual(await baseline(db), before);
  assert.equal(
    (await db.query("SELECT education_source_revision_verified($1) ok", [result.version_id]))
      .rows[0].ok,
    true,
  );
  const counts = (
    await db.query(
      `SELECT count(*)::int n, count(*) FILTER(WHERE expected->>'instructor_id'<>original->>'instructor_id')::int changed,
    bool_and(expected-ARRAY['id','schedule_version_id','instructor_id','created_at','updated_at']=original-ARRAY['id','schedule_version_id','instructor_id','created_at','updated_at']) unchanged
    FROM education_source_revision_private.sessions WHERE version_id=$1`,
      [result.version_id],
    )
  ).rows[0];
  assert.deepEqual(counts, { n: 339, changed: 1, unchanged: true });
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM schedule_version_delivery_private.cohort_facts WHERE version_id=$1 AND payload='{" +
          '"headcount":40' +
          "}'",
        [result.version_id],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    db.query(`UPDATE schedule_sessions SET instructor_id='${id(3)}' WHERE id='${id(1001)}'`),
    /PUBLISHED_IMMUTABLE/,
  );
  await db.close();
});

test("sealed copies reject time, room, load, identity, delete and extra-session changes", async () => {
  const db = await fixture();
  const { version_id: version } = await clone(db);
  for (const mutation of [
    "start_time='11:00'",
    "room_id=gen_random_uuid()",
    "expected_students=41",
    `instructor_id='${id(2)}'`,
    "course_offering_id=gen_random_uuid()",
  ])
    await assert.rejects(
      db.query(
        `UPDATE schedule_sessions SET ${mutation} WHERE schedule_version_id=$1 AND instructor_id='${id(3)}'`,
        [version],
      ),
      /SOURCE_IDENTITY_REVISION_SEALED/,
    );
  await assert.rejects(
    db.query("DELETE FROM schedule_sessions WHERE schedule_version_id=$1", [version]),
    /SOURCE_IDENTITY_REVISION_SEALED/,
  );
  await assert.rejects(
    db.query(
      "INSERT INTO schedule_sessions SELECT (jsonb_populate_record(NULL::schedule_sessions,to_jsonb(s)||jsonb_build_object('id',gen_random_uuid()))).* FROM schedule_sessions s WHERE schedule_version_id=$1 LIMIT 1",
      [version],
    ),
    /SOURCE_IDENTITY_REVISION_SEALED/,
  );
  assert.equal(
    (await db.query("SELECT education_source_revision_verified($1) ok", [version])).rows[0].ok,
    true,
  );
  await db.close();
});

test("untrusted callers cannot write provenance or create revisions", async () => {
  const db = await fixture();
  await db.exec("SET ROLE authenticated");
  await assert.rejects(
    db.query("SELECT * FROM education_source_revision_private.revisions"),
    /permission denied/,
  );
  await assert.rejects(clone(db), /permission denied/);
  await db.exec("RESET ROLE");
  assert.equal((await db.query("SELECT count(*)::int n FROM schedule_versions")).rows[0].n, 1);
  await db.close();
});

test("stale snapshots and wrong affiliation fail without partial drafts", async () => {
  const db = await fixture();
  await assert.rejects(clone(db, { sh: "stale" }), /SESSION_DRIFT/);
  await assert.rejects(clone(db, { lh: "stale" }), /LEDGER_DRIFT/);
  await db.exec(`UPDATE instructors SET affiliation_college_id='${id(90)}' WHERE id='${id(3)}'`);
  await assert.rejects(clone(db), /IDENTITY_MISMATCH/);
  assert.equal((await db.query("SELECT count(*)::int n FROM schedule_versions")).rows[0].n, 1);
  await db.close();
});

test("publication atomically archives source, maps all source rows and keeps every historical session", async () => {
  const db = await fixture();
  const before = await baseline(db);
  const { version_id: version } = await clone(db);
  await authenticate(db);
  await db.query("UPDATE schedule_versions SET status='approved' WHERE id=$1", [version]);
  await db.query("SELECT transition_schedule_version($1,$2,'approved','published')", [
    college,
    version,
  ]);
  assert.equal(
    (await db.query("SELECT status FROM schedule_versions WHERE id=$1", [source])).rows[0].status,
    "archived",
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM existing_schedule_source_rows WHERE schedule_version_id=$1",
        [version],
      )
    ).rows[0].n,
    377,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM existing_schedule_source_rows WHERE schedule_version_id=$1 AND instructor_ids=ARRAY[$2::uuid]",
        [version, id(3)],
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await baseline(db)).sh, before.sh);
  assert.equal(
    (await db.query("SELECT education_source_revision_verified($1) ok", [version])).rows[0].ok,
    true,
  );
  await db.close();
});

test("unauthenticated publication and concurrent ledger edits leave old publication intact", async () => {
  const db = await fixture();
  const { version_id: version } = await clone(db);
  await db.query("UPDATE schedule_versions SET status='approved' WHERE id=$1", [version]);
  await assert.rejects(
    db.query("UPDATE schedule_versions SET status='published' WHERE id=$1", [version]),
    /SUPER_ADMIN_REQUIRED/,
  );
  await authenticate(db);
  await db.exec(
    "UPDATE existing_schedule_source_rows SET notes='concurrent change' WHERE id=(SELECT id FROM existing_schedule_source_rows LIMIT 1)",
  );
  await assert.rejects(
    db.query("SELECT transition_schedule_version($1,$2,'approved','published')", [
      college,
      version,
    ]),
    /LEDGER_DRIFT/,
  );
  assert.equal(
    (await db.query("SELECT status FROM schedule_versions WHERE id=$1", [source])).rows[0].status,
    "published",
  );
  assert.equal(
    (await db.query("SELECT status FROM schedule_versions WHERE id=$1", [version])).rows[0].status,
    "approved",
  );
  await db.close();
});

test("failure during source rebind rolls back both archive and new publication", async () => {
  const db = await fixture();
  const before = await baseline(db);
  const { version_id: version } = await clone(db);
  await authenticate(db);
  await db.query("UPDATE schedule_versions SET status='approved' WHERE id=$1", [version]);
  await db.exec(
    "CREATE FUNCTION reject_rebind() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_REBIND_FAILURE'; END $$; CREATE TRIGGER reject_rebind BEFORE UPDATE ON existing_schedule_source_rows FOR EACH ROW EXECUTE FUNCTION reject_rebind()",
  );
  await assert.rejects(
    db.query("SELECT transition_schedule_version($1,$2,'approved','published')", [
      college,
      version,
    ]),
    /TEST_REBIND_FAILURE/,
  );
  assert.deepEqual(await baseline(db), before);
  assert.equal(
    (await db.query("SELECT status FROM schedule_versions WHERE id=$1", [source])).rows[0].status,
    "published",
  );
  assert.equal(
    (await db.query("SELECT status FROM schedule_versions WHERE id=$1", [version])).rows[0].status,
    "approved",
  );
  await db.close();
});

test("real source policies accept exact inherited sessions, retain the assignment guard and reject other source copies", async () => {
  const db = await fixture();
  await db.exec(`
    ALTER TABLE existing_schedule_source_rows ADD source_id text, ADD source_file text, ADD cohort_id uuid, ADD component_id uuid, ADD plan_course_id uuid;
    CREATE TABLE academic_terms(id uuid,college_id uuid,academic_year text,term_type text);
    CREATE TABLE delivery_groups(id uuid,cohort_id uuid,component_id uuid,plan_course_id uuid,group_code text,active boolean,is_obsolete boolean);
    CREATE TABLE academic_cohorts(id uuid,college_id uuid,term_id uuid,study_plan_id uuid,study_system text,program_id uuid,level_id uuid,active boolean);
    CREATE TABLE plan_courses(id uuid,study_plan_id uuid);
    CREATE TABLE course_offerings(id uuid,college_id uuid,term_id uuid,plan_course_id uuid,program_id uuid,level_id uuid,study_system text,existing_schedule boolean,is_active boolean);
    CREATE TABLE plan_course_components(id uuid,component_type text,counts_toward_regular_load boolean,weekly_contact_hours numeric,is_timetabled boolean);
    CREATE TABLE teaching_assignments(id uuid,delivery_group_id uuid,college_id uuid,instructor_id uuid,is_active boolean);
    CREATE FUNCTION existing_schedule_intake_enabled(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION delivery_group_derivation_status(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"ok":false}'::jsonb $$;
    CREATE FUNCTION schedule_version_delivery_group_catalog(uuid,uuid[]) RETURNS SETOF delivery_groups LANGUAGE sql AS $$ SELECT * FROM delivery_groups $$;
    CREATE FUNCTION version_effective_assignments(uuid) RETURNS SETOF teaching_assignments LANGUAGE sql AS $$ SELECT * FROM teaching_assignments $$;
    INSERT INTO delivery_groups SELECT delivery_group_id,cohort_id,plan_course_component_id,NULL,'source group',true,false FROM schedule_sessions;
    INSERT INTO instructors VALUES('${id(4)}','${college}','${college}','Provisional source label',true,'EDU26F-NAME:test');
  `);
  for (const match of policySql.matchAll(/EXECUTE \$ddl\$\n([\s\S]*?)\$ddl\$;/g))
    await db.exec(match[1]);
  await db.exec(`CREATE TRIGGER inherited_group BEFORE INSERT OR UPDATE ON schedule_sessions FOR EACH ROW EXECUTE FUNCTION guard_schedule_session_current_delivery_group();
    CREATE TRIGGER inherited_name BEFORE INSERT OR UPDATE ON schedule_sessions FOR EACH ROW EXECUTE FUNCTION education_2026f_provisional_name_guard();
    CREATE TRIGGER assignment_name BEFORE INSERT OR UPDATE ON teaching_assignments FOR EACH ROW EXECUTE FUNCTION education_2026f_provisional_name_guard();`);
  const { version_id: version } = await clone(db);
  for (const name of [
    "education_2026f_source_external_session_allowed",
    "education_2026f_project_session_allowed",
    "education_2026f_four_source_allowed",
  ])
    assert.equal(
      (
        await db.query(
          `SELECT bool_and(${name}(s)) ok FROM schedule_sessions s WHERE schedule_version_id=$1`,
          [version],
        )
      ).rows[0].ok,
      true,
    );
  // The original prohibition on treating an unverified source label as an HR assignment still runs.
  await assert.rejects(
    db.query(
      `INSERT INTO teaching_assignments(id,instructor_id) VALUES(gen_random_uuid(),'${id(4)}')`,
    ),
    /PROVISIONAL_NAME_NOT_HR_ASSIGNMENT/,
  );
  await db.query(
    `INSERT INTO teaching_assignments(id,instructor_id) VALUES(gen_random_uuid(),'${id(3)}')`,
  );
  assert.equal(
    (
      await db.query(
        "SELECT education_2026f_source_external_session_allowed(s) ok FROM schedule_sessions s WHERE id=$1",
        [id(1001)],
      )
    ).rows[0].ok,
    false,
  );
  // No waiver can turn an unrelated catalog/hour inventory into complete coverage.
  assert.equal(
    (await db.query("SELECT schedule_version_delivery_coverage($1,$2) r", [college, version]))
      .rows[0].r.complete,
    false,
  );
  await db.close();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(
  process.env.CLONE_DB_MODULE || "@electric-sql/pglite"
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test("atomic clone: identities, stale links, source preservation, rollback and authorization", async () => {
  const db = new PGlite();
  await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION can_manage_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u='${id(1)}'::uuid AND c='${id(2)}'::uuid $$;
 CREATE FUNCTION is_super_admin(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
 CREATE TABLE schedule_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),college_id uuid,academic_term_id uuid,name text,status text,notes text,created_by uuid,disposable_test boolean);
 CREATE TABLE instructors(id uuid PRIMARY KEY,is_active boolean);
 CREATE TABLE teaching_assignments(id uuid PRIMARY KEY,is_active boolean,instructor_id uuid,course_offering_id uuid,delivery_group_id uuid);
 CREATE TABLE delivery_groups(id uuid PRIMARY KEY,component_id uuid,cohort_id uuid,active boolean,is_obsolete boolean);
 CREATE VIEW operational_delivery_groups AS SELECT * FROM delivery_groups;
 CREATE TABLE plan_course_components(id uuid PRIMARY KEY,component_type text,counts_toward_regular_load boolean);
 CREATE TABLE schedule_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),college_id uuid,schedule_version_id uuid,course_offering_id uuid,teaching_assignment_id uuid,instructor_id uuid,room_id uuid,section_id uuid,section_group_id uuid,section_subgroup_id uuid,cohort_id uuid,delivery_group_id uuid,plan_course_component_id uuid,study_system text,day_of_week int,start_time time,end_time time,session_type text,expected_students int,source_type text,is_locked boolean,lock_reason text,replaced_by_split boolean DEFAULT false);
 CREATE TABLE schedule_version_events(college_id uuid,schedule_version_id uuid,event_type text,from_status text,to_status text,performed_by uuid,notes text,metadata jsonb);
 INSERT INTO schedule_versions VALUES('${id(3)}','${id(2)}','${id(4)}','published source','published',null,null,false);
 INSERT INTO instructors VALUES('${id(5)}',true),('${id(6)}',true);
 INSERT INTO plan_course_components VALUES('${id(7)}','theory',true);
 INSERT INTO delivery_groups VALUES('${id(8)}','${id(7)}','${id(9)}',true,false);
 INSERT INTO teaching_assignments VALUES('${id(10)}',true,'${id(5)}','${id(11)}','${id(8)}'),('${id(12)}',false,'${id(5)}','${id(11)}','${id(8)}'),('${id(13)}',true,'${id(6)}','${id(11)}','${id(8)}');
 INSERT INTO schedule_sessions(id,college_id,schedule_version_id,course_offering_id,teaching_assignment_id,instructor_id,cohort_id,delivery_group_id,plan_course_component_id,day_of_week,start_time,end_time,is_locked,lock_reason)
 SELECT gen_random_uuid(),'${id(2)}','${id(3)}','${id(11)}',a,'${id(5)}','${id(9)}','${id(8)}','${id(7)}',1,'08:00','11:00',true,'manual' FROM unnest(ARRAY['${id(10)}'::uuid,'${id(12)}'::uuid,'${id(13)}'::uuid]) a;
 `);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20260918180000_atomic_current_assignment_clone.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const clone = () =>
    db.query(
      `select clone_schedule_version_current('${id(2)}','${id(3)}','${id(4)}','new') r`,
    );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id(1),
  ]);
  await db.exec("set role authenticated");
  const r = (await clone()).rows[0].r;
  assert.equal(r.source_sessions, 3);
  assert.equal(r.sessions_copied, 1);
  assert.equal(r.sessions_skipped, 2);
  assert.deepEqual(r.skipped_sessions.map((s) => s.reason).sort(), [
    "changed_assignment",
    "inactive_assignment",
  ]);
  await db.exec("reset role");
  const rows = (
    await db.query(
      "select * from schedule_sessions where schedule_version_id=$1",
      [r.version_id],
    )
  ).rows;
  assert.equal(rows[0].delivery_group_id, id(8));
  assert.equal(rows[0].cohort_id, id(9));
  assert.equal(rows[0].plan_course_component_id, id(7));
  assert.equal(rows[0].teaching_assignment_id, id(10));
  assert.equal(rows[0].is_locked, true);
  assert.equal(rows[0].lock_reason, "manual");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from schedule_sessions where schedule_version_id=$1",
        [id(3)],
      )
    ).rows[0].n,
    3,
  );
  assert.equal(
    (
      await db.query("select status from schedule_versions where id=$1", [
        id(3),
      ])
    ).rows[0].status,
    "published",
  );
  assert.equal(
    (await db.query("select metadata from schedule_version_events")).rows[0]
      .metadata.sessions_skipped,
    2,
  );
  const baseline = (
    await db.query("select count(*)::int n from schedule_versions")
  ).rows[0].n;
  await db.exec(
    `CREATE FUNCTION reject_clone_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'GUARD_STAYS_ACTIVE'; END $$; CREATE TRIGGER clone_guard BEFORE INSERT ON schedule_sessions FOR EACH ROW EXECUTE FUNCTION reject_clone_session(); SET ROLE authenticated;`,
  );
  await assert.rejects(clone(), /GUARD_STAYS_ACTIVE/);
  await db.exec("reset role");
  assert.equal(
    (await db.query("select count(*)::int n from schedule_versions")).rows[0].n,
    baseline,
    "failed clone leaves no empty draft",
  );
  await db.exec("set role authenticated");
  await assert.rejects(
    db.query(
      `select clone_schedule_version_current('${id(2)}','${id(3)}','${id(99)}','wrong term')`,
    ),
    /CLONE_TERM_REMAP_REQUIRED/,
  );
  await assert.rejects(
    db.query(
      `select clone_schedule_version_current('${id(2)}','${id(3)}','${id(4)}','test',null,true)`,
    ),
    /DISPOSABLE_CLONE_SUPER_ADMIN_REQUIRED/,
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id(99),
  ]);
  await assert.rejects(clone(), /CLONE_NOT_AUTHORIZED/);
  await db.exec("reset role;set role anon");
  await assert.rejects(clone(), /permission denied/);
  await db.close();
});

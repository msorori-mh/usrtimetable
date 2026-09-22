import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.CLONE_DB_MODULE || "@electric-sql/pglite");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLONE_SQL = await readFile(
  new URL("../supabase/migrations/20260922164024_68608c45-cb46-4f87-9584-adc4c8085177.sql", import.meta.url),
  "utf8",
);

/** Minimal schema + a deferred guard that mirrors the production publish/check guard. */
async function makeDb(exceptionState) {
  const db = new PGlite();
  await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated;
 CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'authenticated'::text $$;
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
 CREATE TABLE schedule_version_conflict_exceptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),college_id uuid,schedule_version_id uuid,conflict_code text,session_id uuid,related_session_id uuid,approval_type text,reason text,source text,status text,approved_by uuid,approved_at timestamptz,metadata jsonb);
 -- external published schedule of another college (never modified)
 CREATE TABLE external_busy(instructor_id uuid,day_of_week int,start_time time,end_time time);
 INSERT INTO external_busy VALUES('${id(5)}',6,'08:00','11:00');
 CREATE FUNCTION guard_cross_college() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
   IF EXISTS(SELECT 1 FROM schedule_sessions s JOIN external_busy b
       ON b.instructor_id=s.instructor_id AND b.day_of_week=s.day_of_week
      AND b.start_time<s.end_time AND s.start_time<b.end_time
     WHERE NOT EXISTS(SELECT 1 FROM schedule_version_conflict_exceptions e
       WHERE e.schedule_version_id=s.schedule_version_id AND e.session_id=s.id
         AND e.status='approved' AND e.approval_type='cross_college_instructor'
         AND e.conflict_code IN ('instructor_conflict','cross_college_instructor_conflict'))) THEN
     RAISE EXCEPTION 'CROSS_COLLEGE_INSTRUCTOR_CONFLICT' USING ERRCODE='23514';
   END IF;
   RETURN NULL;
 END $$;
 CREATE CONSTRAINT TRIGGER guard_sessions AFTER INSERT ON schedule_sessions
   DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_cross_college();
 INSERT INTO schedule_versions VALUES('${id(3)}','${id(2)}','${id(4)}','archived source','archived',null,null,false);
 INSERT INTO instructors VALUES('${id(5)}',true);
 INSERT INTO plan_course_components VALUES('${id(7)}','theory',true);
 INSERT INTO delivery_groups VALUES('${id(8)}','${id(7)}','${id(9)}',true,false);
 INSERT INTO teaching_assignments VALUES('${id(10)}',true,'${id(5)}','${id(11)}','${id(8)}');
 SET CONSTRAINTS ALL IMMEDIATE;
 INSERT INTO schedule_sessions(id,college_id,schedule_version_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,cohort_id,delivery_group_id,plan_course_component_id,day_of_week,start_time,end_time)
 VALUES('${id(20)}','${id(2)}','${id(3)}','${id(11)}','${id(10)}','${id(5)}','${id(30)}','${id(9)}','${id(8)}','${id(7)}',6,'10:00','12:00');
 `);
  if (exceptionState) {
    const meta =
      exceptionState === "expired"
        ? `jsonb_build_object('expires_at',(now()-interval '1 day')::text)`
        : `'{}'::jsonb`;
    const status = exceptionState === "revoked" ? "revoked" : "approved";
    await db.exec(`
 INSERT INTO schedule_version_conflict_exceptions(college_id,schedule_version_id,conflict_code,session_id,approval_type,reason,source,status,approved_by,approved_at,metadata)
 VALUES('${id(2)}','${id(3)}','instructor_conflict','${id(20)}','cross_college_instructor','مطابقة حرفية للمصدر','user_authorized_version_scoped_exception','${status}','${id(1)}',now(),${meta});`);
  }
  await db.exec(CLONE_SQL);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(1)]);
  return db;
}

const clone = (db) =>
  db.query(`select clone_schedule_version_current('${id(2)}','${id(3)}','${id(4)}','clone') r`);

test("approved cross-college exception lets the archived version clone, and is re-scoped", async () => {
  const db = await makeDb("approved");
  const r = (await clone(db)).rows[0].r;
  assert.equal(r.sessions_copied, 1);
  assert.equal(r.exceptions_carried, 1);
  const rows = (
    await db.query(
      "select session_id, status, approval_type, metadata from schedule_version_conflict_exceptions where schedule_version_id=$1",
      [r.version_id],
    )
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "approved");
  assert.equal(rows[0].approval_type, "cross_college_instructor");
  assert.equal(rows[0].metadata.cloned_from_session_id, id(20));
  assert.notEqual(rows[0].session_id, id(20));
  const newSession = (
    await db.query("select id from schedule_sessions where schedule_version_id=$1", [r.version_id])
  ).rows[0].id;
  assert.equal(rows[0].session_id, newSession);
  // source untouched
  assert.equal(
    (
      await db.query("select count(*)::int n from schedule_sessions where schedule_version_id=$1", [
        id(3),
      ])
    ).rows[0].n,
    1,
  );
  await db.close();
});

for (const state of [null, "revoked", "expired"]) {
  test(`clone stays rejected and atomic when the exception is ${state ?? "missing"}`, async () => {
    const db = await makeDb(state);
    await assert.rejects(clone(db), /CROSS_COLLEGE_INSTRUCTOR_CONFLICT/);
    assert.equal(
      (await db.query("select count(*)::int n from schedule_versions")).rows[0].n,
      1,
      "failed clone leaves no partial draft",
    );
    assert.equal(
      (await db.query("select count(*)::int n from schedule_sessions")).rows[0].n,
      1,
      "failed clone copies no sessions",
    );
    assert.equal(
      (await db.query("select count(*)::int n from schedule_version_events")).rows[0].n,
      0,
    );
    await db.close();
  });
}

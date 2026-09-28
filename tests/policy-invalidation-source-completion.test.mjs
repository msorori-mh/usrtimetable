import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { PGlite } = await import(process.env.CLONE_DB_MODULE ?? "@electric-sql/pglite");
const patch = readFileSync(
  "supabase/migrations/20260928193000_policy_invalidation_and_source_completion.sql",
  "utf8",
);
const source = readFileSync(
  "supabase/migrations/20260928120500_education_source_revision_policy.sql",
  "utf8",
);
const coverage = source.match(
  /CREATE OR REPLACE FUNCTION public\.schedule_version_delivery_coverage\([\s\S]+?\$function\$;/,
)[0];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const college = "1ee291b2-bec9-43d3-b42b-5a4f46946399",
  version = id(1),
  term = id(2);
async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE SCHEMA schedule_coordination_private;
 CREATE TABLE schedule_versions(id uuid PRIMARY KEY,college_id uuid,academic_term_id uuid,status text,is_coordination boolean DEFAULT false,eligibility_revision integer DEFAULT 0,updated_at timestamptz DEFAULT now(),name text);
 CREATE FUNCTION schedule_coordination_private.check_version(uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'COORDINATION_CHECK_REACHED'; END $$;
 CREATE FUNCTION schedule_coordination_private.enforce_final_state() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='schedule_sessions' THEN
  PERFORM schedule_coordination_private.check_version(NEW.schedule_version_id);
 ELSIF TG_TABLE_NAME='schedule_versions' THEN
  IF NEW.status='published' THEN PERFORM schedule_coordination_private.check_version(NEW.id); END IF;
 ELSE PERFORM schedule_coordination_private.check_version(NEW.id); END IF;
 RETURN NULL; END $$;
 CREATE TABLE academic_terms(id uuid,college_id uuid,academic_year text,term_type text);
 CREATE TABLE academic_cohorts(id uuid,college_id uuid,term_id uuid,active boolean);
 CREATE TABLE plan_course_components(id uuid,weekly_contact_hours numeric,is_timetabled boolean);
 CREATE TABLE catalog(id uuid,cohort_id uuid,component_id uuid,active boolean,is_obsolete boolean);
 CREATE FUNCTION schedule_version_delivery_group_catalog(uuid,uuid[]) RETURNS SETOF catalog LANGUAGE sql AS $$ SELECT * FROM catalog WHERE cohort_id=ANY($2) $$;
 CREATE TABLE effective(delivery_group_id uuid,college_id uuid);
 CREATE FUNCTION version_effective_assignments(uuid) RETURNS SETOF effective LANGUAGE sql AS $$ SELECT * FROM effective $$;
 CREATE TABLE schedule_sessions(id uuid,college_id uuid,schedule_version_id uuid,delivery_group_id uuid,start_time time,end_time time,replaced_by_split boolean DEFAULT false,teaching_assignment_id uuid,instructor_id uuid,room_id uuid);
 CREATE TABLE existing_schedule_source_rows(schedule_version_id uuid,schedule_session_id uuid,college_id uuid,term_id uuid,delivery_group_id uuid,status text,instructor_ids uuid[]);
 CREATE TABLE seal(ok boolean); INSERT INTO seal VALUES(true);
 CREATE FUNCTION education_source_revision_verified(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT ok FROM seal $$;
 CREATE FUNCTION education_source_revision_named_session(schedule_sessions) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
 INSERT INTO schedule_versions(id,college_id,academic_term_id,status) VALUES('${version}','${college}','${term}','draft');
 INSERT INTO academic_terms VALUES('${term}','${college}','2026-2027','first');
 INSERT INTO academic_cohorts VALUES('${id(3)}','${college}','${term}',true);
 INSERT INTO plan_course_components VALUES('${id(4)}',2,true),('${id(5)}',4,true);
 INSERT INTO catalog SELECT ('00000000-0000-4000-8000-'||lpad((1000+n)::text,12,'0'))::uuid,'${id(3)}',CASE WHEN n<=26 THEN '${id(5)}'::uuid ELSE '${id(4)}'::uuid END,true,false FROM generate_series(1,331)n;
 INSERT INTO effective SELECT id,'${college}' FROM catalog ORDER BY id LIMIT 285;
 INSERT INTO schedule_sessions SELECT gen_random_uuid(),'${college}','${version}',c.id,'08:00',CASE WHEN p.weekly_contact_hours=4 THEN '12:00'::time ELSE '10:00'::time END,false,NULL,'${id(10)}','${id(11)}' FROM catalog c JOIN plan_course_components p ON p.id=c.component_id;
 `);
  await db.exec(coverage);
  await db.exec(patch);
  return db;
}
const result = async (db) =>
  (await db.query("SELECT schedule_version_delivery_coverage($1,$2) c", [college, version])).rows[0]
    .c;
test("eligibility invalidation succeeds; semantic version and session changes still validate", async () => {
  const db = await fixture();
  try {
    await db.exec(
      `UPDATE schedule_versions SET status='published'; CREATE CONSTRAINT TRIGGER coordination_versions_final AFTER INSERT OR UPDATE ON schedule_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION schedule_coordination_private.enforce_final_state(); CREATE CONSTRAINT TRIGGER coordination_sessions_final AFTER UPDATE ON schedule_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION schedule_coordination_private.enforce_final_state();`,
    );
    await db.exec(
      "UPDATE schedule_versions SET eligibility_revision=eligibility_revision+1,updated_at=now()",
    );
    await assert.rejects(
      () => db.exec("UPDATE schedule_versions SET name='changed'"),
      /COORDINATION_CHECK_REACHED/,
    );
    await assert.rejects(
      () => db.exec("UPDATE schedule_versions SET is_coordination=true"),
      /COORDINATION_CHECK_REACHED/,
    );
    await assert.rejects(
      () => db.exec("UPDATE schedule_sessions SET start_time='09:00'"),
      /COORDINATION_CHECK_REACHED/,
    );
  } finally {
    await db.close();
  }
});
test("real assignments can replace verified source exemptions without losing completion", async () => {
  const db = await fixture();
  try {
    assert.equal((await result(db)).complete, true);
    await db.exec(
      `INSERT INTO effective SELECT id,'${college}' FROM catalog WHERE id NOT IN(SELECT delivery_group_id FROM effective) ORDER BY id LIMIT 1`,
    );
    const r = await result(db);
    assert.equal(r.unassigned_groups, 45);
    assert.equal(r.provisional_source_groups, 45);
    assert.equal(r.complete, true);
    await db.exec("UPDATE seal SET ok=false");
    assert.equal((await result(db)).complete, false);
  } finally {
    await db.close();
  }
});
test("additional missing assignments, extra hours and duplicate assignments stay blocked", async () => {
  const db = await fixture();
  try {
    await db.exec(
      "DELETE FROM effective WHERE delivery_group_id=(SELECT min(delivery_group_id::text)::uuid FROM effective)",
    );
    assert.equal((await result(db)).complete, false);
    await db.exec(
      `INSERT INTO effective SELECT id,'${college}' FROM catalog ORDER BY id LIMIT 1; UPDATE schedule_sessions SET end_time='11:00' WHERE delivery_group_id=(SELECT max(id::text)::uuid FROM catalog)`,
    );
    assert.equal((await result(db)).complete, false);
    await db.exec(
      `UPDATE schedule_sessions SET end_time='10:00' WHERE delivery_group_id=(SELECT max(id::text)::uuid FROM catalog); INSERT INTO effective SELECT * FROM effective LIMIT 1`,
    );
    assert.equal((await result(db)).complete, false);
  } finally {
    await db.close();
  }
});

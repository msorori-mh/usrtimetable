import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.CLONE_DB_MODULE || "@electric-sql/pglite");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLONE_SQL = await readFile(
  new URL(
    "../supabase/migrations/20260922164945_030dd2c7-65ba-47a0-8cf4-6e08211791eb.sql",
    import.meta.url,
  ),
  "utf8",
);

const GUARDS = `
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
   -- student (delivery group) overlap: pair-scoped approved exception waives it
   IF EXISTS(SELECT 1 FROM schedule_sessions a JOIN schedule_sessions c
       ON c.schedule_version_id=a.schedule_version_id AND a.id<c.id
      AND a.day_of_week=c.day_of_week AND a.start_time<c.end_time AND c.start_time<a.end_time
      AND a.cohort_id=c.cohort_id
     WHERE NOT EXISTS(SELECT 1 FROM schedule_version_conflict_exceptions e
       WHERE e.schedule_version_id=a.schedule_version_id
         AND e.status='approved' AND e.conflict_code='delivery_group_conflict'
         AND ((e.session_id=a.id AND e.related_session_id=c.id)
           OR (e.session_id=c.id AND e.related_session_id=a.id)))) THEN
     RAISE EXCEPTION 'PUBLISH_BLOCKER:UNAPPROVED_HARD_CONFLICTS' USING ERRCODE='23514';
   END IF;
   RETURN NULL;
 END $$;
 CREATE CONSTRAINT TRIGGER guard_sessions AFTER INSERT ON schedule_sessions
   DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_cross_college();
`;

/** Minimal schema + deferred guards mirroring the production check/publish guards. */
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
 INSERT INTO schedule_versions VALUES('${id(3)}','${id(2)}','${id(4)}','archived source','archived',null,null,false);
 INSERT INTO instructors VALUES('${id(5)}',true),('${id(6)}',true),('${id(16)}',true);
 INSERT INTO plan_course_components VALUES('${id(7)}','theory',true),('${id(17)}','theory',true),('${id(18)}','theory',true);
 INSERT INTO delivery_groups VALUES('${id(8)}','${id(7)}','${id(9)}',true,false),('${id(14)}','${id(17)}','${id(9)}',true,false),('${id(15)}','${id(18)}','${id(9)}',true,false);
 INSERT INTO teaching_assignments VALUES('${id(10)}',true,'${id(5)}','${id(11)}','${id(8)}'),('${id(12)}',true,'${id(6)}','${id(13)}','${id(14)}'),('${id(22)}',true,'${id(16)}','${id(23)}','${id(15)}');
 -- cross-college overlapping session
 INSERT INTO schedule_sessions(id,college_id,schedule_version_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,cohort_id,delivery_group_id,plan_course_component_id,day_of_week,start_time,end_time)
 VALUES('${id(20)}','${id(2)}','${id(3)}','${id(11)}','${id(10)}','${id(5)}','${id(30)}','${id(9)}','${id(8)}','${id(7)}',6,'10:00','12:00');
 -- student-overlap pair inside the same cohort
 INSERT INTO schedule_sessions(id,college_id,schedule_version_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,cohort_id,delivery_group_id,plan_course_component_id,day_of_week,start_time,end_time)
 VALUES('${id(21)}','${id(2)}','${id(3)}','${id(13)}','${id(12)}','${id(6)}','${id(31)}','${id(9)}','${id(14)}','${id(17)}',1,'08:00','10:00'),
        ('${id(24)}','${id(2)}','${id(3)}','${id(23)}','${id(22)}','${id(16)}','${id(32)}','${id(9)}','${id(15)}','${id(18)}',1,'08:00','10:00');
 `);
  if (exceptionState) {
    const meta =
      exceptionState === "expired"
        ? `jsonb_build_object('expires_at',(now()-interval '1 day')::text)`
        : `'{}'::jsonb`;
    const status = exceptionState === "revoked" ? "revoked" : "approved";
    await db.exec(`
 INSERT INTO schedule_version_conflict_exceptions(college_id,schedule_version_id,conflict_code,session_id,related_session_id,approval_type,reason,source,status,approved_by,approved_at,metadata)
 VALUES
 ('${id(2)}','${id(3)}','instructor_conflict','${id(20)}',NULL,'cross_college_instructor','مطابقة حرفية للمصدر','user_authorized_version_scoped_exception','${status}','${id(1)}',now(),${meta}),
 ('${id(2)}','${id(3)}','delivery_group_conflict','${id(21)}','${id(24)}','source_file_literal_match','مطابقة حرفية لملف الجدول المعتمد','user_authorized_version_scoped_exception','${status}','${id(1)}',now(),${meta});`);
  }
  await db.exec(GUARDS);
  await db.exec(CLONE_SQL);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(1)]);
  return db;
}


const FACTS_SQL = await readFile(new URL('../supabase/migrations/20260928080000_clone_version_delivery_facts.sql', import.meta.url),'utf8');
const PROVENANCE_SQL = (await readFile(new URL('../supabase/migrations/20260928080500_clone_fact_provenance.sql',import.meta.url),'utf8')).replaceAll('d68d8d22-9a6d-4f21-935f-cebf18bb969b',id(3));
const factTables = ['scope','cohort_facts','group_facts','partner_group_facts','partition_facts','group_partition_facts','shared_link_facts','partner_partition_facts','component_room_type_facts','instructor_hour_waivers'];
async function withFacts() {
 const db=await makeDb('approved');
 await db.exec(`CREATE SCHEMA schedule_version_delivery_private;
CREATE TABLE schedule_version_delivery_private.scope(cohort_id uuid,college_id uuid,version_id uuid);
CREATE TABLE schedule_version_delivery_private.cohort_facts(cohort_id uuid,college_id uuid,expected_students integer,scheduling_headcount integer,version_id uuid);
CREATE TABLE schedule_version_delivery_private.group_facts(capacity_limit integer,cohort_id uuid,college_id uuid,expected_students integer,group_code text,group_id uuid,version_id uuid);
CREATE TABLE schedule_version_delivery_private.partner_group_facts(capacity_limit integer,college_id uuid,expected_students integer,group_id uuid,version_id uuid);
CREATE TABLE schedule_version_delivery_private.partition_facts(cohort_id uuid,college_id uuid,headcount integer,partition_code text,partition_id uuid,version_id uuid);
CREATE TABLE schedule_version_delivery_private.group_partition_facts(group_id uuid,partition_id uuid,version_id uuid);
CREATE TABLE schedule_version_delivery_private.shared_link_facts(anchor_group_id uuid,college_id uuid,member_group_id uuid,version_id uuid);
CREATE TABLE schedule_version_delivery_private.partner_partition_facts(cohort_id uuid,group_id uuid,headcount integer,partition_id uuid,version_id uuid);
CREATE TABLE schedule_version_delivery_private.component_room_type_facts(component_id uuid,room_type_id uuid,version_id uuid);
CREATE TABLE schedule_version_delivery_private.instructor_hour_waivers(assignment_id uuid,college_id uuid,group_id uuid,instructor_id uuid,reason text,source_assignment_id uuid,term_id uuid,version_id uuid);
 INSERT INTO schedule_version_delivery_private.scope VALUES('${id(9)}','${id(2)}','${id(3)}');
 INSERT INTO schedule_version_delivery_private.cohort_facts(version_id,cohort_id,college_id,expected_students,scheduling_headcount) VALUES('${id(3)}','${id(9)}','${id(2)}',100,100);
 INSERT INTO schedule_version_delivery_private.group_facts(version_id,group_id,cohort_id,college_id,group_code,expected_students,capacity_limit) VALUES('${id(3)}','${id(8)}','${id(9)}','${id(2)}','G1',50,75);
 INSERT INTO schedule_version_delivery_private.partition_facts(version_id,partition_id,cohort_id,college_id,partition_code,headcount) VALUES('${id(3)}','${id(41)}','${id(9)}','${id(2)}','A1',50);
 INSERT INTO schedule_version_delivery_private.group_partition_facts VALUES('${id(8)}','${id(41)}','${id(3)}');
 INSERT INTO schedule_version_delivery_private.partner_group_facts(version_id,group_id,college_id,expected_students,capacity_limit) VALUES('${id(3)}','${id(42)}','${id(2)}',20,75);
 INSERT INTO schedule_version_delivery_private.partner_partition_facts(version_id,group_id,cohort_id,partition_id,headcount) VALUES('${id(3)}','${id(42)}','${id(43)}','${id(44)}',20);
 INSERT INTO schedule_version_delivery_private.shared_link_facts(version_id,anchor_group_id,member_group_id,college_id) VALUES('${id(3)}','${id(8)}','${id(42)}','${id(2)}');
 INSERT INTO schedule_version_delivery_private.component_room_type_facts(version_id,component_id,room_type_id) VALUES('${id(3)}','${id(7)}','${id(45)}');
 INSERT INTO schedule_version_delivery_private.instructor_hour_waivers(version_id,assignment_id,college_id,term_id,instructor_id,group_id,source_assignment_id,reason) VALUES('${id(3)}','${id(10)}','${id(2)}','${id(4)}','${id(5)}','${id(8)}','${id(10)}','approved additional group');
 CREATE FUNCTION require_version_membership() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
  IF NEW.delivery_group_id='${id(8)}' AND NOT EXISTS (
   SELECT 1 FROM schedule_version_delivery_private.group_facts g
   JOIN schedule_version_delivery_private.group_partition_facts m ON m.version_id=g.version_id AND m.group_id=g.group_id
   JOIN schedule_version_delivery_private.partition_facts p ON p.version_id=m.version_id AND p.partition_id=m.partition_id
   WHERE g.version_id=NEW.schedule_version_id AND g.group_id=NEW.delivery_group_id
    AND g.expected_students=50 AND p.headcount=50) THEN
    RAISE EXCEPTION 'STALE_DELIVERY_GROUPS_REGENERATE';
  END IF; RETURN NEW;
 END $$;
 CREATE TRIGGER membership_guard BEFORE INSERT ON schedule_sessions FOR EACH ROW EXECUTE FUNCTION require_version_membership();
 `);
 await db.exec(`ALTER TABLE schedule_version_delivery_private.component_room_type_facts ADD CONSTRAINT component_room_type_facts_version_id_check CHECK(version_id='${id(3)}');
 ALTER TABLE schedule_version_delivery_private.instructor_hour_waivers ADD CONSTRAINT instructor_hour_waivers_version_id_check CHECK(version_id='${id(3)}'), ADD CONSTRAINT instructor_hour_waivers_pkey PRIMARY KEY(assignment_id);`);
 return db;
}
const cloneFacts = db=>db.query(`select clone_schedule_version_current('${id(2)}','${id(3)}','${id(4)}','with facts',null,false,true) r`);
test('clone copies selected-version data before guards and preserves historical source',async()=>{
 const db=await withFacts();
 await assert.rejects(cloneFacts(db),/STALE_DELIVERY_GROUPS_REGENERATE/);
 assert.equal((await db.query('select count(*)::int n from schedule_versions')).rows[0].n,1);
 await db.exec(PROVENANCE_SQL);await db.exec(FACTS_SQL);
 const source=await db.query('select to_jsonb(s) r from schedule_sessions s order by id');
 const r=(await cloneFacts(db)).rows[0].r;
 assert.equal(r.sessions_copied,3);assert.equal(r.exceptions_carried,2);
 for(const table of factTables){
  const rows=(await db.query(`select version_id,to_jsonb(t)-'version_id' data from schedule_version_delivery_private.${table} t order by version_id`)).rows;
  assert.equal(rows.length,2,table);
  assert.deepEqual(rows.find(x=>x.version_id===id(3)).data,rows.find(x=>x.version_id===r.version_id).data,table);
 }
 assert.deepEqual((await db.query(`select to_jsonb(s) r from schedule_sessions s where schedule_version_id='${id(3)}' order by id`)).rows,source.rows);
 await assert.rejects(db.query(`UPDATE schedule_version_delivery_private.instructor_hour_waivers SET reason='unapproved change' WHERE version_id=$1`,[r.version_id]),/INHERITED_APPROVAL_MUST_MATCH_SOURCE/);
 await assert.rejects(db.query(`INSERT INTO schedule_version_delivery_private.component_room_type_facts(version_id,component_id,room_type_id) VALUES('${id(99)}','${id(7)}','${id(45)}')`),/INHERITED_APPROVAL_SOURCE_REQUIRED/);
 await db.exec('set role authenticated');
 await assert.rejects(db.query(`INSERT INTO schedule_version_delivery_private.clone_provenance VALUES('${id(99)}','${id(3)}',now())`),/permission denied/);
 await db.exec('reset role');
 await db.close();
});
test('clone rollback retains guards and no partial facts survive',async()=>{
 const db=await withFacts();await db.exec(PROVENANCE_SQL);await db.exec(FACTS_SQL);
 await db.exec(`CREATE FUNCTION reject_target() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'STILL_GUARDED'; END $$; CREATE TRIGGER reject_target BEFORE INSERT ON schedule_sessions FOR EACH ROW EXECUTE FUNCTION reject_target();`);
 await assert.rejects(cloneFacts(db),/STILL_GUARDED/);
 assert.equal((await db.query('select count(*)::int n from schedule_versions')).rows[0].n,1);
 for(const table of factTables)assert.equal((await db.query(`select count(*)::int n from schedule_version_delivery_private.${table}`)).rows[0].n,1,table);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(99)]);
 await assert.rejects(cloneFacts(db),/CLONE_NOT_AUTHORIZED/);
 await db.close();
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.LEADERSHIP_DB_MODULE || "@electric-sql/pglite");
const migration = await readFile(
  new URL("../supabase/migrations/20261013020000_teaching_coverage_reports.sql", import.meta.url),
  "utf8",
);
const uid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
test("coverage SQL scopes roles, classifies exclusively and preserves canonical workload totals", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE SCHEMA faculty_private; CREATE SCHEMA assignment_version_private;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION public.can_view_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u='${uid(1)}'::uuid OR (u='${uid(2)}'::uuid AND c='${uid(10)}'::uuid) $$;
 CREATE FUNCTION faculty_private.quota_applicability(t text,e text) RETURNS boolean LANGUAGE sql AS $$SELECT CASE WHEN t IN ('permanent','appointed') AND e='contract' THEN NULL WHEN t IN ('permanent','appointed') THEN true WHEN t IN ('con','annual_contract','contract_unspecified') OR e='contract' THEN false ELSE NULL END$$;
 CREATE FUNCTION assignment_version_private.is_counted(i uuid) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
 CREATE FUNCTION assignment_version_private.is_replacement_pair(a uuid,b uuid) RETURNS boolean LANGUAGE sql AS $$SELECT false$$;
 CREATE TABLE colleges(id uuid,university_id uuid);CREATE TABLE academic_terms(id uuid,college_id uuid);
 CREATE TABLE instructors(id uuid,college_id uuid,full_name text,full_name_ar text);
 CREATE TABLE faculty_identity_links(identity_id uuid,instructor_id uuid);
 CREATE TABLE faculty_private.home_profiles(identity_id uuid,university_id uuid,home_college_id uuid,type_code text,employment_type text,full_name text,university_number text,home_college_name text);
 CREATE TABLE course_offerings(id uuid,term_id uuid);
 CREATE TABLE teaching_assignments(id uuid,instructor_id uuid,college_id uuid,course_offering_id uuid,is_active boolean,delivery_group_id uuid,assigned_component_hours numeric);
 CREATE TABLE academic_cohorts(id uuid,college_id uuid,program_id uuid,study_system text);
 CREATE TABLE academic_programs(id uuid,college_id uuid,department_id uuid,name text);
 CREATE TABLE departments(id uuid,college_id uuid,name text);
 CREATE TABLE v_instructor_delivery_workload(college_id uuid,instructor_id uuid,cohort_id uuid,term_id uuid,standard_assigned_hours numeric,project_supervision_hours numeric);
 INSERT INTO colleges VALUES('${uid(10)}','${uid(100)}'),('${uid(11)}','${uid(100)}');
 INSERT INTO academic_terms VALUES('${uid(20)}','${uid(10)}'),('${uid(21)}','${uid(11)}');
 INSERT INTO departments VALUES('${uid(30)}','${uid(10)}','Department');
 INSERT INTO academic_programs VALUES('${uid(40)}','${uid(10)}','${uid(30)}','Program');
 INSERT INTO academic_cohorts VALUES('${uid(50)}','${uid(10)}','${uid(40)}','regular');
 `);
    for (let n = 60; n < 65; n++) {
      await db.exec(`INSERT INTO instructors VALUES('${uid(n)}','${uid(10)}','TEST_ONLY',NULL);
 INSERT INTO faculty_identity_links VALUES('${uid(n + 100)}','${uid(n)}');
 INSERT INTO faculty_private.home_profiles VALUES('${uid(n + 100)}','${uid(100)}',${n === 64 ? "NULL" : `'${uid(n === 61 ? 11 : 10)}'`},'${n === 62 ? "con" : n === 63 ? "unknown" : "permanent"}','${n === 62 ? "contract" : "permanent"}','TEST_ONLY','${n}','College');
 INSERT INTO v_instructor_delivery_workload VALUES('${uid(10)}','${uid(n)}','${uid(50)}','${uid(20)}',3,2);`);
    }
    await db.exec(migration);
    await db.exec(
      `SELECT set_config('request.jwt.claim.sub','${uid(2)}',false); SET ROLE authenticated;`,
    );
    const result = (
      await db.query(`SELECT public.get_teaching_coverage_report('${uid(10)}','${uid(20)}') r`)
    ).rows[0].r;
    assert.equal(result.rows.length, 5);
    assert.equal(
      result.rows.reduce((n, r) => n + r.hours, 0),
      15,
    );
    assert.deepEqual(result.rows.map((r) => r.category).sort(), [
      "contractual",
      "internal",
      "other_college",
      "unknown",
      "unknown",
    ]);
    const directory = (
      await db.query(`SELECT public.get_faculty_reporting_categories('${uid(10)}') r`)
    ).rows[0].r;
    for (const r of result.rows)
      assert.equal(
        directory.rows.find((d) => d.identity_id === r.identity_id).category,
        r.category,
      );
    await assert.rejects(
      db.query(`SELECT public.get_teaching_coverage_report('${uid(11)}','${uid(21)}')`),
      /insufficient_privilege/,
    );
    await assert.rejects(
      db.query(`SELECT public.get_faculty_reporting_categories('${uid(11)}')`),
      /insufficient_privilege/,
    );
    await assert.rejects(
      db.query(`SELECT public.get_teaching_coverage_report('${uid(10)}','${uid(21)}')`),
      /COVERAGE_TERM_SCOPE_MISMATCH/,
    );
    await db.exec(
      `RESET ROLE;SELECT set_config('request.jwt.claim.sub','${uid(1)}',false);SET ROLE authenticated;`,
    );
    assert.equal(
      (await db.query(`SELECT public.get_teaching_coverage_report('${uid(11)}','${uid(21)}') r`))
        .rows[0].r.rows.length,
      0,
    );
    await db.exec(
      `RESET ROLE;SELECT set_config('request.jwt.claim.sub','',false);SET ROLE authenticated;`,
    );
    await assert.rejects(
      db.query(`SELECT public.get_teaching_coverage_report('${uid(10)}','${uid(20)}')`),
      /insufficient_privilege/,
    );
    await db.exec("RESET ROLE;SET ROLE anon;");
    await assert.rejects(
      db.query(`SELECT public.get_teaching_coverage_report('${uid(10)}','${uid(20)}')`),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("All rate selections expand atomically, retain single selections and deny unauthorized roles", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  CREATE FUNCTION public.has_role(u uuid,r text) RETURNS boolean LANGUAGE sql AS $$SELECT (u='${uid(1)}' AND r='super_admin') OR (u='${uid(2)}' AND r='institutional_viewer')$$;
  CREATE FUNCTION public.can_view_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$SELECT c='${uid(10)}'$$;
  CREATE TABLE rates(id uuid default gen_random_uuid(),kind text,system text,effective_from text,UNIQUE(kind,system,effective_from));
  CREATE FUNCTION public.teaching_payroll(c uuid,a text,p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE v uuid;BEGIN
   INSERT INTO rates(kind,system,effective_from) VALUES(p->>'kind',p->>'system',p->>'effective_from') RETURNING id INTO v;
   RETURN jsonb_build_object('id',v,'ok',true);END$$;`);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261013023000_teaching_pay_bulk_rates.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(
      `SELECT set_config('request.jwt.claim.sub','${uid(2)}',false);SET ROLE authenticated;`,
    );
    const call = (p) =>
      db.query(`SELECT public.save_teaching_pay_rates('${uid(10)}',$1::jsonb) r`, [
        JSON.stringify(p),
      ]);
    assert.equal(
      (await call({ kind: "all", system: "all", effective_from: "a" })).rows[0].r.count,
      4,
    );
    assert.equal(
      (await call({ kind: "all", system: "regular", effective_from: "b" })).rows[0].r.count,
      2,
    );
    assert.equal(
      (await call({ kind: "overload", system: "all", effective_from: "c" })).rows[0].r.count,
      2,
    );
    assert.equal(
      (await call({ kind: "contractual", system: "parallel", effective_from: "d" })).rows[0].r
        .count,
      1,
    );
    await assert.rejects(
      call({ kind: "all", system: "all", effective_from: "d" }),
      /لم يُحفظ أي سعر/,
    );
    await assert.rejects(call({ kind: "invented", system: "all" }), /اختر نوع الأجر/);
    await db.exec("RESET ROLE;");
    assert.equal((await db.query("SELECT count(*)::int n FROM rates")).rows[0].n, 9);
    await db.exec(
      `SELECT set_config('request.jwt.claim.sub','${uid(3)}',false);SET ROLE authenticated;`,
    );
    await assert.rejects(call({ kind: "all", system: "all", effective_from: "e" }), /متاحة للشؤون/);
    await db.exec("RESET ROLE;SET ROLE anon;");
    await assert.rejects(
      call({ kind: "all", system: "all", effective_from: "e" }),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

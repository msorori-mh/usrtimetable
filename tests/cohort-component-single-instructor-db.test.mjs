import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { PGlite } = await import(process.env.COHORT_RULE_DB_MODULE || "@electric-sql/pglite");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration = await readFile(
  new URL(
    "../supabase/migrations/20260928020000_cohort_component_single_instructor.sql",
    import.meta.url,
  ),
  "utf8",
);

const emptyCollector = (name, signature) =>
  `CREATE FUNCTION public.${name}(${signature}) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '[]'::jsonb $$;`;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA auth;
    CREATE SCHEMA faculty_private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE public.constraint_types(
      code text PRIMARY KEY, name_ar text, name_en text, constraint_category text,
      is_hard boolean, default_weight integer, description text
    );
    CREATE TABLE public.instructors(id uuid PRIMARY KEY, full_name text NOT NULL);
    CREATE TABLE public.faculty_identity_links(instructor_id uuid PRIMARY KEY, identity_id uuid NOT NULL);
    CREATE TABLE public.plan_course_components(id uuid PRIMARY KEY, component_type text NOT NULL);
    CREATE TABLE public.academic_cohorts(id uuid PRIMARY KEY, code text NOT NULL, term_id uuid NOT NULL);
    CREATE TABLE public.courses(id uuid PRIMARY KEY, code text NOT NULL, name text NOT NULL);
    CREATE TABLE public.plan_courses(id uuid PRIMARY KEY, course_id uuid NOT NULL);
    CREATE TABLE public.delivery_groups(
      id uuid PRIMARY KEY, cohort_id uuid NOT NULL, plan_course_id uuid NOT NULL,
      component_id uuid NOT NULL, college_id uuid NOT NULL,
      active boolean NOT NULL DEFAULT true, is_obsolete boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public.teaching_assignments(
      id uuid PRIMARY KEY, instructor_id uuid NOT NULL, delivery_group_id uuid,
      is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public.schedule_versions(id uuid PRIMARY KEY, academic_term_id uuid, college_id uuid);
    CREATE TABLE public.schedule_version_conflict_exceptions(id uuid PRIMARY KEY, conflict_code text NOT NULL);
    CREATE FUNCTION public.can_view_college(p_user uuid, p_college uuid)
      RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT p_user IS NOT NULL $$;
    CREATE FUNCTION public._ss_ci(text,text,uuid,uuid,jsonb)
      RETURNS jsonb LANGUAGE sql STABLE AS
      $$ SELECT jsonb_build_object('code',$1,'severity',$2,'schedule_session_id',$3,'related_session_id',$4,'details',$5) $$;
    ${emptyCollector("_ss_peer_i", "uuid,uuid,uuid,uuid,integer,time,time")}
    ${emptyCollector("_ss_peer_r", "uuid,uuid,uuid,uuid,integer,time,time")}
    ${emptyCollector("_ss_peer_s", "uuid,uuid,uuid,uuid,integer,time,time")}
    ${emptyCollector("_ss_room_cap", "uuid,uuid,uuid,integer,uuid")}
    ${emptyCollector("_ss_room_type", "uuid,uuid,uuid,uuid")}
    ${emptyCollector("_ss_room_av", "uuid,uuid,uuid,integer,time,time")}
    ${emptyCollector("_ss_iavail_req", "uuid,uuid,uuid,integer")}
    ${emptyCollector("_ss_iavail_win", "uuid,uuid,uuid,integer,time,time")}
    ${emptyCollector("_ss_instructor_daily_hours", "uuid,uuid,uuid,uuid,integer,time,time")}
    ${emptyCollector("_ss_instructor_attendance_days", "uuid,uuid,uuid,uuid,integer")}
    ${emptyCollector("_ss_student_daily_hours", "uuid,uuid,uuid,uuid,uuid,integer,time,time")}
    ${emptyCollector("_ss_student_extended_days", "uuid,uuid,uuid,uuid,uuid,integer,time")}
    ${emptyCollector("_ss_tmpl", "uuid,uuid,text,integer,time,time")}
    ${emptyCollector("_ss_set", "uuid,uuid,integer,time,time")}
    ${emptyCollector("_ss_brk", "uuid,uuid,integer,time,time")}
    ${emptyCollector("_ss_itcs_theory_hours", "uuid,uuid,uuid,time")}

    INSERT INTO instructors VALUES
      ('${id(100)}','المحاضر أ'),('${id(101)}','اسم محلي للمحاضر أ'),
      ('${id(102)}','المحاضر ب'),('${id(103)}','هوية غير مكتملة');
    INSERT INTO faculty_identity_links VALUES
      ('${id(100)}','${id(1000)}'),('${id(101)}','${id(1000)}'),('${id(102)}','${id(1001)}');
    INSERT INTO courses VALUES ('${id(20)}','CS201','هياكل البيانات');
    INSERT INTO plan_courses VALUES ('${id(30)}','${id(20)}');
    INSERT INTO plan_course_components VALUES
      ('${id(40)}','theory'),('${id(41)}','practical'),('${id(42)}','tutorial');
    INSERT INTO academic_cohorts VALUES
      ('${id(50)}','IT-L2','${id(60)}'),('${id(51)}','LEGACY','${id(60)}');
    INSERT INTO delivery_groups VALUES
      ('${id(200)}','${id(51)}','${id(30)}','${id(40)}','${id(10)}',true,false),
      ('${id(201)}','${id(51)}','${id(30)}','${id(40)}','${id(10)}',true,false);
    INSERT INTO teaching_assignments VALUES
      ('${id(300)}','${id(100)}','${id(200)}',true),
      ('${id(301)}','${id(102)}','${id(201)}',true);
  `);
  await db.exec(migration);
  return db;
}

test("database guard accepts aliases of one identity and rejects a second lecturer", async () => {
  const db = await fixture();
  try {
    await db.exec(`
      INSERT INTO delivery_groups VALUES
        ('${id(210)}','${id(50)}','${id(30)}','${id(40)}','${id(10)}',true,false),
        ('${id(211)}','${id(50)}','${id(30)}','${id(40)}','${id(10)}',true,false),
        ('${id(212)}','${id(50)}','${id(30)}','${id(41)}','${id(10)}',true,false),
        ('${id(213)}','${id(50)}','${id(30)}','${id(41)}','${id(10)}',true,false),
        ('${id(214)}','${id(50)}','${id(30)}','${id(42)}','${id(10)}',true,false);
      INSERT INTO teaching_assignments VALUES
        ('${id(310)}','${id(100)}','${id(210)}',true),
        ('${id(311)}','${id(101)}','${id(211)}',true),
        ('${id(312)}','${id(102)}','${id(212)}',true),
        ('${id(313)}','${id(102)}','${id(213)}',true),
        ('${id(314)}','${id(103)}','${id(214)}',true);
    `);
    await assert.rejects(
      db.query("UPDATE teaching_assignments SET instructor_id=$1 WHERE id=$2", [id(102), id(311)]),
      /COHORT_COMPONENT_SINGLE_INSTRUCTOR_REQUIRED/,
    );
    await assert.rejects(
      db.query("UPDATE teaching_assignments SET instructor_id=$1 WHERE id=$2", [id(100), id(313)]),
      /COHORT_COMPONENT_SINGLE_INSTRUCTOR_REQUIRED/,
    );
    await assert.rejects(
      db.query("UPDATE teaching_assignments SET instructor_id=$1 WHERE id=$2", [id(103), id(313)]),
      /FACULTY_IDENTITY_NOT_FOUND/,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::integer AS n FROM teaching_assignments WHERE id BETWEEN $1 AND $2",
          [id(310), id(314)],
        )
      ).rows[0].n,
      5,
    );
  } finally {
    await db.close();
  }
});

test("readiness reports legacy inconsistencies without rewriting them and keeps permissions closed", async () => {
  const db = await fixture();
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id(900)]);
    await db.exec("SET ROLE authenticated");
    const value = (
      await db.query("SELECT get_cohort_component_instructor_readiness($1,NULL) AS result", [
        id(10),
      ])
    ).rows[0].result;
    assert.equal(value.ok, false);
    assert.equal(value.violation_count, 1);
    assert.equal(value.violations[0].component_type, "theory");
    await db.exec("RESET ROLE");
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('anon','public.get_cohort_component_instructor_readiness(uuid,uuid)','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('authenticated','faculty_private.assert_cohort_component_single_instructor(uuid,uuid,uuid)','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT instructor_id FROM teaching_assignments WHERE id IN ($1,$2) ORDER BY id",
          [id(300), id(301)],
        )
      ).rows.map((row) => row.instructor_id),
      [id(100), id(102)],
    );
    await db.exec(migration);
  } finally {
    await db.close();
  }
});

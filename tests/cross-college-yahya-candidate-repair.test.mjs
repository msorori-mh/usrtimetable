import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.FACULTY_DB_MODULE || "@electric-sql/pglite");
const migration = new URL(
  "../supabase/migrations/20260930120000_cross_college_yahya_candidate_repair.sql",
  import.meta.url,
);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("repairs Yahya's canonical home and exposes an active identity member to ITCS", async () => {
  const db = new PGlite();
  try {
    await db.exec(fixtureSql());
    await db.exec(await readFile(migration, "utf8"));

    const repaired = (
      await db.query(
        `SELECT affiliation_college_id, affiliation_department_id, is_active, availability_status
         FROM instructors WHERE id=$1`,
        [id(41)],
      )
    ).rows[0];
    assert.deepEqual(repaired, {
      affiliation_college_id: id(20),
      affiliation_department_id: id(21),
      is_active: true,
      availability_status: "available",
    });

    const link = (
      await db.query("SELECT identity_id FROM faculty_identity_links WHERE instructor_id=$1", [
        id(41),
      ])
    ).rows;
    assert.equal(link.length, 1, "the legacy operational record receives a stable identity");

    const result = (
      await db.query("SELECT get_delivery_group_assignment_candidates($1) AS payload", [id(70)])
    ).rows[0].payload;
    const candidate = result.candidates.find((row) => row.instructor_id === id(41));
    assert.ok(candidate, "Yahya is available in the target cross-college picker");
    assert.equal(candidate.full_name, "أ.د. يحي البريهي");
    assert.equal(candidate.home_college_id, id(20));
    assert.equal(candidate.college_name, "كلية التربية والعلوم");
    assert.equal(candidate.is_home_college, false);
    assert.equal(candidate.employee_number, null, "cross-college HR identifiers remain private");
    assert.equal(result.assignable, true);

    const audit = (
      await db.query(
        "SELECT action,entity_id,college_id FROM audit_logs WHERE action='faculty_affiliation_repaired'",
      )
    ).rows;
    assert.deepEqual(audit, [
      { action: "faculty_affiliation_repaired", entity_id: id(41), college_id: id(20) },
    ]);
  } finally {
    await db.close();
  }
});

test("candidate discovery uses an available alias when the canonical source row is inactive", async () => {
  const db = new PGlite();
  try {
    await db.exec(fixtureSql());
    await db.exec(await readFile(migration, "utf8"));
    await db.query(
      `INSERT INTO instructors(
         id,college_id,affiliation_college_id,affiliation_department_id,full_name,
         is_active,availability_status,created_at
       ) VALUES
       ($1,$2,$2,$3,'Canonical inactive',false,'unavailable','2026-01-01'),
       ($4,$5,$2,$3,'Available operational alias',true,'available','2026-01-02')`,
      [id(51), id(20), id(21), id(52), id(10)],
    );
    await db.query(
      "INSERT INTO faculty_identities(id,university_id,university_number) VALUES($1,$2,'USABA-P-ALIAS')",
      [id(151), id(1)],
    );
    await db.query(
      "INSERT INTO faculty_identity_links(instructor_id,identity_id) VALUES($1,$3),($2,$3)",
      [id(51), id(52), id(151)],
    );

    const result = (
      await db.query("SELECT get_delivery_group_assignment_candidates($1) AS payload", [id(70)])
    ).rows[0].payload;
    const alias = result.candidates.find((row) => row.instructor_id === id(52));
    assert.ok(alias, "an inactive canonical row no longer hides the available identity");
    assert.equal(alias.full_name, "Available operational alias");
    assert.equal(alias.home_college_id, id(20));
  } finally {
    await db.close();
  }
});

function fixtureSql() {
  return `
    CREATE SCHEMA auth;
    CREATE SCHEMA faculty_private;
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT '${id(900)}'::uuid $$;

    CREATE TABLE colleges(
      id uuid PRIMARY KEY,
      university_id uuid NOT NULL,
      code text,
      name text NOT NULL
    );
    CREATE TABLE departments(id uuid PRIMARY KEY,college_id uuid NOT NULL,name text NOT NULL);
    CREATE TABLE instructors(
      id uuid PRIMARY KEY,
      college_id uuid NOT NULL,
      department_id uuid,
      affiliation_college_id uuid,
      affiliation_department_id uuid,
      full_name text NOT NULL,
      full_name_ar text,
      academic_rank text,
      employee_number text,
      is_active boolean NOT NULL DEFAULT true,
      availability_status text NOT NULL DEFAULT 'available',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE faculty_identities(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      university_id uuid NOT NULL,
      university_number text NOT NULL
    );
    CREATE TABLE faculty_identity_links(
      instructor_id uuid PRIMARY KEY REFERENCES instructors(id),
      identity_id uuid NOT NULL REFERENCES faculty_identities(id)
    );
    CREATE TABLE courses(id uuid PRIMARY KEY,college_id uuid NOT NULL,name text NOT NULL);
    CREATE TABLE course_offerings(id uuid PRIMARY KEY,college_id uuid NOT NULL,course_id uuid NOT NULL);
    CREATE TABLE plan_course_components(
      id uuid PRIMARY KEY,
      component_type text NOT NULL,
      weekly_contact_hours numeric NOT NULL
    );
    CREATE TABLE delivery_groups(
      id uuid PRIMARY KEY,
      college_id uuid NOT NULL,
      component_id uuid NOT NULL,
      active boolean NOT NULL DEFAULT true,
      is_obsolete boolean NOT NULL DEFAULT false
    );
    CREATE VIEW operational_delivery_groups AS SELECT * FROM delivery_groups;
    CREATE TABLE teaching_assignments(
      id uuid PRIMARY KEY,
      college_id uuid NOT NULL,
      course_offering_id uuid NOT NULL,
      instructor_id uuid NOT NULL,
      delivery_group_id uuid,
      is_active boolean NOT NULL DEFAULT true
    );
    CREATE TABLE audit_logs(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_id uuid,
      action text NOT NULL,
      entity text NOT NULL,
      entity_id uuid,
      college_id uuid,
      details jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE FUNCTION can_view_college(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT true $$;
    CREATE FUNCTION can_manage_college(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS
      $$ SELECT true $$;
    CREATE FUNCTION compute_delivery_group_allocation(uuid) RETURNS jsonb LANGUAGE sql STABLE AS
      $$ SELECT '{"allocation_status":"unassigned"}'::jsonb $$;
    CREATE FUNCTION register_instructor_faculty_identity(p_instructor_id uuid)
    RETURNS void LANGUAGE plpgsql AS $$
    DECLARE v_identity uuid := gen_random_uuid(); v_university uuid;
    BEGIN
      SELECT c.university_id INTO v_university
      FROM instructors i JOIN colleges c ON c.id=i.affiliation_college_id
      WHERE i.id=p_instructor_id;
      INSERT INTO faculty_identities(id,university_id,university_number)
      VALUES(v_identity,v_university,'USABA-P-'||right(replace(v_identity::text,'-',''),8));
      INSERT INTO faculty_identity_links(instructor_id,identity_id)
      VALUES(p_instructor_id,v_identity);
    END $$;

    INSERT INTO colleges(id,university_id,code,name) VALUES
      ('${id(10)}','${id(1)}','ITCS','كلية تكنولوجيا المعلومات وعلوم الحاسوب'),
      ('${id(20)}','${id(1)}','EDU','كلية التربية والعلوم');
    INSERT INTO departments VALUES('${id(11)}','${id(10)}','علوم الحاسوب'),
      ('${id(21)}','${id(20)}','قسم الرياضيات');
    INSERT INTO instructors(
      id,college_id,department_id,affiliation_college_id,affiliation_department_id,
      full_name,full_name_ar,is_active,availability_status
    ) VALUES(
      '${id(41)}','${id(10)}','${id(11)}',NULL,NULL,
      'أ.د. يحي البريهي','أ.د. يحي البريهي',false,'unavailable');
    INSERT INTO courses VALUES('${id(60)}','${id(10)}','التفاضل والتكامل');
    INSERT INTO course_offerings VALUES('${id(61)}','${id(10)}','${id(60)}');
    INSERT INTO plan_course_components VALUES('${id(69)}','theory',3);
    INSERT INTO delivery_groups VALUES('${id(70)}','${id(10)}','${id(69)}',true,false);
    INSERT INTO teaching_assignments VALUES(
      '${id(62)}','${id(10)}','${id(61)}','${id(41)}',NULL,true
    );

    CREATE VIEW faculty_private.home_profiles AS
    WITH members AS (
      SELECT l.identity_id,i.*
      FROM faculty_identity_links l JOIN instructors i ON i.id=l.instructor_id
    ), homes AS (
      SELECT identity_id,
        CASE WHEN count(DISTINCT affiliation_college_id)=1
                  AND bool_and(affiliation_college_id IS NOT NULL)
             THEN min(affiliation_college_id::text)::uuid END AS home_college_id
      FROM members GROUP BY identity_id
    )
    SELECT f.id AS identity_id,f.university_id,f.university_number,h.home_college_id,
      c.name AS home_college_name,source.id AS source_instructor_id,
      source.full_name,source.is_active
    FROM faculty_identities f
    JOIN homes h ON h.identity_id=f.id
    LEFT JOIN colleges c ON c.id=h.home_college_id
    LEFT JOIN LATERAL (
      SELECT m.* FROM members m WHERE m.identity_id=f.id
      ORDER BY (m.college_id=h.home_college_id) DESC,m.is_active DESC,m.created_at,m.id
      LIMIT 1
    ) source ON true;
  `;
}

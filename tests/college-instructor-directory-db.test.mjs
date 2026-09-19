import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.FACULTY_DB_MODULE || "@electric-sql/pglite");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration = await readFile(
  new URL(
    "../supabase/migrations/20260919120000_college_instructor_schedule_directory.sql",
    import.meta.url,
  ),
  "utf8",
);

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE SCHEMA auth; CREATE SCHEMA faculty_private;
    REVOKE ALL ON SCHEMA faculty_private FROM PUBLIC;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;
    CREATE FUNCTION public.can_view_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql STABLE AS
      $$SELECT u='${id(1)}'::uuid OR (u IN ('${id(2)}'::uuid,'${id(4)}'::uuid) AND c='${id(10)}'::uuid) OR (u='${id(3)}'::uuid AND c='${id(20)}'::uuid)$$;
    CREATE TABLE colleges(id uuid PRIMARY KEY,university_id uuid,name text);
    CREATE TABLE instructors(id uuid PRIMARY KEY,college_id uuid);
    CREATE TABLE faculty_identity_links(identity_id uuid,instructor_id uuid);
    CREATE TABLE faculty_private.home_profiles(identity_id uuid,source_instructor_id uuid,university_id uuid,university_number text,full_name text,home_college_id uuid,home_college_name text,type_code text,employment_type text,quota numeric,is_active boolean);
    CREATE TABLE course_offerings(id uuid PRIMARY KEY,college_id uuid,is_active boolean);
    CREATE TABLE delivery_groups(id uuid PRIMARY KEY,active boolean,is_obsolete boolean);
    CREATE TABLE teaching_assignments(id uuid PRIMARY KEY,college_id uuid,course_offering_id uuid,instructor_id uuid,delivery_group_id uuid,is_active boolean);
    CREATE TABLE schedule_versions(id uuid PRIMARY KEY,college_id uuid,status text,name text,disposable_test boolean);
    CREATE TABLE schedule_sessions(id uuid PRIMARY KEY,college_id uuid,schedule_version_id uuid,instructor_id uuid,replaced_by_split boolean);
    CREATE TABLE existing_schedule_source_rows(college_id uuid,schedule_session_id uuid,instructor_ids uuid[]);
    INSERT INTO colleges VALUES('${id(10)}','${id(90)}','ITCS'),('${id(20)}','${id(90)}','Arts'),('${id(30)}','${id(91)}','Other University');
  `);
  const people = [
    [101, 10, 10, "Home", 90],
    [102, 20, 20, "Visitor", 90],
    [103, 20, 20, "Unrelated", 90],
    [104, 10, 20, "Legacy row only", 90],
    [105, 20, 20, "Imported co-teacher", 90],
    [106, 20, 10, "Home with alias", 90],
    [108, 30, 10, "Other university", 91],
    [109, 20, 20, "Session only", 90],
    [110, 20, 20, "Inactive assignment", 90],
    [111, 20, 20, "Archived session", 90],
  ];
  for (const [n, rowCollege, home, name, university] of people) {
    await db.query("INSERT INTO instructors VALUES($1,$2)", [id(n), id(rowCollege)]);
    await db.query("INSERT INTO faculty_identity_links VALUES($1,$2)", [id(n + 1000), id(n)]);
    await db.query(
      "INSERT INTO faculty_private.home_profiles VALUES($1,$2,$3,$4,$5,$6,$7,'permanent','full_time',12,true)",
      [
        id(n + 1000),
        id(n),
        id(university),
        `U-${n}`,
        name,
        id(home),
        home === 10 ? "ITCS" : "Arts",
      ],
    );
  }
  await db.exec(`
    INSERT INTO instructors VALUES('${id(107)}','${id(10)}');
    INSERT INTO faculty_identity_links VALUES('${id(1106)}','${id(107)}');
    INSERT INTO course_offerings VALUES('${id(200)}','${id(10)}',true);
    INSERT INTO delivery_groups VALUES('${id(201)}',true,false);
    INSERT INTO teaching_assignments VALUES('${id(202)}','${id(10)}','${id(200)}','${id(102)}','${id(201)}',true),('${id(203)}','${id(10)}','${id(200)}','${id(110)}','${id(201)}',false);
    INSERT INTO schedule_versions VALUES('${id(300)}','${id(10)}','published','V2',false),('${id(301)}','${id(10)}','archived','Old',false);
    INSERT INTO schedule_sessions VALUES('${id(310)}','${id(10)}','${id(300)}','${id(101)}',false),('${id(311)}','${id(10)}','${id(300)}','${id(109)}',false),('${id(312)}','${id(10)}','${id(301)}','${id(111)}',false);
    INSERT INTO existing_schedule_source_rows VALUES('${id(10)}','${id(310)}',ARRAY['${id(105)}'::uuid]);
  `);
  await db.exec(migration);
  return db;
}
async function directory(db, user, college = 10) {
  await db.exec(
    `SET ROLE authenticated; SELECT set_config('test.uid','${user ? id(user) : ""}',false)`,
  );
  try {
    return (
      await db.query("SELECT public.get_college_instructor_schedule_directory($1) AS people", [
        college ? id(college) : null,
      ])
    ).rows[0].people;
  } finally {
    await db.exec("RESET ROLE");
  }
}

test("admin, college manager and reader receive the same scoped roster, never university-wide names", async () => {
  const db = await fixture();
  try {
    const expected = [101, 102, 105, 106, 109].map(id).sort();
    for (const user of [1, 2, 4]) {
      const rows = await directory(db, user);
      assert.deepEqual(rows.map((r) => r.id).sort(), expected);
      assert.equal(rows.find((r) => r.id === id(102)).home_college_name, "Arts");
      const homeAlias = rows.find((r) => r.id === id(106));
      assert.equal(homeAlias.home_college_name, "ITCS");
      assert.deepEqual(homeAlias.record_ids.sort(), [id(106), id(107)].sort());
      assert.equal(rows.filter((r) => r.university_number === "U-106").length, 1);
    }
    assert(!(await directory(db, 1, 20)).some((r) => r.id === id(101)));
  } finally {
    await db.close();
  }
});

test("unauthorized, anonymous, missing-college and cross-college requests fail closed", async () => {
  const db = await fixture();
  try {
    await assert.rejects(directory(db, null), /FORBIDDEN/);
    await assert.rejects(directory(db, 3), /FORBIDDEN/);
    await assert.rejects(directory(db, 2, 20), /FORBIDDEN/);
    await assert.rejects(directory(db, 1, null), /FORBIDDEN/);
    await assert.rejects(directory(db, 1, 999), /FORBIDDEN/);
    await db.exec("SET ROLE anon");
    await assert.rejects(
      db.exec(`SELECT public.get_college_instructor_schedule_directory('${id(10)}')`),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("obsolete assignments and fixture/replaced sessions cannot qualify unrelated lecturers", async () => {
  const db = await fixture();
  try {
    await db.exec(
      `UPDATE delivery_groups SET is_obsolete=true; UPDATE schedule_versions SET disposable_test=true WHERE id='${id(300)}'`,
    );
    assert.deepEqual((await directory(db, 1)).map((r) => r.id).sort(), [id(101), id(106)].sort());
    await db.exec(
      `UPDATE schedule_versions SET disposable_test=false,name='TEST_ONLY V2' WHERE id='${id(300)}'`,
    );
    assert.deepEqual((await directory(db, 1)).map((r) => r.id).sort(), [id(101), id(106)].sort());
    await db.exec(
      `UPDATE schedule_versions SET name='V2'; UPDATE schedule_sessions SET replaced_by_split=true`,
    );
    assert.deepEqual((await directory(db, 1)).map((r) => r.id).sort(), [id(101), id(106)].sort());
  } finally {
    await db.close();
  }
});

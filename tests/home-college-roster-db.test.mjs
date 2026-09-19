import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.FACULTY_DB_MODULE || "@electric-sql/pglite");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const migrationPath = "../supabase/migrations/20260919140000_home_college_faculty_roster.sql";

test("explicit pending home overrides legacy affiliation without moving teaching data and can be resolved", async () => {
  const f = await fixture();
  try {
    await f.actor(2);
    await assert.rejects(
      f.rpc("reconcile_faculty_home", [
        id(1001),
        null,
        id(101),
        false,
        "Missing from authoritative faculty roster",
        null,
      ]),
      /insufficient_privilege/,
    );
    await f.actor(1);
    await assert.rejects(
      f.rpc("reconcile_faculty_home", [
        id(1001),
        null,
        id(101),
        true,
        "Missing from authoritative faculty roster",
        null,
      ]),
      /FACULTY_HOME_REQUIRED_FOR_QUOTA/,
    );
    await f.rpc("reconcile_faculty_home", [
      id(1001),
      null,
      id(101),
      false,
      "Missing from authoritative faculty roster",
      null,
    ]);
    assert.equal(
      (await f.roster()).some((r) => r.id === id(101)),
      false,
    );
    assert.equal(
      (await f.roster(10, "pending")).some((r) => r.id === id(101)),
      true,
    );
    await f.db.exec("RESET ROLE");
    assert.equal(
      (await f.db.query("SELECT affiliation_college_id FROM instructors WHERE id=$1", [id(101)]))
        .rows[0].affiliation_college_id,
      id(10),
    );
    assert.equal(
      (await f.db.query("SELECT instructor_id FROM schedule_sessions WHERE id=$1", [id(301)]))
        .rows[0].instructor_id,
      id(101),
    );
    const at = (
      await f.db.query(
        "SELECT updated_at::text AS at FROM faculty_home_decisions WHERE identity_id=$1",
        [id(1001)],
      )
    ).rows[0].at;
    await f.actor(1);
    await assert.rejects(
      f.rpc("reconcile_faculty_home", [
        id(1001),
        id(10),
        id(101),
        false,
        "Confirmed faculty home from roster",
        null,
      ]),
      /STALE_FACULTY_DECISION/,
    );
    await f.rpc("reconcile_faculty_home", [
      id(1001),
      id(10),
      id(101),
      false,
      "Confirmed faculty home from roster",
      at,
    ]);
    assert.equal(
      (await f.roster()).some((r) => r.id === id(101)),
      true,
    );
  } finally {
    await f.db.close();
  }
});

test("inactive members may have unknown quota but activation retains quota validation", async () => {
  const f = await fixture();
  try {
    await f.db
      .exec(`ALTER TABLE academic_terms ADD COLUMN IF NOT EXISTS academic_year text, ADD COLUMN IF NOT EXISTS term_type text;
      CREATE TRIGGER test_unknown_quota BEFORE INSERT OR UPDATE ON instructors FOR EACH ROW EXECUTE FUNCTION guard_intake_unknown_catalog_values();`);
    await f.db.query(
      "INSERT INTO instructors(id,college_id,full_name,max_weekly_hours,is_active) VALUES($1,$2,'Inactive faculty on scholarship',NULL,false)",
      [id(950), id(10)],
    );
    await assert.rejects(
      f.db.query("UPDATE instructors SET is_active=true WHERE id=$1", [id(950)]),
      /UNKNOWN_CATALOG_VALUES_REQUIRE_EXISTING_SCHEDULE_INTAKE/,
    );
  } finally {
    await f.db.close();
  }
});

test("new registrations receive P/C/H numbers exactly once and reject duplicate employee identifiers", async () => {
  const f = await fixture();
  try {
    await f.actor(1);
    await f.db.exec("RESET ROLE");
    await f.db.query("INSERT INTO universities(id,code) VALUES($1,'USABA')", [id(90)]);
    const sql = await read("../supabase/migrations/20260918200000_faculty_employment_numbers.sql");
    await f.db.exec(
      sql
        .slice(
          sql.indexOf("CREATE OR REPLACE FUNCTION public.register_instructor_faculty_identity"),
          sql.indexOf("CREATE OR REPLACE FUNCTION public.academic_affairs_update_instructor"),
        )
        .trim()
        .replace(/;?$/, ";"),
    );
    for (const [n, type, code] of [
      [901, 12, "P"],
      [902, 13, "C"],
      [903, 14, "H"],
    ]) {
      await f.db.query(
        "INSERT INTO instructors(id,college_id,affiliation_college_id,full_name,instructor_type_id,employee_number) VALUES($1,$2,$2,$3,$4,$5)",
        [id(n), id(10), "New " + n, id(type), "NEW-" + n],
      );
      await f.rpc("register_instructor_faculty_identity", [id(n)]);
      await f.rpc("register_instructor_faculty_identity", [id(n)]);
      const rows = (
        await f.db.query(
          "SELECT f.university_number FROM faculty_identity_links l JOIN faculty_identities f ON f.id=l.identity_id WHERE l.instructor_id=$1",
          [id(n)],
        )
      ).rows;
      assert.equal(rows.length, 1);
      assert.match(rows[0].university_number, new RegExp("^USABA-" + code + "-\\d{6}$"));
    }
    await assert.rejects(
      f.db.query(
        "INSERT INTO instructors(college_id,affiliation_college_id,full_name,employee_number) VALUES($1,$1,'Duplicate','NEW-901')",
        [id(20)],
      ),
      /الرقم الوظيفي موجود/,
    );
  } finally {
    await f.db.close();
  }
});

async function fixture() {
  const db = new PGlite();
  await db.exec(await read("./faculty-workflow-fixture.sql"));
  await db.exec(`
    CREATE TABLE support_departments(id uuid PRIMARY KEY,college_id uuid,name text);
    CREATE FUNCTION user_in_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
      $$SELECT EXISTS(SELECT 1 FROM public.user_colleges WHERE user_id=u AND college_id=c)$$;
    CREATE FUNCTION is_viewer_only(u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
      $$SELECT public.has_role(u,'institutional_viewer') AND NOT public.has_role(u,'college_admin') AND NOT public.is_super_admin(u)$$;
    INSERT INTO colleges(id,university_id,name,code) VALUES
      ('${id(10)}','${id(90)}','ITCS','ITCS'),('${id(20)}','${id(90)}','Jawf','JWF'),('${id(30)}','${id(91)}','Other university','OTHER');
    INSERT INTO user_roles VALUES('${id(1)}','super_admin'),('${id(2)}','college_admin'),('${id(3)}','college_admin'),('${id(4)}','institutional_viewer'),('${id(5)}','read_only'),('${id(6)}','university_leadership');
    INSERT INTO user_colleges VALUES('${id(2)}','${id(10)}'),('${id(3)}','${id(20)}'),('${id(4)}','${id(20)}'),('${id(5)}','${id(20)}');
    INSERT INTO departments(id,college_id,name) VALUES('${id(11)}','${id(10)}','Computing'),('${id(21)}','${id(20)}','Information systems');
    INSERT INTO support_departments VALUES('${id(22)}','${id(20)}','Support');
    INSERT INTO instructor_types(id,college_id,code,name_ar) VALUES
      ('${id(12)}','${id(10)}','permanent','Permanent'),('${id(13)}','${id(10)}','annual_contract','Annual'),('${id(14)}','${id(10)}','con','Hourly'),
      ('${id(23)}','${id(20)}','permanent','Permanent'),('${id(24)}','${id(20)}','annual_contract','Annual'),('${id(25)}','${id(20)}','con','Hourly'),('${id(26)}','${id(20)}','from_other_college','Legacy visitor');
  `);
  for (const [n, physical, home, name, identity, active] of [
    [101, 10, 10, "Home", 1001, true],
    [102, 10, 20, "أحمد البدوي", 1002, true],
    [103, 20, 20, "Unrelated", 1003, true],
    [104, 10, null, "Unresolved", 1004, true],
    [105, 20, 10, "Inactive home", 1005, false],
    [106, 10, 20, "أحمد البدوي alias", 1002, true],
    [107, 30, 30, "Other university", 1007, true],
    [108, 20, 20, "Imported teacher", 1008, true],
  ]) {
    await db.query(
      `INSERT INTO instructors(id,college_id,department_id,affiliation_college_id,affiliation_department_id,full_name,academic_rank,employment_type,max_weekly_hours,administrative_release_hours,is_active,instructor_type_id,email,phone,employee_number,notes,full_name_en)
      VALUES($1,$2,$3,$4,$5,$6,'معيد','full_time',18,0,$7,$8,'private@example.test','555','EMP-'||$9,'private notes','English name')`,
      [
        id(n),
        id(physical),
        id(physical === 10 ? 11 : 21),
        home ? id(home) : null,
        home ? id(home === 10 ? 11 : 21) : null,
        name,
        active,
        id(physical === 10 ? 12 : 23),
        String(n),
      ],
    );
    if (n !== 106)
      await db.query(
        "INSERT INTO faculty_identities(id,university_id,university_number) VALUES($1,$2,$3)",
        [id(identity), id(physical === 30 ? 91 : 90), `USABA-ITCS-${n}`],
      );
    await db.query("INSERT INTO faculty_identity_links(instructor_id,identity_id) VALUES($1,$2)", [
      id(n),
      id(identity),
    ]);
  }
  await db.exec(`
    INSERT INTO course_offerings(id,college_id,is_active) VALUES('${id(200)}','${id(10)}',true);
    INSERT INTO delivery_groups(id,college_id,active,is_obsolete) VALUES('${id(201)}','${id(10)}',true,false);
    INSERT INTO teaching_assignments(id,college_id,course_offering_id,instructor_id,delivery_group_id,is_active) VALUES('${id(202)}','${id(10)}','${id(200)}','${id(106)}','${id(201)}',true);
    INSERT INTO schedule_versions(id,college_id,status,name,disposable_test) VALUES('${id(300)}','${id(10)}','published','Published',false);
    INSERT INTO schedule_sessions(id,college_id,schedule_version_id,instructor_id,day_of_week,start_time,end_time,replaced_by_split) VALUES('${id(301)}','${id(10)}','${id(300)}','${id(101)}',1,'08:00','10:00',false);
    INSERT INTO existing_schedule_source_rows(college_id,schedule_session_id,instructor_ids) VALUES('${id(10)}','${id(301)}',ARRAY['${id(108)}'::uuid]);
  `);
  await db.exec(await read("../supabase/migrations/20260919100000_faculty_home_profiles.sql"));
  await db.exec(`INSERT INTO faculty_home_decisions(identity_id,home_college_id,source_instructor_id,quota_confirmed,evidence,decided_by)
    VALUES('${id(1002)}','${id(20)}','${id(102)}',true,'confirmed historical home','${id(1)}');
    CREATE TRIGGER test_employment_number AFTER UPDATE OF instructor_type_id ON instructors FOR EACH ROW EXECUTE FUNCTION update_faculty_employment_number();
    ALTER TABLE instructors ENABLE ROW LEVEL SECURITY;
    CREATE POLICY physical_read ON instructors FOR SELECT TO authenticated USING(can_view_college(auth.uid(),college_id));
    CREATE POLICY physical_update ON instructors FOR UPDATE TO authenticated USING(can_manage_college(auth.uid(),college_id)) WITH CHECK(can_manage_college(auth.uid(),college_id));
  `);
  await db.exec(
    await read("../supabase/migrations/20260919120000_college_instructor_schedule_directory.sql"),
  );
  await db.exec(await read(migrationPath));
  await db.exec(
    await read("../supabase/migrations/20260919160000_explicit_faculty_home_review.sql"),
  );
  const actor = async (n) => {
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [n ? id(n) : ""]);
    await db.exec("SET ROLE authenticated");
  };
  const rpc = async (name, args) =>
    (
      await db.query(
        `SELECT to_jsonb(public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")})) AS result`,
        args,
      )
    ).rows[0].result;
  const roster = (c = 10, scope = "home") =>
    rpc("get_college_faculty_roster", [c ? id(c) : null, scope]);
  const update = (row, changes = {}) => {
    const r = { ...row, ...changes };
    return rpc("update_home_college_instructor", [
      r.affiliation_college_id,
      r.updated_at,
      r.id,
      r.full_name,
      r.full_name_ar,
      r.employee_number,
      r.specialization,
      r.academic_rank,
      r.email,
      r.phone,
      r.employment_type,
      r.max_weekly_hours,
      r.administrative_release_hours,
      r.is_active,
      r.instructor_type_id,
      r.affiliation_college_id,
      r.affiliation_department_id,
      r.administrative_position,
      r.administrative_department_id,
      r.administrative_support_department_id,
    ]);
  };
  return { db, actor, rpc, roster, update };
}

test("default home roster is identical for admin and college users, includes inactive members, deduplicates aliases", async () => {
  const f = await fixture();
  try {
    for (const user of [1, 2, 6]) {
      await f.actor(user);
      assert.deepEqual((await f.roster()).map((r) => r.id).sort(), [id(101), id(105)].sort());
    }
    await f.actor(1);
    const home = await f.roster(20);
    assert.equal(home.filter((r) => r.identity_id === id(1002)).length, 1);
    const ahmed = home.find((r) => r.id === id(102));
    assert.equal(ahmed.department_id, id(21));
    assert.equal(ahmed.college_id, id(10));
    assert.equal(ahmed.home_college_name, "Jawf");
    assert.equal(ahmed.instructor_type_id, id(23));
    assert.equal(ahmed.can_edit, true);
    assert.equal(ahmed.can_delete, false);
    assert.deepEqual(
      (await f.roster(10, "pending")).map((r) => r.id),
      [id(104)],
    );
  } finally {
    await f.db.close();
  }
});

test("visitors require real teaching, preserve alias/imported attribution and expose no personal HR fields", async () => {
  const f = await fixture();
  try {
    await f.actor(1);
    const visitors = await f.roster(10, "visiting");
    assert.deepEqual(visitors.map((r) => r.id).sort(), [id(102), id(108)].sort());
    for (const r of visitors) {
      assert.equal(r.can_edit, false);
      assert.equal(r.can_delete, false);
      assert.equal(r.email, null);
      assert.equal(r.employee_number, null);
      assert.equal(r.notes, null);
    }
    await f.db.exec(
      "RESET ROLE; UPDATE delivery_groups SET is_obsolete=true; UPDATE schedule_sessions SET replaced_by_split=true",
    );
    await f.actor(1);
    assert.deepEqual(await f.roster(10, "visiting"), []);
  } finally {
    await f.db.close();
  }
});

test("missing or unauthorized college and arbitrary scope never widen the roster", async () => {
  const f = await fixture();
  try {
    await f.actor(1);
    await assert.rejects(f.roster(null), /FORBIDDEN/);
    await assert.rejects(f.roster(999), /FORBIDDEN/);
    await assert.rejects(f.roster(10, "all"), /INVALID_ROSTER_SCOPE/);
    await f.actor(3);
    await assert.rejects(f.roster(10), /FORBIDDEN/);
    await f.actor(null);
    await assert.rejects(f.roster(), /FORBIDDEN/);
    await f.db.exec("RESET ROLE; SET ROLE anon");
    await assert.rejects(f.roster(), /permission denied/);
  } finally {
    await f.db.close();
  }
});

test("home manager updates legacy foreign-owned record without moving IDs, department, number or operational rows", async () => {
  const f = await fixture();
  try {
    await f.actor(3);
    const row = (await f.roster(20)).find((r) => r.id === id(102));
    const snapshot = async () => {
      await f.db.exec("RESET ROLE");
      return (
        await f.db.query(
          "SELECT (SELECT jsonb_agg(a ORDER BY id) FROM teaching_assignments a) AS assignments,(SELECT jsonb_agg(g ORDER BY id) FROM delivery_groups g) AS groups,(SELECT jsonb_agg(s ORDER BY id) FROM schedule_sessions s) AS sessions",
        )
      ).rows;
    };
    const before = await snapshot();
    await f.actor(3);
    const saved = await f.update(row, { specialization: "نظم المعلومات" });
    assert.equal(saved.id, id(102));
    assert.equal(saved.college_id, id(10));
    assert.equal(saved.department_id, id(11));
    assert.equal(saved.affiliation_department_id, id(21));
    assert.equal(saved.instructor_type_id, id(12));
    assert.equal(saved.full_name_en, "English name");
    assert.equal(saved.notes, "private notes");
    assert.equal(
      (await f.roster(20)).find((r) => r.id === id(102)).university_number,
      "USABA-ITCS-102",
    );
    await assert.rejects(f.update(row, { phone: "stale" }), /تغيرت بيانات/);
    assert.deepEqual(await snapshot(), before);
  } finally {
    await f.db.close();
  }
});

test("receiving managers, viewers, alternate aliases and forged affiliations cannot edit canonical HR", async () => {
  const f = await fixture();
  try {
    await f.actor(1);
    const row = (await f.roster(20)).find((r) => r.id === id(102));
    for (const user of [2, 5, 6]) {
      await f.actor(user);
      await assert.rejects(f.update(row), /كليته الأصلية/);
    }
    await f.actor(2);
    await assert.rejects(
      f.db.query("UPDATE instructors SET phone='bad' WHERE id=$1", [id(102)]),
      /الكلية الأصلية/,
    );
    await f.actor(3);
    await assert.rejects(f.update(row, { id: id(106) }), /كليته الأصلية/);
    await assert.rejects(f.update(row, { affiliation_college_id: id(10) }), /كليته الأصلية/);
    await assert.rejects(
      f.update(row, { affiliation_department_id: id(11) }),
      /DEPARTMENT_COLLEGE_MISMATCH/,
    );
    await assert.rejects(f.update(row, { employee_number: "EMP-101" }), /الرقم الوظيفي/);
    await assert.rejects(f.update(row, { max_weekly_hours: -1 }), /NONNEGATIVE/);
    await f.actor(4);
    const saved = await f.update(row, { specialization: "Academic affairs edit" });
    assert.equal(saved.specialization, "Academic affairs edit");
  } finally {
    await f.db.close();
  }
});

test("employment category change creates C/H numbers once, preserves old numbers, resets borrowed quota approval", async () => {
  const f = await fixture();
  try {
    await f.actor(3);
    let row = (await f.roster(20)).find((r) => r.id === id(102));
    await f.update(row, { instructor_type_id: id(24), max_weekly_hours: 16 });
    row = (await f.roster(20)).find((r) => r.id === id(102));
    assert.match(row.university_number, /^USABA-C-/);
    assert.equal(row.authoritative_quota, null);
    await f.update(row, { specialization: "Same annual category" });
    let same = (await f.roster(20)).find((r) => r.id === id(102));
    assert.equal(same.university_number, row.university_number);
    await f.update(same, {
      instructor_type_id: id(25),
      administrative_release_hours: 3,
      administrative_position: "department_head",
      administrative_department_id: id(21),
    });
    same = (await f.roster(20)).find((r) => r.id === id(102));
    assert.match(same.university_number, /^USABA-H-/);
    assert.equal(same.administrative_release_hours, 0);
    assert.equal(same.administrative_position, null);
    await f.db.exec("RESET ROLE");
    const history = (
      await f.db.query(
        "SELECT university_number FROM faculty_number_history ORDER BY university_number",
      )
    ).rows.map((r) => r.university_number);
    assert.deepEqual(history.sort(), ["USABA-ITCS-102", row.university_number].sort());
  } finally {
    await f.db.close();
  }
});

test("identity lookup is explicit, bounded to the same university, deduplicated, admin-only, and finds previous numbers", async () => {
  const f = await fixture();
  try {
    await f.actor(1);
    assert.deepEqual(await f.rpc("search_faculty_identity_candidates", [id(101), ""]), []);
    const results = await f.rpc("search_faculty_identity_candidates", [id(101), "احمد"]);
    assert.equal(results.length, 1);
    assert.equal(results[0].home_college, "Jawf");
    assert.equal(results[0].id, id(102));
    assert.deepEqual(await f.rpc("search_faculty_identity_candidates", [id(102), "احمد"]), []);
    assert.deepEqual(
      await f.rpc("search_faculty_identity_candidates", [id(101), "Other university"]),
      [],
    );
    const row = (await f.roster(20)).find((r) => r.id === id(102));
    await f.update(row, { instructor_type_id: id(24) });
    assert.match(
      (await f.rpc("search_faculty_identity_candidates", [id(101), "USABA-ITCS-102"]))[0]
        .university_number,
      /^USABA-C-/,
    );
    await f.actor(3);
    await assert.rejects(
      f.rpc("search_faculty_identity_candidates", [id(101), "احمد"]),
      /FORBIDDEN/,
    );
  } finally {
    await f.db.close();
  }
});

test("migration rollback restores the previous trigger and can be reapplied without changing instructor data", async () => {
  const f = await fixture();
  try {
    await f.db.exec("RESET ROLE");
    const before = (await f.db.query("SELECT jsonb_agg(i ORDER BY id) AS rows FROM instructors i"))
      .rows;
    await f.db.exec(
      await read("../supabase/rollbacks/20260919140000_home_college_faculty_roster.sql"),
    );
    await assert.rejects(f.db.exec("SELECT get_college_faculty_roster(null)"), /does not exist/);
    await f.db.exec(await read(migrationPath));
    assert.deepEqual(
      (await f.db.query("SELECT jsonb_agg(i ORDER BY id) AS rows FROM instructors i")).rows,
      before,
    );
  } finally {
    await f.db.close();
  }
});

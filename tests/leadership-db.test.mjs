import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.LEADERSHIP_DB_MODULE || "@electric-sql/pglite");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sql = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("leadership: real PostgreSQL read scope, mixed-role safety and truthful university summaries", async () => {
  const db = new PGlite();
  await db.exec(await sql("./leadership-fixture.sql"));
  await db.exec(await sql("../supabase/migrations/20260918160000_university_leadership_role.sql"));
  await db.exec(
    await sql("../supabase/migrations/20260918160100_university_leadership_overview.sql"),
  );
  for (const [n, name] of [
    [1, "كلية أ"],
    [2, "كلية ب"],
    [3, "كلية بلا فصل"],
  ])
    await db.query("insert into colleges values($1,$2)", [id(n), name]);
  await db.exec(`insert into academic_terms values('${id(11)}','${id(1)}','الأول','2026-2027','first','2026-09-01'),('${id(12)}','${id(2)}','الأول 2026-2027',null,'first','2026-09-01');
    insert into user_roles values('${id(101)}','university_leadership'),('${id(102)}','read_only'),('${id(103)}','college_admin');
    insert into user_colleges values('${id(102)}','${id(1)}'),('${id(103)}','${id(1)}');
    insert into plan_course_components values('${id(21)}','theory',true),('${id(22)}','practical',true);
    insert into instructors values('${id(31)}','${id(1)}','a',10,2,true),('${id(32)}','${id(2)}','a',10,2,true),('${id(33)}','${id(2)}','a',12,0,true),('${id(34)}','${id(2)}','a',0,0,true),('${id(35)}','${id(2)}','a',null,0,true);
    insert into faculty_identities values('${id(41)}','${id(1)}');
    insert into faculty_identity_links values('${id(41)}','${id(31)}'),('${id(41)}','${id(32)}');
    insert into rooms values('${id(51)}','${id(1)}',null,'lecture_hall',75,true),('${id(52)}','${id(2)}',null,'computer_lab',39,true);
    insert into schedule_versions values('${id(61)}','${id(1)}','${id(11)}','قديم','published',false,false,'2026-09-01','2026-09-01'),('${id(62)}','${id(1)}','${id(11)}','معتمد','published',false,false,'2026-09-02','2026-09-02'),('${id(63)}','${id(1)}','${id(11)}','مسودة','draft',false,false,'2026-09-03','2026-09-03');
    insert into schedule_sessions values('${id(71)}','${id(1)}','${id(61)}','${id(21)}','theory','08:00','14:00',false,'${id(51)}'),('${id(72)}','${id(1)}','${id(62)}','${id(21)}','theory','08:00','11:00',false,'${id(51)}'),('${id(73)}','${id(1)}','${id(62)}','${id(22)}','practical','11:00','13:00',false,'${id(51)}'),('${id(74)}','${id(1)}','${id(63)}','${id(21)}','theory','08:00','14:00',false,'${id(51)}');`);
  const group = (college, n, who, hours, extra = {}) => ({
    delivery_group_id: id(n),
    college_id: id(college),
    plan_course_component_id: id(21),
    component_type: "theory",
    component_hours: hours,
    assigned_hours_total: hours,
    remaining_hours: 0,
    active: true,
    is_obsolete: false,
    excluded_from_standard_workload: false,
    instructors: [{ instructor_id: id(who), is_active: true, assigned_component_hours: hours }],
    ...extra,
  });
  const aGroups = [
    group(1, 81, 31, 6),
    group(1, 82, 31, 100, { is_obsolete: true }),
    group(1, 83, 31, 100, { active: false }),
  ];
  const bGroups = [group(2, 84, 32, 4), group(2, 85, 34, 2), group(2, 86, 35, 3)];
  await db.query("insert into workspace_fixture values($1,$2,$3),($4,$5,$6)", [
    id(1),
    id(11),
    JSON.stringify(aGroups),
    id(2),
    id(12),
    JSON.stringify(bGroups),
  ]);
  const actor = async (n) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(n)]);
    await db.exec("set role authenticated");
  };
  const overview = async () =>
    (await db.query("select leadership_overview('2026-2027','first') as value")).rows[0].value;
  await actor(101);
  const report = await overview();
  const [a, b, c] = [1, 2, 3].map((n) => report.colleges.find((c) => c.college_id === id(n)));
  assert.equal(a.faculty_count, 1, "linked faculty counted once in issuing college");
  assert.equal(a.net_quota, 8);
  assert.equal(a.faculty_assigned_hours, 10);
  assert.equal(a.overload, 2);
  assert.equal(b.faculty_count, 3);
  assert.equal(b.overload, 2);
  assert.equal(b.deficit, 12);
  assert.equal(b.incomplete_faculty, 1);
  assert.equal(a.required_hours, 6, "obsolete and inactive groups excluded");
  assert.equal(b.assigned_hours, 9);
  assert.equal(a.teaching_hours, 5, "one published version, no draft/old version duplicates");
  assert.equal(a.theory_hours, 3);
  assert.equal(a.practical_hours, 2);
  assert.equal(b.teaching_hours, null);
  assert.equal(c.net_quota, null);
  assert.equal(c.term_state, "missing");
  assert.equal(b.year_inferred, true);
  assert.equal(a.used_rooms, 1);
  assert.equal(b.used_rooms, null);
  assert.equal((await db.query("select * from rooms")).rows.length, 2);
  assert.equal((await db.query("update rooms set capacity=999 returning *")).rows.length, 0);
  assert.equal((await db.query("delete from rooms returning *")).rows.length, 0);
  await assert.rejects(
    db.query(`insert into user_roles values('${id(101)}','super_admin')`),
    /row-level security/,
  );
  await assert.rejects(
    db.query(`insert into rooms values('${id(53)}','${id(2)}',null,'lecture_hall',999,true)`),
    /row-level security/,
  );
  await actor(102);
  assert.equal((await db.query("select * from rooms")).rows.length, 1);
  await assert.rejects(overview(), /insufficient_privilege/);
  await actor(103);
  await assert.rejects(overview(), /insufficient_privilege/);
  await db.exec("reset role");
  await db.query("insert into user_roles values($1,$2)", [id(103), "university_leadership"]);
  await actor(103);
  assert.equal(
    (await db.query(`select can_manage_college(auth.uid(),'${id(2)}') as allowed`)).rows[0].allowed,
    false,
  );
  assert.equal(
    (await db.query(`select can_manage_college(auth.uid(),'${id(1)}') as allowed`)).rows[0].allowed,
    true,
  );
  await db.exec("reset role");
  await db.query("delete from user_roles where user_id=$1 and role=$2", [
    id(103),
    "university_leadership",
  ]);
  await actor(103);
  assert.equal((await db.query("select * from rooms")).rows.length, 1);
  await db.exec("reset role");
  await db.exec("set role anon");
  await assert.rejects(overview(), /permission denied/);
  await db.exec("reset role");
  aGroups[0].instructors.push({
    instructor_id: id(33),
    is_active: true,
    assigned_component_hours: null,
  });
  await db.query("update workspace_fixture set payload=$1 where college_id=$2", [
    JSON.stringify(aGroups),
    id(1),
  ]);
  await actor(101);
  const pending = await overview();
  assert.equal(pending.colleges.find((c) => c.college_id === id(1)).pending_groups, 1);
  assert.equal(pending.colleges.find((c) => c.college_id === id(2)).incomplete_faculty, 2);
  await db.exec("reset role");
  await db.query("insert into academic_terms values($1,$2,$3,$4,$5,$6)", [
    id(13),
    id(1),
    "ثان بنفس الفترة",
    "2026-2027",
    "first",
    "2026-09-01",
  ]);
  await actor(101);
  const ambiguous = (await overview()).colleges.find((c) => c.college_id === id(1));
  assert.equal(ambiguous.term_state, "ambiguous");
  assert.equal(ambiguous.required_hours, null);
  await db.close();
});

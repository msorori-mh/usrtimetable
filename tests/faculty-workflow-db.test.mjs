import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.FACULTY_DB_MODULE || "@electric-sql/pglite");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");

test("contractor: no quota, preserved hours, approval, allocation and published sessions", async (t) => {
  const { db, actor, rpc, ins } = await fixture();
  t.after(() => db.close());
  await db.exec(await read("../supabase/migrations/20260923100000_permanent_faculty_quota_only.sql"));
  await ins("instructor_types", { id: id(7002), college_id: id(20), code: "from_other_college" });
  await db.query("update instructors set employment_type='contract', instructor_type_id=$1, max_weekly_hours=null where id=$2", [id(7002), id(103)]);
  await actor(1);
  await rpc("reconcile_faculty_home", [id(203), id(30), id(103), false, "contractor home, quota does not apply", null]);
  const before = (await db.query("select jsonb_agg(s order by id) value from schedule_sessions s")).rows;
  let preview = await rpc("preview_instructor_workload_after_assignment", [id(103), id(362), 3, null]);
  assert.equal(preview.quota_applicable, false);
  assert.equal(preview.required_load_hours, null);
  assert.equal(preview.policy_missing, false);
  assert.equal(preview.status_after, "not_applicable");
  assert.equal(preview.projected_standard_assigned_hours, 3);
  assert.equal(preview.deficit_after, null);
  assert.equal(preview.overload_after, null);
  await actor(3);
  const pending = await rpc("create_teaching_assignment_v2", [id(362), id(103), 3, null]);
  assert.equal(pending.action, "requested", "contractor still needs home approval");
  await assert.rejects(rpc("decide_faculty_teaching_request", [pending.request_id, "approved", "self approval"]), /insufficient_privilege/);
  await actor(4);
  const approved = await rpc("decide_faculty_teaching_request", [pending.request_id, "approved", "home approves contract teaching"]);
  assert.equal(approved.action, "created");
  await actor(1);
  const load = await rpc("compute_instructor_standard_workload", [id(103), id(301)]);
  assert.equal(load.quota_applicable, false);
  assert.equal(load.standard_assigned_hours, 3);
  assert.equal(load.required_load_hours, null);
  assert.equal(load.deficit_hours, null);
  assert.equal(load.overload_hours, null);
  const report = await rpc("get_faculty_university_report", [id(103), id(301), []]);
  assert.equal(report.quota_status, "not_applicable");
  assert.equal(report.quota, null);
  await assert.rejects(db.query("update teaching_assignments set assigned_component_hours=2 where id=$1", [approved.assignment_id]), /اعتماد التكليف/);
  assert.deepEqual((await db.query("select jsonb_agg(s order by id) value from schedule_sessions s")).rows, before);
  // A local contractor with a legacy numeric quota can exceed quota+12, but
  // malformed legacy allocations remain blocked before quota exemption.
  await ins("instructor_types", { id: id(7003), college_id: id(10), code: "con" });
  await db.query("update instructors set instructor_type_id=$1,employment_type='contract',max_weekly_hours=0 where id=$2", [id(7003),id(104)]);
  await db.exec("reset role");
  await db.query("update plan_course_components set weekly_contact_hours=15 where id=$1", [id(351)]);
  await db.query("update teaching_assignments set is_active=false where id=$1", [id(401)]);
  await actor(1);
  const contract = await rpc("create_teaching_assignment_v2", [id(361),id(104),15,null]);
  assert.equal(contract.action,"created");
  assert.equal((await rpc("compute_instructor_standard_workload",[id(104),id(301)])).standard_assigned_hours,15);
  await assert.rejects(db.query("insert into teaching_assignments(college_id,instructor_id,course_offering_id,weekly_hours,is_active) values($1,$2,$3,1,true)",[id(10),id(104),id(341)]), /FACULTY_ALLOCATION_REVIEW_REQUIRED/);
  await db.exec("reset role");
  const classification = async (type, employment) => (await db.query("select faculty_private.quota_applicability($1,$2) value",[type,employment])).rows[0].value;
  assert.equal(await classification("permanent","full_time"),true);
  assert.equal(await classification("appointed","part_time"),true);
  assert.equal(await classification("permanent","contract"),null,"conflicting records cannot bypass quota validation");
  assert.equal(await classification(null,"unknown"),null);
  assert.equal(await classification("from_other_college","full_time"),null);
  assert.equal(await classification("annual_contract","contract"),false);
  await db.exec("select set_config('request.jwt.claim.sub','',false); set role anon");
  await assert.rejects(rpc("preview_instructor_workload_after_assignment",[id(103),id(362),3,null]), /permission denied|insufficient_privilege/);
});

async function fixture() {
  const db = new PGlite();
  await db.exec(await read("./faculty-workflow-fixture.sql"));
  const ins = async (table, row) => {
    const keys = Object.keys(row);
    await db.query(
      `insert into ${table}(${keys.join(",")}) values(${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
      Object.values(row),
    );
  };
  await ins("universities", { id: id(1000), code: "U" });
  for (const [n, name] of [
    [10, "الحاسوب"],
    [20, "الآداب"],
    [30, "التربية"],
  ])
    await ins("colleges", { id: id(n), name, code: "C" + n, university_id: id(1000) });
  for (const [n, role, college] of [
    [1, "super_admin", null],
    [2, "college_admin", 10],
    [3, "college_admin", 20],
    [4, "college_admin", 30],
    [5, "university_leadership", null],
    [6, "read_only", 20],
  ]) {
    await ins("user_roles", { user_id: id(n), role });
    if (college) await ins("user_colleges", { user_id: id(n), college_id: id(college) });
  }
  await ins("instructor_types", { id: id(7001), college_id: id(10), code: "permanent" });
  for (const [n, c, home, quota] of [
    [101, 10, 10, 12],
    [102, 20, 10, 18],
    [103, 20, 30, 18],
    [104, 10, 10, 0],
    [105, 10, 10, 12],
    [106, 20, 20, 12],
  ]) {
    await ins("instructors", {
      id: id(n),
      college_id: id(c),
      affiliation_college_id: id(home),
      full_name: "TEST_ONLY " + n,
      max_weekly_hours: quota,
      administrative_release_hours: 0,
      is_active: true,
      academic_rank: "a",
      employment_type: "full_time",
      instructor_type_id: id(7001),
    });
  }
  for (const [identity, issuing] of [
    [201, 10],
    [203, 20],
    [204, 10],
    [205, 10],
  ])
    await ins("faculty_identities", {
      id: id(identity),
      university_id: id(1000),
      issuing_college_id: id(issuing),
      university_number: "U-P-" + identity,
      serial: identity,
    });
  for (const [n, i] of [
    [101, 201],
    [102, 201],
    [103, 203],
    [104, 204],
    [105, 205],
    [106, 205],
  ])
    await ins("faculty_identity_links", { instructor_id: id(n), identity_id: id(i) });
  for (const [n, c] of [
    [301, 10],
    [302, 20],
  ]) {
    await ins("academic_terms", {
      id: id(n),
      college_id: id(c),
      name: "الأول 2026-2027",
      academic_year: "2026-2027",
      term_type: "first",
      start_date: "2026-09-01",
      end_date: "2027-01-01",
    });
    await ins("academic_programs", { id: id(n + 10), college_id: id(c), name: "برنامج " + c });
    await ins("academic_cohorts", {
      id: id(n + 20),
      college_id: id(c),
      term_id: id(n),
      program_id: id(n + 10),
    });
    await ins("courses", { id: id(n + 30), college_id: id(c), name: "مقرر " + c });
    await ins("course_offerings", {
      id: id(n + 40),
      college_id: id(c),
      term_id: id(n),
      course_id: id(n + 30),
    });
    await ins("plan_course_components", {
      id: id(n + 50),
      college_id: id(c),
      component_type: "theory",
      weekly_contact_hours: 3,
      counts_toward_regular_load: true,
    });
    await ins("delivery_groups", {
      id: id(n + 60),
      college_id: id(c),
      cohort_id: id(n + 20),
      component_id: id(n + 50),
      group_code: "G" + c,
      group_number: 1,
      active: true,
      is_obsolete: false,
    });
    await ins("schedule_versions", {
      id: id(n + 70),
      college_id: id(c),
      academic_term_id: id(n),
      name: "منشور",
      status: "published",
    });
  }
  await ins("teaching_assignments", {
    id: id(401),
    college_id: id(10),
    instructor_id: id(101),
    course_offering_id: id(341),
    delivery_group_id: id(361),
    plan_course_component_id: id(351),
    assigned_component_hours: 3,
    weekly_hours: 3,
    is_active: true,
  });
  await ins("schedule_sessions", {
    id: id(501),
    college_id: id(10),
    schedule_version_id: id(371),
    instructor_id: id(101),
    course_offering_id: id(341),
    delivery_group_id: id(361),
    cohort_id: id(321),
    day_of_week: 1,
    start_time: "08:00",
    end_time: "11:00",
    session_type: "lecture",
    study_system: "general",
  });
  for (const migration of [
    "20260919100000_faculty_home_profiles.sql",
    "20260919101000_faculty_teaching_requests.sql",
    "20260919102000_faculty_reports_and_candidates.sql",
    "20260919103000_leadership_home_attribution.sql",
    "20260919104000_faculty_identity_conflicts.sql",
    "20260923100000_permanent_faculty_quota_only.sql",
  ])
    await db.exec(await read("../supabase/migrations/" + migration));
  await db.exec(
    "CREATE TRIGGER test_load_limit AFTER INSERT OR UPDATE ON teaching_assignments FOR EACH ROW EXECUTE FUNCTION enforce_instructor_extra_hours_limit()",
  );
  await db.exec(
    "CREATE TRIGGER test_employment_number AFTER UPDATE OF instructor_type_id ON instructors FOR EACH ROW EXECUTE FUNCTION update_faculty_employment_number()",
  );
  const actor = async (n) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(n)]);
    await db.exec("set role authenticated");
  };
  const rpc = async (name, args = []) =>
    (await db.query(`select ${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`, args))
      .rows[0].value;
  return { db, actor, rpc, ins };
}

test("faculty workflow: home attribution, authoritative quota, approval roles, unchanged schedules and university reporting", async () => {
  const { db, actor, rpc } = await fixture();
  await actor(1);
  let homes = await rpc("get_faculty_home_profiles", [null]);
  assert.equal(homes.length, 4, "linked identities counted once");
  assert.equal(
    homes.find((h) => h.identity_id === id(201)).quota,
    12,
    "home record wins over borrowed 18h",
  );
  assert.equal(
    homes.find((h) => h.identity_id === id(203)).home_college_id,
    id(30),
    "home distinct from issuing college",
  );
  assert.equal(
    homes.find((h) => h.identity_id === id(203)).quota,
    null,
    "unverified foreign quota withheld",
  );
  assert.equal(homes.find((h) => h.identity_id === id(204)).quota, 0, "zero remains valid");
  assert.equal(
    homes.find((h) => h.identity_id === id(205)).home_college_id,
    null,
    "conflicting home excluded",
  );
  const overview = await rpc("leadership_overview", ["2026-2027", "first"]);
  assert.equal(overview.unique_faculty, 4);
  assert.equal(overview.unresolved_faculty, 1);
  assert.equal(overview.colleges.find((c) => c.college_id === id(10)).faculty_directory_count, 2);
  assert.equal(overview.colleges.find((c) => c.college_id === id(30)).faculty_directory_count, 1);
  assert.equal(overview.colleges.find((c) => c.college_id === id(20)).faculty_directory_count, 0);
  const before = await db.query("select jsonb_agg(s order by id) value from schedule_sessions s");
  await actor(3);
  const candidates = (await rpc("get_delivery_group_assignment_candidates", [id(362)])).candidates;
  assert.equal(candidates.filter((c) => [id(101), id(102)].includes(c.instructor_id)).length, 1);
  assert.equal(candidates.find((c) => c.instructor_id === id(101)).home_college_id, id(10));
  const request = await rpc("create_teaching_assignment_v2", [id(362), id(101), 3, null]);
  assert.equal(request.action, "requested");
  assert.equal(
    (await db.query("select count(*)::int n from teaching_assignments")).rows[0].n,
    1,
    "pending request adds no assignment",
  );
  await assert.rejects(
    rpc("decide_faculty_teaching_request", [request.request_id, "approved", "self approval"]),
    /insufficient_privilege/,
  );
  await assert.rejects(
    rpc("create_teaching_assignment_v2", [id(362), id(101), 3, null]),
    /FACULTY_REQUEST_ALREADY_PENDING/,
  );
  await actor(4);
  await assert.rejects(rpc("list_faculty_teaching_requests", [id(20)]), /insufficient_privilege/);
  await actor(6);
  await assert.rejects(
    rpc("create_teaching_assignment_v2", [id(362), id(101), 3, null]),
    /insufficient_privilege/,
  );
  await actor(2);
  await assert.rejects(
    db.query("update instructors set affiliation_college_id=$1 where id=$2", [id(30), id(101)]),
    /تسوية التبعية/,
  );
  assert.equal((await rpc("list_faculty_teaching_requests", [id(10)])).length, 1);
  const approval = await rpc("decide_faculty_teaching_request", [
    request.request_id,
    "approved",
    "home college approved",
  ]);
  assert.equal(approval.action, "created");
  await assert.rejects(
    rpc("decide_faculty_teaching_request", [request.request_id, "approved", "again"]),
    /REQUEST_ALREADY_DECIDED/,
  );
  const load = await rpc("compute_instructor_standard_workload", [id(101), id(301)]);
  assert.equal(load.standard_assigned_hours, 6, "equivalent term IDs and all linked records");
  assert.deepEqual(load.hours_by_college, [], "college manager has no cross-college details");
  await actor(1);
  const report = await rpc("get_faculty_university_report", [id(101), id(301), []]);
  assert.equal(report.quota, 12);
  assert.equal(report.assigned_hours, 6);
  assert.equal(report.sessions.length, 1);
  assert.equal(report.selected_version_ids.length, 2);
  assert.equal(report.unscheduled.length, 1);
  assert.deepEqual(
    (await db.query("select jsonb_agg(s order by id) value from schedule_sessions s")).rows,
    before.rows,
  );
  await actor(3);
  await assert.rejects(
    rpc("get_faculty_university_report", [id(102), id(302), []]),
    /REQUIRES_ACCESS/,
  );
  // New foreign rows and direct external writes cannot bypass canonical registration/approval.
  await assert.rejects(
    db.query(
      "insert into instructors(college_id,affiliation_college_id,full_name) values($1,$2,'TEST_ONLY bypass')",
      [id(20), id(10)],
    ),
    /أضف المحاضر/,
  );
  await assert.rejects(
    db.query(
      "update teaching_assignments set assigned_component_hours=2,weekly_hours=2 where id=$1",
      [approval.assignment_id],
    ),
    /اعتماد التكليف/,
  );
  await actor(1);
  await rpc("reconcile_faculty_home", [
    id(203),
    id(30),
    id(103),
    false,
    "validated home, pending official quota",
    null,
  ]);
  let h = (await rpc("get_faculty_home_profiles", [null])).find((h) => h.identity_id === id(203));
  assert.equal(h.quota, null);
  await assert.rejects(
    rpc("reconcile_faculty_home", [
      id(203),
      id(30),
      id(103),
      true,
      "official quota verified",
      null,
    ]),
    /STALE_FACULTY_DECISION/,
  );
  await rpc("reconcile_faculty_home", [
    id(203),
    id(30),
    id(103),
    true,
    "official quota verified",
    h.decision_at,
  ]);
  h = (await rpc("get_faculty_home_profiles", [null])).find((h) => h.identity_id === id(203));
  assert.equal(h.quota, 18);
  await db.query("update instructors set max_weekly_hours=20 where id=$1", [id(103)]);
  h = (await rpc("get_faculty_home_profiles", [null])).find((h) => h.identity_id === id(203));
  assert.equal(h.quota, null, "source change invalidates old quota approval");
  await db.exec("reset role;set role anon");
  await assert.rejects(rpc("get_faculty_home_profiles", [null]), /permission denied/);
  await db.close();
});

test("faculty requests: update approval, rejection, stale context, source scope and alias collision", async () => {
  const { db, actor, rpc, ins } = await fixture();
  await actor(1);
  const created = await rpc("create_teaching_assignment_v2", [id(362), id(101), 3, null]);
  assert.equal(created.action, "created", "admin approves directly");
  await actor(3);
  let a = (
    await db.query("select * from teaching_assignments where id=$1", [created.assignment_id])
  ).rows[0];
  const pending = await rpc("update_teaching_assignment_v2", [
    a.id,
    a.updated_at,
    2,
    "reduce requested",
  ]);
  assert.equal(pending.action, "requested");
  assert.equal(
    Number(
      (
        await db.query("select assigned_component_hours h from teaching_assignments where id=$1", [
          a.id,
        ])
      ).rows[0].h,
    ),
    3,
  );
  await actor(2);
  await rpc("decide_faculty_teaching_request", [
    pending.request_id,
    "rejected",
    "hours remain as assigned",
  ]);
  await actor(3);
  const next = await rpc("update_teaching_assignment_v2", [a.id, a.updated_at, 2, null]);
  await actor(2);
  const updated = await rpc("decide_faculty_teaching_request", [
    next.request_id,
    "approved",
    "home confirms revised hours",
  ]);
  assert.equal(updated.action, "updated");
  await actor(1);
  await assert.rejects(
    rpc("create_teaching_assignment_v2", [id(362), id(102), 1, null]),
    /DUPLICATE_ACTIVE_ASSIGNMENT/,
  );
  await actor(3);
  a = (await db.query("select * from teaching_assignments where id=$1", [a.id])).rows[0];
  const stale = await rpc("update_teaching_assignment_v2", [a.id, a.updated_at, 1, null]);
  await db.exec("reset role");
  await db.query("update plan_course_components set weekly_contact_hours=4 where id=$1", [id(352)]);
  await actor(2);
  await assert.rejects(
    rpc("decide_faculty_teaching_request", [
      stale.request_id,
      "approved",
      "approve changed context",
    ]),
    /REQUEST_CONTEXT_CHANGED/,
  );
  await actor(3);
  await rpc("decide_faculty_teaching_request", [
    stale.request_id,
    "cancelled",
    "cancel obsolete request",
  ]);
  await db.exec("reset role");
  await ins("schedule_sessions", {
    id: id(502),
    college_id: id(20),
    schedule_version_id: id(372),
    instructor_id: id(102),
    course_offering_id: id(342),
    delivery_group_id: id(362),
    day_of_week: 1,
    start_time: "09:00",
    end_time: "10:00",
  });
  await assert.rejects(
    db.query("select schedule_coordination_private.check_version($1)", [id(371)]),
    /CROSS_COLLEGE_INSTRUCTOR_CONFLICT/,
  );
  await db.query("update schedule_sessions set start_time='11:00',end_time='12:00' where id=$1", [
    id(502),
  ]);
  await db.query("select schedule_coordination_private.check_version($1)", [id(371)]);
  await actor(3);
  await assert.rejects(
    db.query("update instructors set max_weekly_hours=99 where id=$1", [id(102)]),
    /الكلية الأصلية/,
  );
  await assert.rejects(
    rpc("reconcile_faculty_home", [id(201), id(20), id(102), true, "claim foreign home", null]),
    /insufficient_privilege/,
  );
  await db.close();
});

test("faculty policy: university load ceiling, pending quota and permission boundary", async () => {
  const { db, actor, rpc } = await fixture();
  await actor(1);
  // Both equivalent terms contribute to a single limit (0 approved hours + 12 extra).
  await db.query("update instructors set max_weekly_hours=0 where id=$1", [id(101)]);
  await db.exec("reset role");
  await db.query("update plan_course_components set weekly_contact_hours=15 where id=$1", [
    id(352),
  ]);
  await actor(1);
  await assert.rejects(
    rpc("create_teaching_assignment_v2", [id(362), id(101), 13, null]),
    /EXTRA_HOURS_LIMIT_EXCEEDED/,
  );
  assert.equal(
    (await db.query("select count(*)::int n from teaching_assignments")).rows[0].n,
    1,
    "failed approval rolls back assignment",
  );
  assert.equal(
    (await rpc("list_faculty_teaching_requests", [id(10)])).length,
    0,
    "failed admin request rolls back entirely",
  );
  await assert.rejects(
    rpc("create_teaching_assignment_v2", [id(362), id(103), 3, null]),
    /INSTRUCTOR_QUOTA_REQUIRED/,
  );
  const matches = await rpc("find_faculty_for_registration", [id(10), "TEST_ONLY", null]);
  assert.equal(matches.length, 4, "matches are identities, never raw duplicates");
  assert.ok(
    matches.every((m) => Object.keys(m).sort().join(",") === "home_college,name,university_number"),
  );
  await actor(6);
  await assert.rejects(
    rpc("find_faculty_for_registration", [id(20), "TEST_ONLY", null]),
    /insufficient_privilege/,
  );
  await db.exec("reset role;set role anon");
  await assert.rejects(
    db.query("select faculty_private.apply_create_assignment($1,$2,3,null)", [id(362), id(101)]),
    /permission denied/,
  );
  await db.close();
});

test("faculty identity: employment source, history, shared groups and session-only scope", async () => {
  const { db, actor, rpc, ins } = await fixture();
  await actor(1);
  await ins("instructor_types", { id: id(801), college_id: id(10), code: "annual_contract" });
  await ins("instructor_types", { id: id(802), college_id: id(20), code: "con" });
  await db.query("update instructors set instructor_type_id=$1 where id=$2", [id(801), id(101)]);
  const number = (
    await db.query("select university_number from faculty_identities where id=$1", [id(201)])
  ).rows[0].university_number;
  assert.match(number, /^U-C-/);
  assert.equal(
    (
      await db.query("select count(*)::int n from faculty_number_history where identity_id=$1", [
        id(201),
      ])
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    db.query("update instructors set instructor_type_id=$1 where id=$2", [id(802), id(102)]),
    /الكلية الأصلية/,
  );
  assert.equal(
    (await db.query("select university_number from faculty_identities where id=$1", [id(201)]))
      .rows[0].university_number,
    number,
  );
  await ins("academic_programs", { id: id(900), college_id: id(10), name: "برنامج مشارك" });
  await ins("academic_cohorts", {
    id: id(901),
    college_id: id(10),
    term_id: id(301),
    program_id: id(900),
  });
  await ins("delivery_groups", {
    id: id(902),
    college_id: id(10),
    cohort_id: id(901),
    group_code: "SHARED",
    component_id: id(351),
    active: true,
  });
  await ins("shared_lecture_links", {
    anchor_group_id: id(361),
    member_group_id: id(902),
    college_id: id(10),
  });
  let report = await rpc("get_faculty_university_report", [id(101), id(301), []]);
  assert.equal(report.sessions.length, 1, "one shared lecture remains one session");
  assert.match(report.sessions[0].program, /برنامج مشارك/);
  assert.match(report.sessions[0].group_name, /SHARED/);
  await ins("academic_terms", {
    id: id(303),
    college_id: id(30),
    name: "الأول 2026-2027",
    academic_year: "2026-2027",
    term_type: "first",
  });
  await ins("schedule_versions", {
    id: id(373),
    college_id: id(30),
    academic_term_id: id(303),
    name: "منشور",
    status: "published",
  });
  await ins("schedule_sessions", {
    id: id(503),
    college_id: id(30),
    schedule_version_id: id(373),
    instructor_id: id(104),
    day_of_week: 2,
    start_time: "08:00",
    end_time: "09:00",
  });
  report = await rpc("get_faculty_university_report", [id(104), id(301), []]);
  assert.equal(report.sessions.length, 1, "session-only teaching college is included");
  assert.ok(report.selected_version_ids.includes(id(373)));
  await actor(2);
  await assert.rejects(
    rpc("get_faculty_university_report", [id(104), id(301), []]),
    /REQUIRES_ACCESS/,
  );
  await db.close();
});

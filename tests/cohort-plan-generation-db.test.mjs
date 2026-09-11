import test, { before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = process.env.COHORT_GENERATION_TEST_DATABASE_URL;
const url = target ? new URL(target) : null;
if (
  process.env.COHORT_GENERATION_TEST_DISPOSABLE !== "1" ||
  !url ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/cohort_generation_test"
) {
  throw new Error("A disposable localhost cohort_generation_test database is required");
}
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const args = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--dbname", target];
function sql(s) {
  const r = spawnSync("psql", args, { input: s, encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout.trim();
}
const id = (s) => `md5('${s}')::uuid`;
const manager = `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',md5('manager'),true);`;
const generate = (cohort = "regular") => `public.generate_cohort_delivery_groups(${id(cohort)})`;
const curriculum = (cohort = "regular") => `public.generate_cohort_curriculum(${id(cohort)})`;
before(() => {
  assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"), "0");
  sql(`
    CREATE SCHEMA auth;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE FUNCTION can_manage_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u=md5('manager')::uuid AND c=md5('college')::uuid $$;
    CREATE FUNCTION can_view_college(u uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u IN(md5('manager')::uuid,md5('viewer')::uuid) AND c=md5('college')::uuid $$;
    CREATE TABLE academic_terms(id uuid PRIMARY KEY,college_id uuid,term_type text);
    CREATE TABLE academic_cohorts(id uuid PRIMARY KEY,college_id uuid,program_id uuid,level_id uuid,term_id uuid,study_system text,expected_students int,active boolean);
    CREATE TABLE study_plans(id uuid PRIMARY KEY,college_id uuid,program_id uuid,code text,is_active boolean,created_at timestamptz DEFAULT now());
    CREATE TABLE courses(id uuid PRIMARY KEY,college_id uuid,code text,name text);
    CREATE TABLE plan_courses(id uuid PRIMARY KEY,college_id uuid,study_plan_id uuid REFERENCES study_plans,level_id uuid,semester int,course_id uuid REFERENCES courses,is_required boolean);
    CREATE TABLE room_types(id uuid PRIMARY KEY,college_id uuid,default_capacity int,strict_capacity boolean,is_active boolean);
    CREATE TABLE plan_course_components(id uuid PRIMARY KEY,college_id uuid,plan_course_id uuid REFERENCES plan_courses,component_type text,weekly_contact_hours numeric,required_room_type_id uuid REFERENCES room_types,explicit_group_size int,is_timetabled boolean,counts_toward_regular_load boolean);
    CREATE TABLE elective_slots(id uuid PRIMARY KEY,college_id uuid,study_plan_id uuid,level_id uuid,semester int,active boolean,slot_code text);
    CREATE TABLE elective_slot_courses(id uuid PRIMARY KEY,college_id uuid,elective_slot_id uuid,course_id uuid,active boolean);
    CREATE TABLE cohort_elective_selections(id uuid PRIMARY KEY,college_id uuid,cohort_id uuid,elective_slot_id uuid,selected_course_id uuid,decided_at timestamptz,decided_by uuid);
    CREATE TABLE course_offerings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),college_id uuid,term_id uuid,course_id uuid REFERENCES courses,program_id uuid,level_id uuid,study_system text,study_plan_id uuid REFERENCES study_plans,plan_course_id uuid REFERENCES plan_courses,expected_students int,sections_count int,status text,is_active boolean,notes text,enrollment_count_status text,created_at timestamptz DEFAULT now(), UNIQUE(college_id,term_id,program_id,level_id,study_system,course_id));
    CREATE TABLE delivery_groups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),college_id uuid,cohort_id uuid REFERENCES academic_cohorts,plan_course_id uuid REFERENCES plan_courses,component_id uuid REFERENCES plan_course_components,group_code text,group_number int,expected_students int,capacity_limit int,active boolean,excluded_from_standard_workload boolean,is_obsolete boolean,UNIQUE(cohort_id,component_id,group_number));
    CREATE TABLE teaching_assignments(id uuid PRIMARY KEY,delivery_group_id uuid REFERENCES delivery_groups);
    CREATE TABLE schedule_sessions(id uuid PRIMARY KEY,delivery_group_id uuid REFERENCES delivery_groups);
    CREATE TABLE audit_logs(actor_id uuid,action text,entity text,entity_id uuid,college_id uuid,details jsonb);
    CREATE TABLE scheduling_cohort_term_headcounts(id uuid PRIMARY KEY,college_id uuid,cohort_id uuid,term_id uuid,approval_status text,scheduling_headcount int,exam_eligible_count int,reserve_margin int);
    CREATE TABLE scheduling_headcount_overrides(id uuid PRIMARY KEY,headcount_id uuid,course_offering_id uuid,plan_course_component_id uuid,active boolean,approval_status text,scheduling_headcount int,exam_eligible_count int,reserve_margin int);
    INSERT INTO academic_terms VALUES(${id("term")},${id("college")},'first');
    INSERT INTO study_plans(id,college_id,program_id,code,is_active) VALUES
      (${id("new")},${id("college")},${id("program")},'NEW',true),
      (${id("old")},${id("college")},${id("program")},'OLD',true);
    INSERT INTO courses VALUES(${id("course")},${id("college")},'TEST101','TEST_ONLY'),(${id("oldcourse")},${id("college")},'TEST301','TEST_ONLY old');
    INSERT INTO plan_courses VALUES
      (${id("pc")},${id("college")},${id("new")},${id("level1")},1,${id("course")},true),
      (${id("oldpc")},${id("college")},${id("old")},${id("level3")},1,${id("oldcourse")},true);
    INSERT INTO room_types VALUES(${id("lecture")},${id("college")},60,false,true),(${id("lab")},${id("college")},30,true,true);
    INSERT INTO plan_course_components VALUES
      (${id("theory")},${id("college")},${id("pc")},'theory',2,${id("lecture")},NULL,true,true),
      (${id("practical")},${id("college")},${id("pc")},'practical',2,${id("lab")},NULL,true,true),
      (${id("oldtheory")},${id("college")},${id("oldpc")},'theory',2,${id("lecture")},NULL,true,true);
    INSERT INTO academic_cohorts VALUES
      (${id("regular")},${id("college")},${id("program")},${id("level1")},${id("term")},'regular',999,true),
      (${id("parallel")},${id("college")},${id("program")},${id("level1")},${id("term")},'parallel',25,true),
      (${id("senior")},${id("college")},${id("program")},${id("level3")},${id("term")},'regular',58,true),
      (${id("foreign")},${id("othercollege")},${id("program")},${id("level1")},${id("term")},'regular',68,true);
    INSERT INTO scheduling_cohort_term_headcounts SELECT id,college_id,id,term_id,'approved',CASE WHEN id=${id("regular")} THEN 68 ELSE expected_students END,68,0 FROM academic_cohorts;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
  `);
  // The actual approved-headcount resolver, rather than a test stub.
  sql(read("tests/fixtures/cohort-generation-headcount-resolver.sql"));
  sql(read("supabase/sql/cohort_level_plan_generation.sql"));
  assert.equal(
    read("supabase/sql/cohort_level_plan_generation.sql"),
    read("supabase/migrations/20260911183000_cohort_level_plan_generation.sql"),
  );
});
function check(name, setup, body, actor = "manager") {
  test(name, () =>
    sql(
      `BEGIN; ${setup} ${actor === "manager" ? manager : `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',md5('${actor}'),true);`} DO $$ DECLARE a jsonb; b jsonb; n int; BEGIN ${body} END $$; ROLLBACK;`,
    ),
  );
}
check(
  "one click selects junior plan, uses approved 68 not legacy 999, balances and retries",
  "",
  `
  a := ${generate()};
  IF a->'curriculum'->>'study_plan_code'<>'NEW' OR (a->>'groups_created')::int<>5 THEN RAISE EXCEPTION 'bad generation %',a; END IF;
  IF (SELECT array_agg(expected_students ORDER BY group_number) FROM delivery_groups WHERE component_id=${id("theory")})<>ARRAY[34,34] THEN RAISE EXCEPTION 'lecture split'; END IF;
  IF (SELECT array_agg(expected_students ORDER BY group_number) FROM delivery_groups WHERE component_id=${id("practical")})<>ARRAY[23,23,22] THEN RAISE EXCEPTION 'lab split'; END IF;
  b := ${generate()};
  IF b->>'status'<>'NO_CHANGES' OR (b->>'groups_unchanged')::int<>5 OR (SELECT count(*) FROM course_offerings)<>1 OR (SELECT count(*) FROM delivery_groups)<>5 THEN RAISE EXCEPTION 'non-idempotent'; END IF;
  IF (SELECT expected_students FROM academic_cohorts WHERE id=${id("regular")})<>999 THEN RAISE EXCEPTION 'source count modified'; END IF;
`,
);
check(
  "senior plan and parallel delivery stay isolated",
  "",
  `
  a := ${generate("senior")}; b := ${generate("parallel")};
  IF a->'curriculum'->>'study_plan_code'<>'OLD' OR b->'curriculum'->>'study_plan_code'<>'NEW' THEN RAISE EXCEPTION 'wrong plan'; END IF;
  IF (SELECT count(*) FROM delivery_groups WHERE cohort_id=${id("regular")})<>0 OR (SELECT count(*) FROM delivery_groups WHERE cohort_id=${id("parallel")})<>2 THEN RAISE EXCEPTION 'cohort leakage'; END IF;
`,
);
check(
  "three separate cyber plans select by level despite creation order",
  `
  INSERT INTO study_plans VALUES(${id("level2plan")},${id("college")},${id("program")},'LEVEL2',true,'2000-01-01');
  INSERT INTO plan_courses VALUES(${id("level2pc")},${id("college")},${id("level2plan")},${id("level2")},1,${id("course")},true);
  UPDATE academic_cohorts SET level_id=${id("level2")} WHERE id=${id("regular")};
`,
  `a := ${curriculum()}; IF a->>'study_plan_code'<>'LEVEL2' THEN RAISE EXCEPTION 'latest plan picked'; END IF;`,
);
check(
  "overlapping active plans are blocked without writes",
  `
  INSERT INTO plan_courses VALUES(${id("overlap")},${id("college")},${id("old")},${id("level1")},1,${id("oldcourse")},true);
`,
  `BEGIN PERFORM ${generate()}; RAISE EXCEPTION 'accepted'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'STUDY_PLAN_AMBIGUOUS_FOR_COHORT_LEVEL_TERM' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM course_offerings)<>0 OR (SELECT count(*) FROM audit_logs)<>0 THEN RAISE EXCEPTION 'partial writes'; END IF;`,
);
check(
  "missing level or semester reports a blocker instead of current",
  `UPDATE academic_terms SET term_type='second';`,
  `
  BEGIN PERFORM ${generate()}; RAISE EXCEPTION 'accepted'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'STUDY_PLAN_MISSING_FOR_COHORT_LEVEL_TERM' THEN RAISE; END IF; END;`,
);
check(
  "inactive or missing program plan is blocked",
  `UPDATE study_plans SET is_active=false;`,
  `
  BEGIN PERFORM ${generate()}; RAISE EXCEPTION 'accepted'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'STUDY_PLAN_MISSING_FOR_COHORT_PROGRAM' THEN RAISE; END IF; END;`,
);
check(
  "empty required curriculum does not report success",
  `UPDATE plan_courses SET is_required=false WHERE id=${id("pc")};`,
  `
  BEGIN PERFORM ${curriculum()}; RAISE EXCEPTION 'accepted'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'COHORT_CURRICULUM_EMPTY' THEN RAISE; END IF; END;`,
);
check(
  "missing capacity rolls back curriculum and audit",
  `UPDATE room_types SET default_capacity=NULL WHERE id=${id("lab")};`,
  `
  BEGIN PERFORM ${generate()}; RAISE EXCEPTION 'accepted'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'DELIVERY_GROUP_CAPACITY_INVALID' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM course_offerings)<>0 OR (SELECT count(*) FROM delivery_groups)<>0 OR (SELECT count(*) FROM audit_logs)<>0 THEN RAISE EXCEPTION 'partial write'; END IF;`,
);
check(
  "no timetabled components rolls back and reports explicit cause",
  `UPDATE plan_course_components SET is_timetabled=false;`,
  `
  BEGIN PERFORM ${generate()}; RAISE EXCEPTION 'accepted'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'COHORT_TIMETABLED_COMPONENTS_EMPTY' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM course_offerings)<>0 THEN RAISE EXCEPTION 'partial curriculum'; END IF;`,
);
check(
  "unapproved count cannot generate through direct RPC",
  `UPDATE scheduling_cohort_term_headcounts SET approval_status='draft';`,
  `
  BEGIN PERFORM ${generate()}; RAISE EXCEPTION 'accepted'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'SCHEDULING_HEADCOUNT_MISSING' THEN RAISE; END IF; END;`,
);
check(
  "component override applies only to the target component",
  `INSERT INTO scheduling_headcount_overrides VALUES(${id("override")},${id("regular")},NULL,${id("practical")},true,'approved',25,NULL,NULL);`,
  `
  a := ${generate()}; IF (a->>'groups_created')::int<>3 OR (SELECT sum(expected_students) FROM delivery_groups WHERE component_id=${id("practical")})<>25 OR (SELECT sum(expected_students) FROM delivery_groups WHERE component_id=${id("theory")})<>68 THEN RAISE EXCEPTION 'override leaked'; END IF;`,
);
check(
  "existing offerings from another plan are not overwritten",
  `INSERT INTO course_offerings(college_id,term_id,program_id,level_id,study_system,study_plan_id,is_active) VALUES(${id("college")},${id("term")},${id("program")},${id("level1")},'regular',${id("old")},true);`,
  `
  BEGIN PERFORM ${generate()}; RAISE EXCEPTION 'accepted'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'COHORT_EXISTING_PLAN_CONFLICT' THEN RAISE; END IF; END;
  IF (SELECT count(*) FROM course_offerings)<>1 OR (SELECT count(*) FROM delivery_groups)<>0 THEN RAISE EXCEPTION 'existing data mutated'; END IF;`,
);
check(
  "foreign college and nonexistent cohorts have identical denial",
  "",
  `
  BEGIN PERFORM ${generate("foreign")}; RAISE EXCEPTION 'accepted'; EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'COHORT_NOT_FOUND_OR_FORBIDDEN' THEN RAISE; END IF; END;
  BEGIN PERFORM ${generate("absent")}; RAISE EXCEPTION 'accepted'; EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'COHORT_NOT_FOUND_OR_FORBIDDEN' THEN RAISE; END IF; END;
  IF has_function_privilege('anon','public.generate_cohort_delivery_groups(uuid)','EXECUTE') THEN RAISE EXCEPTION 'anonymous grant'; END IF;`,
);
check(
  "view-only user cannot generate curriculum or groups",
  "",
  `
  BEGIN PERFORM ${generate()}; RAISE EXCEPTION 'accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM ${curriculum()}; RAISE EXCEPTION 'accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;`,
  "viewer",
);
check(
  "draft elective decision blocks generation",
  `INSERT INTO cohort_elective_selections(id,college_id,cohort_id) VALUES(${id("selection")},${id("college")},${id("regular")});`,
  `
  BEGIN PERFORM ${generate()}; RAISE EXCEPTION 'accepted'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'ELECTIVE_DECISION_NOT_APPROVED' THEN RAISE; END IF; END;`,
);
check(
  "linked obsolete groups remain and are flagged after a count reduction",
  `
  SELECT set_config('request.jwt.claim.sub',md5('manager'),true);
  SELECT ${generate()};
  INSERT INTO teaching_assignments SELECT ${id("assignment")},id FROM delivery_groups WHERE component_id=${id("practical")} AND group_number=3;
  UPDATE scheduling_cohort_term_headcounts SET scheduling_headcount=25 WHERE cohort_id=${id("regular")};
`,
  `a := ${generate()}; IF (SELECT count(*) FROM delivery_groups)<>5 OR (SELECT count(*) FROM teaching_assignments)<>1 OR (a->>'groups_obsolete')::int<>3 THEN RAISE EXCEPTION 'links lost'; END IF;`,
);

test("concurrent retries serialize without duplicate offerings or groups", async () => {
  const first = spawn("psql", args, { stdio: ["pipe", "pipe", "pipe"] });
  let err = "";
  first.stderr.on("data", (chunk) => {
    err += chunk;
  });
  const done = new Promise((resolve) => first.on("close", resolve));
  first.stdin.end(`BEGIN; ${manager} SELECT ${generate()}; SELECT pg_sleep(1); COMMIT;`);
  let locked = false;
  for (let i = 0; i < 100; i++) {
    if (
      sql(
        "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND classid=9262 AND objid=1 AND granted",
      ) === "1"
    ) {
      locked = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(locked, "first generation did not obtain its lock");
  const second = spawnSync("psql", args, {
    input: `BEGIN; ${manager} SELECT ${generate()}; COMMIT;`,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(await done, 0, err);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(sql("SELECT count(*) FROM course_offerings"), "1");
  assert.equal(sql("SELECT count(*) FROM delivery_groups"), "5");
});

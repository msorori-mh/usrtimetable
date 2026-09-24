import test, { before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeCourseNature } from "../src/lib/excel-import/course-nature.ts";
const target = process.env.PLAN_IMPORT_TEST_DATABASE_URL;
const url = target ? new URL(target) : null;
if (
  process.env.PLAN_IMPORT_TEST_DISPOSABLE !== "1" ||
  !url ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.pathname !== "/plan_import_test"
)
  throw new Error("A disposable localhost plan_import_test database is required");
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(root + path, "utf8");
function sql(source) {
  const r = spawnSync(
    "psql",
    ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--dbname", target],
    { input: source, encoding: "utf8", timeout: 30000 },
  );
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout.trim();
}
before(() => {
  assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"), "0");
  // Reuse the existing atomic-import proof schema, without its data/test cases.
  const setup = read("tests/fixtures/import-atomic-commit/proof.sql").split(
    "\\ir ./20260718180000_import_manifest_contract.sql",
  )[0];
  sql(
    setup
      .replaceAll(
        "CREATE ROLE anon NOLOGIN;",
        () =>
          "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF; END $$;",
      )
      .replaceAll(
        "CREATE ROLE authenticated NOLOGIN;",
        () =>
          "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;",
      )
      .replaceAll(
        "CREATE ROLE service_role NOLOGIN;",
        () =>
          "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF; END $$;",
      ),
  );
  sql(read("supabase/migrations/20260718180000_import_manifest_contract.sql"));
  sql(read("supabase/migrations/20260718210000_source_only_atomic_import_job_commit.sql"));
  sql(`ALTER TABLE courses ADD CONSTRAINT courses_course_nature_check CHECK (course_nature IN ('department','college','university'));
    CREATE TABLE room_types(id uuid PRIMARY KEY,college_id uuid NOT NULL,code text,is_active boolean,default_capacity int);
    ALTER TABLE plan_course_components ADD COLUMN required_room_type_id uuid;
    ALTER TABLE plan_courses ALTER COLUMN lecture_session_duration TYPE numeric, ALTER COLUMN lab_session_duration TYPE numeric;
    CREATE SCHEMA test_support;
    CREATE FUNCTION test_support.id(t text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT md5(t)::uuid $$;
    CREATE FUNCTION test_support.assert(b boolean,m text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF b IS DISTINCT FROM true THEN RAISE EXCEPTION '%',m; END IF; END $$;
    INSERT INTO room_types VALUES(test_support.id('lecture'),test_support.id('college'),'lecture_hall',true,60),(test_support.id('lab'),test_support.id('college'),'computer_lab',true,30),(test_support.id('foreign'),test_support.id('other'),'lecture_hall',true,60);
    INSERT INTO plan_courses(id,college_id,lectures_per_week,labs_per_week,lecture_session_duration,lab_session_duration) VALUES(test_support.id('pc'),test_support.id('college'),0,0,2,2);`);
  const name = readdirSync(root + "supabase/migrations").find((n) =>
    n.endsWith("_study_plan_component_import_sync.sql"),
  );
  assert.ok(name);
  assert.equal(
    read("supabase/migrations/" + name),
    read("supabase/sql/study_plan_component_import_sync.sql"),
  );
  sql(read("supabase/migrations/" + name));
});
const id = (s) => `test_support.id('${s}')`;
const sync = (v, college = "college") =>
  `PERFORM public._import_sync_plan_course_components(${id(college)},${id("pc")},${v});`;
const component = (type, hours, room = "lecture", timetabled = true) =>
  `jsonb_build_object('component_type','${type}','weekly_contact_hours',${hours},'is_timetabled',${timetabled},'required_room_type_id',${room ? id(room) : "NULL"})`;
const payload = (hours = 2, room = "lecture") =>
  `jsonb_build_object('theory_hours',${hours},'_plan_component_sync',jsonb_build_array(${component("theory", hours, room)}))`;
function check(name, body) {
  test(name, () => sql(`BEGIN; DO $$ BEGIN ${body} END $$; ROLLBACK;`));
}
check(
  "resolved room references and lecture/tutorial/practical counts survive save and retry",
  `
  ${sync(`jsonb_build_object('theory_hours',2,'tutorial_hours',2,'practical_hours',3,'_plan_component_sync',jsonb_build_array(${component("theory", 2)},${component("tutorial", 2)},${component("practical", 3, "lab")}))`)}
  PERFORM test_support.assert((SELECT count(*)=3 AND count(required_room_type_id)=3 FROM plan_course_components),'room refs lost');
  PERFORM test_support.assert((SELECT lectures_per_week=2 AND labs_per_week=1 AND lab_session_duration=3 FROM plan_courses WHERE id=${id("pc")}), 'incorrect counters');
  ${sync(payload())}
  PERFORM test_support.assert((SELECT count(*)=3 FROM plan_course_components),'retry duplicated components');
`,
);
check(
  "practical-only, zero-hour project and summer-training semantics match preview",
  `
  ${sync(`jsonb_build_object('practical_hours',2,'is_graduation_project',true,'_plan_component_sync',jsonb_build_array(${component("practical", 2, "lab")},${component("project", 0, null, false)}))`)}
  PERFORM test_support.assert((SELECT lectures_per_week=0 AND labs_per_week=1 FROM plan_courses WHERE id=${id("pc")}), 'practical-only counters');
  PERFORM test_support.assert((SELECT NOT is_timetabled FROM plan_course_components WHERE component_type='project'), 'zero project timetabled');
  ${sync(`jsonb_build_object('is_summer_training',true,'training_hours',6,'_plan_component_sync',jsonb_build_array(${component("summer_training", 6, null, false)}))`)}
  PERFORM test_support.assert((SELECT NOT is_timetabled AND required_room_type_id IS NULL FROM plan_course_components WHERE component_type='summer_training'),'summer flags');
`,
);
for (const [name, value, setup = "", college = "college"] of [
  ["foreign room", payload(2, "foreign")],
  ["missing room", payload(2, null)],
  ["inactive room", payload(), `UPDATE room_types SET is_active=false WHERE id=${id("lecture")};`],
  [
    "zero capacity",
    payload(),
    `UPDATE room_types SET default_capacity=0 WHERE id=${id("lecture")};`,
  ],
  [
    "preview hours drift",
    `jsonb_build_object('theory_hours',3,'_plan_component_sync',jsonb_build_array(${component("theory", 2)}))`,
  ],
  ["foreign plan course", payload(), "", "other"],
])
  check(
    `${name} rejects atomically`,
    `${setup}
  BEGIN ${sync(value, college)} RAISE EXCEPTION 'unexpected success'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM test_support.assert((SELECT count(*)=0 FROM plan_course_components),'partial component write');
  PERFORM test_support.assert((SELECT lectures_per_week=0 FROM plan_courses WHERE id=${id("pc")}), 'counter mutated');
`,
  );
check(
  "failure in a second component rolls back an already-written first component",
  `
  BEGIN
    ${sync(`jsonb_build_object('theory_hours',2,'practical_hours',2,'_plan_component_sync',jsonb_build_array(${component("theory", 2)},${component("practical", 2, "foreign")}))`)}
    RAISE EXCEPTION 'unexpected success';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM test_support.assert((SELECT count(*)=0 FROM plan_course_components),'partial write survived');
`,
);
check(
  "legacy count-only imports retain their pattern and explicit durations are preferred",
  `
  UPDATE plan_courses SET lectures_per_week=3,lecture_session_duration=1 WHERE id=${id("pc")};
  ${sync("'{}'::jsonb")}
  PERFORM test_support.assert((SELECT lectures_per_week=3 FROM plan_courses WHERE id=${id("pc")}), 'legacy pattern erased');
  ${sync(payload(3))}
  PERFORM test_support.assert((SELECT lectures_per_week=3 AND lecture_session_duration=1 FROM plan_courses WHERE id=${id("pc")}), 'duration preference lost');
`,
);
check(
  "actual study-plan importer saves room types and derives counters on insert and update",
  `
  PERFORM public._import_apply_study_plan(${id("college")},'upsert',jsonb_build_array(jsonb_build_object('values',${payload(3)} || jsonb_build_object('_program_id',${id("program")},'plan_code','TEST_ONLY','course_code','TEST_ONLY','course_name','Test course','level_number',1,'semester',1))));
  PERFORM test_support.assert((SELECT count(*)=1 FROM plan_courses WHERE course_id IS NOT NULL AND lectures_per_week=1 AND lecture_session_duration=3),'import counters');
  PERFORM public._import_apply_study_plan(${id("college")},'update_existing',jsonb_build_array(jsonb_build_object('values',${payload(2)} || jsonb_build_object('_program_id',${id("program")},'plan_code','TEST_ONLY','course_code','TEST_ONLY','course_name','Test course','level_number',1,'semester',1))));
  PERFORM test_support.assert((SELECT count(*)=1 FROM plan_courses WHERE course_id IS NOT NULL AND lectures_per_week=1 AND lecture_session_duration=2),'updated import counters');
`,
);
check(
  "internal helper remains unavailable to anonymous and authenticated callers",
  `
  PERFORM test_support.assert(NOT has_function_privilege('anon','public._import_sync_plan_course_components(uuid,uuid,jsonb)','EXECUTE'),'anon execute');
  PERFORM test_support.assert(NOT has_function_privilege('authenticated','public._import_sync_plan_course_components(uuid,uuid,jsonb)','EXECUTE'),'authenticated execute');
  PERFORM test_support.assert(has_function_privilege('service_role','public._import_sync_plan_course_components(uuid,uuid,jsonb)','EXECUTE'),'service_role grant lost');
`,
);

test("six normalized legacy rows survive atomic preview, commit and retry with the production constraint", () => {
  const nature = normalizeCourseNature("faculty");
  assert.equal(nature, "college");
  sql(`BEGIN; DO $$ DECLARE job uuid; result jsonb; rows jsonb; BEGIN
    INSERT INTO user_roles(user_id,role) VALUES(${id("actor")},'super_admin');
    PERFORM set_config('test.uid',${id("actor")}::text,true);
    SELECT jsonb_agg(jsonb_build_object('rowNumber',n+1,'values',${payload()} || jsonb_build_object(
      '_program_id',${id("program")},'plan_code','TEST_ONLY_NATURE','course_code','TEST_ONLY_NATURE_'||n,
      'course_name','Test nature course','course_nature','${nature}','level_number',3,'semester',1)))
      INTO rows FROM generate_series(1,6) n;
    job := public.create_import_preview_manifest(${id("college")},'study_plan_courses','upsert','TEST_ONLY.xlsx',6,rows,'[]'::jsonb);
    result := public.commit_import_job_atomic(job,NULL);
    PERFORM test_support.assert(result->>'status'='ok' AND (result->>'inserted')::int=6,'atomic import did not save six rows');
    PERFORM test_support.assert((SELECT count(*)=6 FROM courses WHERE course_nature='college'),'canonical nature lost');
    PERFORM test_support.assert((SELECT count(*)=6 FROM plan_courses WHERE course_id IS NOT NULL),'plan links missing');
    result := public.commit_import_job_atomic(job,NULL);
    PERFORM test_support.assert((result->>'replay')::boolean,'retry was not replay');
    PERFORM test_support.assert((SELECT count(*)=6 FROM courses),'retry duplicated courses');
  END $$; ROLLBACK;`);
});

check(
  "an unnormalized later faculty row reproduces the database error and rolls back the entire import",
  `
  BEGIN
    PERFORM public._import_apply_study_plan(${id("college")},'upsert',jsonb_build_array(
      jsonb_build_object('values',${payload()} || jsonb_build_object('_program_id',${id("program")},'plan_code','TEST_ONLY_REJECT','course_code','TEST_ONLY_FIRST','course_name','First','course_nature','department')),
      jsonb_build_object('values',${payload()} || jsonb_build_object('_program_id',${id("program")},'plan_code','TEST_ONLY_REJECT','course_code','TEST_ONLY_BAD','course_name','Second','course_nature','faculty'))
    ));
    RAISE EXCEPTION 'unexpected success';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM test_support.assert((SELECT count(*)=0 FROM courses),'partial courses survived');
  PERFORM test_support.assert((SELECT count(*)=0 FROM study_plans),'partial study plan survived');
`,
);

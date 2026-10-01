import test, { before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = process.env.PLAN_RETIRE_TEST_DATABASE_URL;
const url = target ? new URL(target) : null;
if (
  process.env.PLAN_RETIRE_TEST_DISPOSABLE !== "1" ||
  !url ||
  !["localhost", "127.0.0.1"].includes(url.hostname) ||
  url.pathname !== "/plan_retire_test"
) {
  throw new Error("A disposable localhost plan_retire_test database is required");
}
const root = fileURLToPath(new URL("../", import.meta.url));
const id = (s) => `md5('${s}')::uuid`;
const manager = `SET LOCAL ROLE authenticated;
  SELECT set_config('request.jwt.claim.sub', md5('manager'), true);`;
function sql(input) {
  const r = spawnSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--dbname", target], {
    input, encoding: "utf8", timeout: 30000,
  });
  assert.equal(r.status, 0, r.stderr || String(r.error));
  return r.stdout.trim();
}

before(() => {
  assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"), "0");
  sql(`
    CREATE SCHEMA auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
    END $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION public.can_manage_college(u uuid, c uuid)
      RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT u = md5('manager')::uuid AND c = md5('college')::uuid $$;
    CREATE TABLE public.colleges(id uuid PRIMARY KEY);
    CREATE TABLE public.study_plans (
      id uuid PRIMARY KEY, college_id uuid NOT NULL, program_id uuid, name text,
      code text, version text, effective_year integer, is_active boolean NOT NULL,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.plan_courses(id uuid PRIMARY KEY, study_plan_id uuid REFERENCES study_plans, college_id uuid);
    CREATE TABLE public.plan_course_components(id uuid PRIMARY KEY, plan_course_id uuid REFERENCES plan_courses);
    CREATE TABLE public.elective_slots(id uuid PRIMARY KEY, study_plan_id uuid REFERENCES study_plans);
    CREATE TABLE public.elective_slot_courses(id uuid PRIMARY KEY, elective_slot_id uuid REFERENCES elective_slots);
    CREATE TABLE public.academic_cohorts(id uuid PRIMARY KEY, study_plan_id uuid);
    CREATE TABLE public.course_offerings(id uuid PRIMARY KEY, study_plan_id uuid, plan_course_id uuid);
    CREATE TABLE public.delivery_groups(id uuid PRIMARY KEY, plan_course_id uuid);
    CREATE TABLE public.cohort_elective_selections(id uuid PRIMARY KEY, elective_slot_id uuid);
    CREATE TABLE public.existing_schedule_source_rows(
      id uuid PRIMARY KEY, study_plan_id uuid, plan_course_id uuid, component_id uuid
    );
    CREATE TABLE public.audit_logs(actor_id uuid, action text, entity text,
      entity_id uuid, college_id uuid, details jsonb);
    CREATE TABLE public.schedule_versions(
      id uuid PRIMARY KEY, college_id uuid, academic_term_id uuid, name text,
      status text, notes text, created_by uuid, created_at timestamptz DEFAULT now(),
      is_coordination boolean DEFAULT false
    );
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.study_plans TO authenticated;
    GRANT SELECT ON public.schedule_versions TO authenticated;
    GRANT UPDATE (name, notes) ON public.schedule_versions TO authenticated;
    INSERT INTO colleges VALUES (${id("college")}),(${id("foreign")});
    INSERT INTO study_plans(id,college_id,program_id,name,code,version,is_active) VALUES
      (${id("plan")},${id("college")},${id("program")},'Old','OLD','1',true),
      (${id("foreignplan")},${id("foreign")},${id("program")},'Other','OTHER','1',false);
    INSERT INTO plan_courses VALUES(${id("pc")},${id("plan")},${id("college")});
    INSERT INTO plan_course_components VALUES(${id("component")},${id("pc")});
    INSERT INTO elective_slots VALUES(${id("slot")},${id("plan")});
    INSERT INTO elective_slot_courses VALUES(${id("option")},${id("slot")});
    INSERT INTO academic_cohorts VALUES(${id("cohort")},${id("plan")});
    INSERT INTO schedule_versions(id,college_id,academic_term_id,name,status) VALUES
      (${id("version")},${id("college")},${id("term")},'Old schedule','archived'),
      (${id("published")},${id("college")},${id("term")},'Current','published');
  `);
  sql(readFileSync(root + "supabase/migrations/20261001010000_study_plan_archive_delete.sql", "utf8"));
  sql(readFileSync(root + "supabase/migrations/20261001011000_retire_archived_schedule_versions.sql", "utf8"));
  sql(`CREATE TRIGGER trg_sv_immutability BEFORE UPDATE ON public.schedule_versions
    FOR EACH ROW EXECUTE FUNCTION public.enforce_schedule_version_immutability();`);
});

test("active plan cannot be archived; archived plan with a cohort cannot be deleted", () => {
  const out = sql(`BEGIN; ${manager}
    DO $$ BEGIN
      BEGIN PERFORM public.archive_study_plan(${id("plan")});
        RAISE EXCEPTION 'active accepted';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'PLAN_DEACTIVATE_BEFORE_ARCHIVE' THEN RAISE; END IF;
      END;
    END $$;
    UPDATE public.study_plans SET is_active=false WHERE id=${id("plan")};
    SELECT public.archive_study_plan(${id("plan")})->>'can_delete';
    DO $$ BEGIN
      BEGIN PERFORM public.delete_archived_study_plan(${id("plan")});
        RAISE EXCEPTION 'cohort reference accepted';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE 'PLAN_DELETE_BLOCKED:%' THEN RAISE; END IF;
      END;
    END $$;
    SELECT count(*) FROM public.study_plans WHERE id=${id("plan")};
    ROLLBACK;`);
  assert.match(out, /false\s+1/);
});

test("unused archived plan is removed atomically with a preserved plan snapshot", () => {
  const out = sql(`BEGIN;
    UPDATE public.study_plans SET is_active=false WHERE id=${id("plan")};
    DELETE FROM public.academic_cohorts WHERE id=${id("cohort")};
    ${manager}
    SELECT public.archive_study_plan(${id("plan")})->>'can_delete';
    SELECT public.delete_archived_study_plan(${id("plan")})->>'deleted';
    SELECT count(*) FROM public.study_plans WHERE id=${id("plan")};
    RESET ROLE;
    SELECT jsonb_array_length(payload->'components')
      FROM public.deleted_study_plan_archives WHERE study_plan_id=${id("plan")};
    ROLLBACK;`);
  assert.match(out, /true\s+true\s+0\s+1/);
});

test("retirement is reversible and restricted to archived versions in the managed college", () => {
  const out = sql(`BEGIN; ${manager}
    SELECT public.set_archived_schedule_version_retired(${id("version")},true)->>'retired';
    SELECT retired_at IS NOT NULL FROM public.schedule_versions WHERE id=${id("version")};
    SELECT public.set_archived_schedule_version_retired(${id("version")},false)->>'retired';
    DO $$ BEGIN
      BEGIN PERFORM public.set_archived_schedule_version_retired(${id("published")},true);
        RAISE EXCEPTION 'published accepted';
      EXCEPTION WHEN check_violation THEN
        IF SQLERRM <> 'VERSION_RETIRE_REQUIRES_ARCHIVED_NON_COORDINATION' THEN RAISE; END IF;
      END;
    END $$;
    ROLLBACK;`);
  assert.match(out, /true\s+t\s+false/);
});

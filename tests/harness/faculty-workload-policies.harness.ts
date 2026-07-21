/**
 * A3 / TRACK 4: Faculty workload policies (source-only) — static harness.
 *
 * Validates supabase/migrations/20260722110000_source_only_faculty_workload_policies.sql
 * and its PHASE-9.3 dependency by static inspection only. No DB connection,
 * no Supabase client, no runtime gates.
 */
import { readFileSync, existsSync } from "node:fs";

const MIG = "supabase/migrations/20260722110000_source_only_faculty_workload_policies.sql";
const DEP93 = "supabase/migrations/20260716233716_73dc0ba0-e4ba-43be-8628-ef2c36564a62.sql";

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
}

const migExists = existsSync(MIG);
check("migration file exists", migExists, MIG);
const depExists = existsSync(DEP93);
check("phase 9.3 dependency migration exists", depExists, DEP93);

if (migExists && depExists) {
  const sql = readFileSync(MIG, "utf8");
  const dep = readFileSync(DEP93, "utf8");

  // Source-only header and apply gate
  check("SOURCE ONLY header", sql.includes("SOURCE ONLY"), "source-only banner");
  check("NOT APPLIED header", sql.includes("NOT APPLIED"), "not-applied banner");
  check(
    "apply gate marker",
    sql.includes("APPROVE_DB_MIGRATION_APPLY"),
    "APPROVE_DB_MIGRATION_APPLY gate in header",
  );

  // Extends, not recreates
  check(
    "extends existing table (ALTER)",
    /ALTER TABLE public\.faculty_workload_policies/i.test(sql),
    "ALTER TABLE public.faculty_workload_policies",
  );
  check(
    "does not recreate table",
    !/CREATE TABLE public\.faculty_workload_policies/i.test(sql),
    "no CREATE TABLE (owned by PHASE-9.3)",
  );
  check(
    "phase 9.3 owns table create",
    /CREATE TABLE public\.faculty_workload_policies/i.test(dep),
    "20260716233716 creates faculty_workload_policies",
  );

  // New policy dimensions (النصاب حسب الدرجة الأكاديمية + نظام الدراسة + الفصل)
  check("rank_label_ar column", /ADD COLUMN IF NOT EXISTS rank_label_ar/i.test(sql), "الدرجة الأكاديمية label");
  check("study_system column", /ADD COLUMN IF NOT EXISTS study_system/i.test(sql), "study-system scope");
  check("min_load_hours column", /ADD COLUMN IF NOT EXISTS min_load_hours/i.test(sql), "min bound");
  check("max_load_hours column", /ADD COLUMN IF NOT EXISTS max_load_hours/i.test(sql), "max bound");
  check("overload_allowed flag", /ADD COLUMN IF NOT EXISTS overload_allowed/i.test(sql), "overload flag");
  check("term_id column", /ADD COLUMN IF NOT EXISTS term_id uuid/i.test(sql), "effective term scope");
  check(
    "composite term FK",
    /FOREIGN KEY \(term_id, college_id\)[\s\S]*REFERENCES public\.academic_terms \(id, college_id\)/i.test(sql),
    "(term_id, college_id) -> academic_terms(id, college_id)",
  );

  // Grain
  check(
    "legacy grain dropped",
    /DROP CONSTRAINT IF EXISTS fwp_unique/i.test(sql),
    "UNIQUE(college_id, rank_code) replaced",
  );
  check(
    "new unique grain index",
    /CREATE UNIQUE INDEX IF NOT EXISTS fwp_college_rank_system_term_uniq/i.test(sql) &&
      /college_id,[\s\S]*rank_code,[\s\S]*COALESCE\(study_system, ''\),[\s\S]*COALESCE\(term_id/i.test(sql),
    "(college_id, rank_code, study_system, term_id) with COALESCE sentinels",
  );

  // RLS / isolation (owned by PHASE-9.3; verified on dependency)
  check(
    "RLS enabled (dependency)",
    /ENABLE ROW LEVEL SECURITY/i.test(dep) && /faculty_workload_policies/i.test(dep),
    "faculty_workload_policies RLS in 20260716233716",
  );
  check(
    "college isolation + role checks (dependency)",
    dep.includes("can_view_college") && dep.includes("can_manage_college"),
    "can_view_college / can_manage_college policies",
  );

  // Write-path hardening
  check(
    "direct writes revoked",
    /REVOKE INSERT, UPDATE, DELETE ON public\.faculty_workload_policies FROM authenticated, anon, PUBLIC/i.test(sql),
    "writes only via gated RPCs",
  );

  // SECURITY DEFINER RPCs + function-level revokes/grants
  check(
    "definer search_path hygiene",
    sql.includes("SECURITY DEFINER") && sql.includes("SET search_path = public, pg_temp"),
    "pinned search_path",
  );
  for (const fn of [
    "upsert_faculty_workload_policy",
    "deactivate_faculty_workload_policy",
    "resolve_faculty_workload_policy",
    "list_faculty_workload_assigned_hours",
    "list_faculty_workload_overload_warnings",
  ]) {
    check(`RPC ${fn} defined`, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(`, "i").test(sql), fn);
    check(`RPC ${fn} revoked+granted`, sql.includes(`REVOKE ALL ON FUNCTION public.${fn}`) && sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn}`), `${fn} PUBLIC/anon revoked, authenticated granted`);
  }

  // Assigned-hours source wiring (verified V2 source, no legacy sections)
  check(
    "assigned-hours source is V2 view",
    sql.includes("public.v_instructor_delivery_workload"),
    "aggregates teaching_assignments V2 via PHASE-9.3/9.4 view",
  );
  check(
    "no legacy sections references",
    !/public\.sections\b/i.test(sql) && !/course_offering_sections/i.test(sql) && !/section_number/i.test(sql),
    "no public.sections / course_offering_sections / section_number",
  );

  // Audit on policy change
  check(
    "audit on upsert",
    sql.includes("faculty_workload_policy_upsert") && /INSERT INTO public\.audit_logs/i.test(sql),
    "audit_logs insert in upsert RPC",
  );
  check("audit on deactivate", sql.includes("faculty_workload_policy_deactivated"), "audit_logs insert in deactivate RPC");

  // No top-level seed/backfill DML (only inside function bodies)
  const topLevel = sql.split(/CREATE OR REPLACE FUNCTION/i)[0];
  check(
    "no top-level policy seed/backfill",
    !/INSERT INTO public\.faculty_workload_policies/i.test(topLevel) &&
      !/UPDATE public\.faculty_workload_policies\s+SET/i.test(topLevel),
    "policy rows are user-entered only",
  );
}

const failed = checks.filter((c) => !c.ok);
for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  — ${c.detail}`);
}
console.log(
  JSON.stringify({
    harness: "faculty-workload-policies",
    checksRun: checks.length,
    failed: failed.length,
    mode: "static-only",
  }),
);
if (failed.length > 0) process.exit(1);

/**
 * Static domain-contract harness — entities, SoT classifications, mandatory model checks.
 * Read-only against generated types + import registry + programs route.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const types = read("src/integrations/supabase/types.ts");
const requiredTables = [
  "universities",
  "colleges",
  "departments",
  "academic_programs",
  "academic_terms",
  "courses",
  "study_plans",
  "plan_courses",
  "plan_course_components",
  "elective_slots",
  "academic_cohorts",
  "cohort_elective_selections",
  "course_offerings",
  "sections",
  "course_offering_sections",
  "delivery_groups",
  "instructors",
  "faculty_workload_policies",
  "teaching_assignments",
  "rooms",
  "time_slots",
  "time_slot_templates",
  "daily_breaks",
  "instructor_availability",
  "room_unavailability",
  "scheduling_settings",
  "college_constraint_settings",
  "schedule_versions",
  "schedule_sessions",
  "schedule_quality_runs",
  "conflict_checks",
  "conflict_results",
  "import_jobs",
  "audit_logs",
  "profiles",
  "user_roles",
  "user_colleges",
];

for (const t of requiredTables) {
  assert.ok(types.includes(`${t}: {`), `types missing table ${t}`);
}

assert.ok(!types.includes("academic_years: {"), "academic_years must not be a table");

const programs = read("src/routes/_authenticated/programs.tsx");
assert.ok(
  programs.includes('if (!form.name.trim() || !form.code.trim() || !form.department_id)'),
  "programs UI must require department_id",
);

const registry = read("src/lib/excel-import/registry.ts");
for (const entity of [
  "academic_terms",
  "full_study_plan",
  "academic_cohorts",
  "teaching_assignments_v2",
]) {
  assert.ok(registry.includes(`"${entity}"`), `ACTIVE flow missing ${entity}`);
}
for (const legacy of ["sections", "course_offerings", "teaching_assignments", "section_groups"]) {
  assert.ok(registry.includes(`"${legacy}"`), `LEGACY list missing ${legacy}`);
}
for (const gen of ["delivery_groups", "cohort_curriculum", "schedule_sessions"]) {
  assert.ok(registry.includes(`"${gen}"`), `GENERATED list missing ${gen}`);
}

const migrationSnippet = read(
  "supabase/migrations/20260604225017_41baaa6b-647b-4c2f-bd10-32d352b9c8f6.sql",
);
assert.ok(
  migrationSnippet.includes("department_id uuid NOT NULL REFERENCES public.departments"),
  "DB must enforce program.department_id NOT NULL",
);

console.log(
  JSON.stringify(
    {
      harness: "domain-contract-static",
      tablesChecked: requiredTables.length,
      programDepartmentRequired: true,
      academicYearsTable: false,
      status: "pass",
    },
    null,
    2,
  ),
);

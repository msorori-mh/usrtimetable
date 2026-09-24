/**
 * POSTGREST-RELATIONSHIP-DISAMBIGUATION-SWEEP-01 — static guard for composite FK embed hints.
 * Fails on unqualified PostgREST embeds for child→parent pairs with duplicate FKs after
 * migration 20260717050000_source_only_harden_cross_college_references.sql.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/** Child table queries that must use composite FK hints when embedding parent tables. */
const MULTI_RELATIONSHIP_PAIRS = [
  { child: "academic_cohorts", parent: "academic_programs", fk: "ac_program_college_fkey" },
  { child: "academic_cohorts", parent: "academic_levels", fk: "ac_level_college_fkey" },
  { child: "academic_cohorts", parent: "academic_terms", fk: "ac_term_college_fkey" },
  {
    child: "plan_course_components",
    parent: "plan_courses",
    fk: "pcc_plan_course_college_fkey",
  },
  {
    child: "plan_course_components",
    parent: "room_types",
    fk: "pcc_room_type_college_fkey",
  },
  {
    child: "delivery_groups",
    parent: "plan_course_components",
    fk: "dg_component_college_fkey",
  },
  { child: "delivery_groups", parent: "academic_cohorts", fk: "dg_cohort_college_fkey" },
  { child: "delivery_groups", parent: "plan_courses", fk: "dg_plan_course_college_fkey" },
  {
    child: "teaching_assignments",
    parent: "academic_cohorts",
    fk: "ta_cohort_college_fkey",
  },
  {
    child: "teaching_assignments",
    parent: "plan_course_components",
    fk: "ta_component_college_fkey",
  },
  {
    child: "teaching_assignments",
    parent: "delivery_groups",
    fk: "ta_delivery_group_college_fkey",
  },
  { child: "schedule_sessions", parent: "academic_cohorts", fk: "ss_cohort_college_fkey" },
  {
    child: "schedule_sessions",
    parent: "plan_course_components",
    fk: "ss_component_college_fkey",
  },
  { child: "schedule_sessions", parent: "delivery_groups", fk: "ss_delivery_group_college_fkey" },
] as const;

const SCAN_PATHS = [
  "src/routes/_authenticated/academic-cohorts.tsx",
  "src/routes/_authenticated/data-readiness.tsx",
  "src/routes/_authenticated/reports.data-readiness.tsx",
  "src/routes/_authenticated/delivery-groups.tsx",
  "src/routes/_authenticated/teaching-assignments.tsx",
  "src/lib/reports/readiness.ts",
  "src/lib/academic-delivery/cohort-delivery-group-room-type-gate.ts",
  "src/lib/academic-delivery/cohort-curriculum-plan-courses.ts",
  "src/lib/academic-delivery/plan-component-room-type-readiness.ts",
  "src/lib/academic-delivery/generate-delivery-groups.ts",
  "src/lib/schedule-builder/queries.ts",
];

function extractSelectBodies(src: string, childTable: string): string[] {
  const bodies: string[] = [];
  const fromRe = new RegExp(`\\.from\\(["']${childTable}["']\\)`, "g");
  let fromMatch: RegExpExecArray | null;
  while ((fromMatch = fromRe.exec(src)) !== null) {
    const slice = src.slice(fromMatch.index, fromMatch.index + 1600);
    const selectMatch = slice.match(/\.select\s*\(\s*(["'`])([\s\S]*?)\1/s);
    if (selectMatch?.[2]) bodies.push(selectMatch[2]);
  }
  return bodies;
}

function findUnqualifiedEmbeds(selectBody: string, parentTable: string, fkName: string): string[] {
  const tokenRe = new RegExp(`(?:\\w+:)?${parentTable}(?:!${fkName})?\\(`, "g");
  const violations: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(selectBody)) !== null) {
    if (!match[0].includes(`!${fkName}`)) violations.push(match[0]);
  }
  return violations;
}

function scanFile(rel: string) {
  const src = read(rel);
  for (const { child, parent, fk } of MULTI_RELATIONSHIP_PAIRS) {
    for (const body of extractSelectBodies(src, child)) {
      const violations = findUnqualifiedEmbeds(body, parent, fk);
      assert(
        violations.length === 0,
        `${rel}: unqualified ${parent} embed from ${child} (expected !${fk}); found ${violations.join(", ")}`,
      );
    }
  }
}

function run() {
  const migration = read(
    "supabase/migrations/20260717050000_source_only_harden_cross_college_references.sql",
  );
  assert(migration.includes("ac_program_college_fkey"), "migration lists ac_program_college_fkey");
  assert(
    (migration.match(/ac_program_college_fkey/g) ?? []).length >= 2,
    "migration defines ac_program_college_fkey twice (preflight + apply)",
  );

  for (const rel of SCAN_PATHS) {
    scanFile(rel);
  }

  const gate = read("src/lib/academic-delivery/cohort-delivery-group-room-type-gate.ts");
  assert(
    !gate.includes('from("course_offerings")'),
    "cohort gate does not query legacy course_offerings",
  );
  assert(
    gate.includes("resolveCohortCurriculumPlanCourses"),
    "cohort gate uses plan_courses curriculum resolver",
  );

  const curriculum = read("src/lib/academic-delivery/cohort-curriculum-plan-courses.ts");
  assert(
    curriculum.includes("academic_programs!ac_program_college_fkey(name)"),
    "curriculum resolver disambiguates academic_programs",
  );
  assert(
    !curriculum.includes("academic_programs(name)"),
    "curriculum resolver has no bare academic_programs embed",
  );

  const readiness = read("src/lib/academic-delivery/plan-component-room-type-readiness.ts");
  assert(
    readiness.includes("plan_courses!pcc_plan_course_college_fkey("),
    "readiness disambiguates plan_courses",
  );
  assert(
    readiness.includes("room_types!pcc_room_type_college_fkey("),
    "readiness disambiguates room_types",
  );

  const cohorts = read("src/routes/_authenticated/academic-cohorts.tsx");
  assert(
    cohorts.includes("plan_course_components!dg_component_college_fkey("),
    "cohorts page disambiguates plan_course_components",
  );

  const scheduleQueries = read("src/lib/schedule-builder/queries.ts");
  assert(
    scheduleQueries.includes("no PostgREST embeds") ||
      scheduleQueries.includes("PGRST200") ||
      !scheduleQueries.includes("schedule_sessions("),
    "schedule builder avoids ambiguous session embeds",
  );

  console.log("postgrest-relationship-disambiguation.harness.ts: all assertions passed");
}

run();

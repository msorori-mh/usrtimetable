import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = join(
  root,
  "supabase/migrations/20260717050000_source_only_harden_cross_college_references.sql",
);

assert(existsSync(migration), "source-only migration exists");
const sql = readFileSync(migration, "utf8");

assert(sql.includes("SOURCE-ONLY / DO NOT AUTO-APPLY"), "migration is explicitly source-only");
assert(sql.includes("BEGIN;") && sql.includes("COMMIT;"), "migration is transactional");
assert(sql.includes("CROSS_COLLEGE_PREFLIGHT_FAILED"), "invalid existing rows abort preflight");
assert(sql.includes("CROSS_COLLEGE_PREFLIGHT_MISSING_TABLE"), "incomplete history fails closed");
assert(sql.includes("CROSS_COLLEGE_POSTCHECK_FAILED"), "validated constraints are postchecked");
assert(
  sql.includes("CROSS_COLLEGE_CONSTRAINT_NAME_COLLISION"),
  "wrong same-name constraint aborts",
);
assert(!/\b(INSERT|UPDATE|DELETE)\s+(INTO\s+|FROM\s+)?public\./i.test(sql), "no business DML");
assert(!/ON\s+DELETE\s+(CASCADE|SET\s+NULL)/i.test(sql), "no destructive delete behavior");
assert(!/ON\s+UPDATE\s+CASCADE/i.test(sql), "parent identity/college updates never cascade");
assert(!/DROP\s+CONSTRAINT/i.test(sql), "name collisions are never replaced automatically");

const refs = [
  ["academic_cohorts", "program_id", "academic_programs"],
  ["academic_cohorts", "level_id", "academic_levels"],
  ["academic_cohorts", "term_id", "academic_terms"],
  ["plan_course_components", "plan_course_id", "plan_courses"],
  ["plan_course_components", "required_room_type_id", "room_types"],
  ["elective_slots", "study_plan_id", "study_plans"],
  ["elective_slots", "level_id", "academic_levels"],
  ["elective_slot_courses", "elective_slot_id", "elective_slots"],
  ["elective_slot_courses", "course_id", "courses"],
  ["cohort_elective_selections", "cohort_id", "academic_cohorts"],
  ["cohort_elective_selections", "elective_slot_id", "elective_slots"],
  ["cohort_elective_selections", "selected_course_id", "courses"],
  ["delivery_groups", "cohort_id", "academic_cohorts"],
  ["delivery_groups", "plan_course_id", "plan_courses"],
  ["delivery_groups", "component_id", "plan_course_components"],
  ["teaching_assignments", "cohort_id", "academic_cohorts"],
  ["teaching_assignments", "plan_course_component_id", "plan_course_components"],
  ["teaching_assignments", "delivery_group_id", "delivery_groups"],
  ["schedule_sessions", "cohort_id", "academic_cohorts"],
  ["schedule_sessions", "plan_course_component_id", "plan_course_components"],
  ["schedule_sessions", "delivery_group_id", "delivery_groups"],
];

for (const [child, column, parent] of refs) {
  assert(sql.includes(`('${child}','${column}','${parent}'`), `${child}.${column} is covered`);
}

assert(
  (sql.match(/FOREIGN KEY \(%I, college_id\)/g) ?? []).length === 1,
  "generic composite FK DDL",
);
assert(
  sql.includes("REFERENCES public.%I (id, college_id) ON DELETE RESTRICT NOT VALID"),
  "new writes are protected before validation",
);
assert(sql.includes("VALIDATE CONSTRAINT %I"), "all constraints are validated");
assert(sql.includes("UNIQUE (id, college_id)"), "parent college changes are protected");
assert(sql.includes("c.%I IS NOT NULL"), "nullable references retain MATCH SIMPLE behavior");
assert(sql.includes("FROM pg_attribute"), "catalog column identities are resolved by attnum");
assert(sql.includes("c.conkey = ARRAY["), "ordered child columns are catalog-verified");
assert(sql.includes("c.confkey = ARRAY["), "ordered parent columns are catalog-verified");
assert(
  sql.includes("c.confrelid = format('public.%I', r.parent_table)::regclass"),
  "parent relation is catalog-verified",
);
assert(sql.includes("c.contype = 'f'"), "constraint type is catalog-verified");
assert(sql.includes("c.confdeltype = 'r'"), "RESTRICT behavior is catalog-verified");
assert(sql.includes("c.confupdtype = 'a'"), "ON UPDATE NO ACTION is catalog-verified");
assert(sql.includes("AND c.convalidated"), "validation state is checked per mapping");
assert(!sql.includes("c.conname IN ("), "postcheck does not use an ANY-name list");

const postcheckInsideMappingLoop =
  sql.indexOf("CROSS_COLLEGE_POSTCHECK_FAILED") >
  sql.indexOf("FOR r IN", sql.indexOf("Composite referenced keys"));
assert(postcheckInsideMappingLoop, "postcheck executes for every mapping");

console.log("cross-college reference integrity source contract: PASS");
console.log(
  "NOTE: catalog contract is static; ephemeral PostgreSQL integration remains required before merge/apply.",
);

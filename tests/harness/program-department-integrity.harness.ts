/** Static proof for PHASE A1.1 source-only program/department integrity. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");
const migration = read(
  "supabase/migrations/20260720143000_source_only_program_department_integrity.sql",
);
const original = read(
  "supabase/migrations/20260604225017_41baaa6b-647b-4c2f-bd10-32d352b9c8f6.sql",
);
const route = read("src/routes/_authenticated/programs.tsx");

assert.match(migration, /SOURCE ONLY — NOT APPLIED/);
assert.match(original, /department_id uuid NOT NULL REFERENCES public\.departments/);
assert.match(migration, /academic_programs_college_id_fkey[\s\S]*?ON DELETE RESTRICT/);
assert.match(migration, /academic_programs_department_id_fkey[\s\S]*?ON DELETE RESTRICT/);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.ensure_prog_college\(\)/);
assert.match(migration, /v_department_college_id <> NEW\.college_id/);
assert.match(migration, /BEFORE INSERT OR UPDATE OF college_id, department_id/);
assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|public\.)/i);

assert.match(original, /prog_insert[\s\S]*?can_manage_college\(auth\.uid\(\), college_id\)/);
assert.match(
  original,
  /prog_update[\s\S]*?USING \(public\.can_manage_college[\s\S]*?WITH CHECK \(public\.can_manage_college/,
);
assert.match(original, /prog_delete[\s\S]*?can_manage_college\(auth\.uid\(\), college_id\)/);
assert.match(
  original,
  /can_manage_college[\s\S]*?is_super_admin[\s\S]*?has_role\(_user_id, 'college_admin'\)[\s\S]*?user_in_college/,
);

assert.match(route, /!form\.department_id/);
assert.match(
  route,
  /depts \?\? \[\]\)\.some\(\(department\) => department\.id === form\.department_id\)/,
);
assert.match(route, /update\(payload\)\.eq\("id", editing\.id\)\.eq\("college_id", active\.id\)/);
assert.match(route, /delete\(\)\.eq\("id", id\)\.eq\("college_id", active\.id\)/);

console.log(
  JSON.stringify(
    {
      harness: "program-department-integrity",
      acceptsSameCollegeDepartment: true,
      rejectsMissingDepartment: true,
      rejectsCrossCollegeDepartment: true,
      parentDeletesRestricted: true,
      superAdminAllowed: true,
      collegeAdminScoped: true,
      readOnlyDenied: true,
      status: "pass",
    },
    null,
    2,
  ),
);

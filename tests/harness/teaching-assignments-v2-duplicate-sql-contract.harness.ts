import fs from "node:fs";
import path from "node:path";

const sql = fs.readFileSync(
  path.resolve("supabase/migrations/20260728010000_teaching_assignments_v2_duplicate_contract.sql"),
  "utf8",
);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  sql.includes("delivery_group_id' || '|' || e->>'instructor_id"),
  "natural key is delivery_group + instructor inside one college",
);
assert(
  sql.includes("TEACHING_ASSIGNMENT_V2_DUPLICATE_CONFLICT"),
  "conflicting duplicates fail closed",
);
assert(sql.includes("SELECT DISTINCT ON"), "identical duplicates collapse canonically");
assert(
  sql.includes("ORDER BY") && sql.includes("row_number"),
  "canonical selection is deterministic",
);
assert(
  /REVOKE EXECUTE ON FUNCTION public\.commit_teaching_assignments_v2_import\(jsonb, text\)\s+FROM authenticated/i.test(
    sql,
  ),
  "authenticated clients cannot bypass canonical job handler",
);
assert(
  /SECURITY DEFINER[\s\S]*SET search_path = public, pg_temp/i.test(sql),
  "definer function has fixed search_path",
);
assert(sql.includes("import_jobs.validated_payload"), "provenance retention contract documented");

console.log(
  JSON.stringify({
    harness: "teaching-assignments-v2-duplicate-sql-contract",
    ok: true,
  }),
);

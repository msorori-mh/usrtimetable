/**
 * PHASE-7-TERM-REFERENCE-REMEDIATION-MIGRATION-DESIGN-01
 * Source-only contract checks — no DB apply / no runtime writes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

const MIG = "supabase/migrations/20260715200500_remediate_course_offering_term_references.sql";
const FIX_COUNTS = "tests/fixtures/term-reference-remediation/expected-counts.sql";
const FIX_POST = "tests/fixtures/term-reference-remediation/postcheck.sql";

const REMAP = "ca5146f1-2f61-46e7-be4b-2a29099d2d23";
const DELETE_TERM = "3e59d219-bfde-435f-a65e-cc55876c64ab";
const TARGET = "18dd364a-76d7-40b8-a217-fa929c082a7f";

function run() {
  assert(existsSync(join(root, MIG)), "migration present");
  assert(existsSync(join(root, FIX_COUNTS)), "expected-counts fixture");
  assert(existsSync(join(root, FIX_POST)), "postcheck fixture");

  const sql = read(MIG);
  const counts = read(FIX_COUNTS);

  assert(sql.includes("BEGIN;") && sql.includes("COMMIT;"), "single explicit transaction");
  assert(sql.includes(REMAP) && sql.includes(DELETE_TERM) && sql.includes(TARGET), "term uuids");

  // Expected counts
  assert(sql.includes("c_expect_total              constant integer := 213"), "total 213");
  assert(sql.includes("c_expect_remap              constant integer := 84"), "remap 84");
  assert(sql.includes("c_expect_delete             constant integer := 129"), "delete 129");
  assert(sql.includes("c_expect_delete_ta          constant integer := 163"), "delete TA 163");
  assert(sql.includes("c_expect_delete_cos         constant integer := 129"), "delete COS 129");
  assert(sql.includes("c_expect_keep_ta            constant integer := 174"), "keep TA 174");
  assert(sql.includes("c_expect_keep_cos           constant integer := 5"), "keep COS 5");
  assert(counts.includes("213 AS course_offerings_total"), "fixture total");

  // Preflight RAISE paths (rollback on mismatch / unique conflict)
  for (const code of [
    "TERM_REMEDIATION_PREFLIGHT_TOTAL_MISMATCH",
    "TERM_REMEDIATION_PREFLIGHT_REMAP_COUNT_MISMATCH",
    "TERM_REMEDIATION_PREFLIGHT_DELETE_COUNT_MISMATCH",
    "TERM_REMEDIATION_PREFLIGHT_TARGET_TERM_MISSING",
    "TERM_REMEDIATION_PREFLIGHT_UNIQUE_CONFLICT",
    "TERM_REMEDIATION_PREFLIGHT_DELETE_SESSIONS_NONEMPTY",
    "TERM_REMEDIATION_PREFLIGHT_ORPHAN_MISMATCH",
    "TERM_REMEDIATION_PREFLIGHT_DELETE_TA_MISMATCH",
    "TERM_REMEDIATION_PREFLIGHT_DELETE_COS_MISMATCH",
    "TERM_REMEDIATION_PREFLIGHT_KEEP_TA_MISMATCH",
    "TERM_REMEDIATION_PREFLIGHT_KEEP_COS_MISMATCH",
  ]) {
    assert(sql.includes(code), `preflight abort ${code}`);
  }
  assert(sql.includes("USING ERRCODE = 'unique_violation'"), "unique conflict rolls back");

  // Remap only 84
  assert(
    sql.includes("SET term_id = c_target_term") && sql.includes("AND term_id = c_remap_from"),
    "updates remap set only",
  );
  assert(!/UPDATE\s+public\.academic_terms/i.test(sql), "no academic_terms update");
  assert(!/INSERT\s+INTO\s+public\.academic_terms/i.test(sql), "no academic_terms insert");
  assert(!/DELETE\s+FROM\s+public\.academic_terms/i.test(sql), "no academic_terms delete");
  assert(!/DELETE\s+FROM\s+public\.rooms/i.test(sql), "no rooms delete");
  assert(!/DELETE\s+FROM\s+public\.courses\b/i.test(sql), "no courses delete");
  assert(!/DELETE\s+FROM\s+public\.instructors/i.test(sql), "no instructors delete");
  assert(!/UPDATE\s+public\.rooms/i.test(sql), "no rooms update");
  assert(!/UPDATE\s+public\.courses\b/i.test(sql), "no courses update");
  assert(!/UPDATE\s+public\.instructors/i.test(sql), "no instructors update");

  // Delete order + scoped to delete ids only
  const delTa = sql.indexOf("DELETE FROM public.teaching_assignments");
  const delCos = sql.indexOf("DELETE FROM public.course_offering_sections");
  const delSec = sql.indexOf("DELETE FROM public.sections s");
  const delOff = sql.lastIndexOf("DELETE FROM public.course_offerings");
  assert(delTa > 0 && delCos > delTa && delSec > delCos && delOff > delSec, "delete order");
  assert(sql.includes("WHERE course_offering_id = ANY (v_delete_ids)"), "scoped delete deps");
  assert(sql.includes("WHERE id = ANY (v_delete_ids)"), "scoped delete offerings");
  assert(sql.includes("v_shared_section_ids"), "shared section protection");
  assert(sql.includes("NOT (s.id = ANY (v_shared_section_ids))"), "never delete shared sections");
  assert(sql.includes("section_subgroups"), "subgroup guard");
  assert(sql.includes("section_group_members"), "section group members guard");
  assert(sql.includes("TERM_REMEDIATION_KEEP_SET_DEPENDENCIES_CHANGED"), "protect keep-set deps");

  // Postcheck + zero orphans
  for (const code of [
    "TERM_REMEDIATION_POSTCHECK_TOTAL_MISMATCH",
    "TERM_REMEDIATION_POSTCHECK_TARGET_TERM_MISMATCH",
    "TERM_REMEDIATION_POSTCHECK_ORPHANS_REMAIN",
    "TERM_REMEDIATION_POSTCHECK_DANGLING_DELETE_DEPS",
    "TERM_REMEDIATION_POSTCHECK_PROTECTED_DATA_CHANGED",
  ]) {
    assert(sql.includes(code), `postcheck ${code}`);
  }

  // VALIDATE only after postcheck; RESTRICT not CASCADE
  const postcheckIdx = sql.indexOf("TERM_REMEDIATION_POSTCHECK_PROTECTED_DATA_CHANGED");
  const validateIdx = sql.indexOf(
    "EXECUTE 'ALTER TABLE public.course_offerings VALIDATE CONSTRAINT course_offerings_term_id_fkey'",
  );
  assert(validateIdx > postcheckIdx && postcheckIdx > 0, "VALIDATE after postcheck");
  assert(sql.includes("TERM_REMEDIATION_FK_NOT_VALIDATED"), "requires convalidated");
  assert(sql.includes("TERM_REMEDIATION_FK_CASCADE_FORBIDDEN"), "forbids CASCADE");
  assert(sql.includes("TERM_REMEDIATION_FK_NOT_RESTRICT"), "requires RESTRICT");
  assert(!/ON DELETE CASCADE/i.test(sql), "no CASCADE clause");
  assert(
    sql.includes("confdeltype = 'r'") || sql.includes("v_confdeltype IS DISTINCT FROM 'r'"),
    "restrict check",
  );

  // Audits
  assert(sql.includes("'phase', 'before'"), "before audit");
  assert(sql.includes("'phase', 'after'"), "after audit");
  assert(sql.includes("'actor', 'migration_executor'"), "migration_executor");
  assert(sql.includes("'updated_offerings'"), "after updated_offerings");
  assert(sql.includes("'deleted_offerings'"), "after deleted_offerings");
  assert(sql.includes("'deleted_assignments'"), "after deleted_assignments");
  assert(sql.includes("'deleted_offering_sections'"), "after deleted_offering_sections");
  assert(sql.includes("'deleted_orphan_sections'"), "after deleted_orphan_sections");
  assert(sql.includes("'remaining_term_orphans'"), "after orphans");
  assert(sql.includes("'fk_validated', true"), "after fk_validated");
  assert(sql.includes("'result', 'success'"), "after success");
  assert(sql.includes("update_offering_ids"), "stores 84 ids");
  assert(sql.includes("delete_offering_ids"), "stores 129 ids");

  // Idempotency
  assert(sql.includes("idempotent_noop"), "safe idempotent noop");
  assert(sql.includes("TERM_REMEDIATION_PARTIAL_STATE"), "rejects partial re-apply");
  assert(
    sql.includes("TERM_REMEDIATION_FK_ALREADY_VALID_WITH_BAD_DATA"),
    "rejects validated+dirty",
  );

  // Ordering vs prior migrations
  assert("20260715200400" < "20260715200500", "migration order after cleanup");

  console.log("term-reference-remediation.harness.ts: PASS");
}

run();

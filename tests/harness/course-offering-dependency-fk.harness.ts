/**
 * PHASE-8-COURSE-OFFERING-DEPENDENCY-FK-DESIGN-01
 * Source-only contract checks — no DB apply / no runtime writes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OFFERING_IN_USE_DELETE_MESSAGE,
  formatBulkOfferingDeleteBlockedMessage,
  isOfferingInUse,
  isOfferingInUseDeleteError,
  planBulkOfferingDelete,
} from "../../src/lib/course-offerings/offering-delete-guard.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

const MIG = "supabase/migrations/20260715200600_harden_course_offering_dependencies.sql";
const GUARD = "src/lib/course-offerings/offering-delete-guard.ts";
const UI = "src/routes/_authenticated/course-offerings.tsx";

function run() {
  assert(existsSync(join(root, MIG)), "migration present");
  assert(existsSync(join(root, GUARD)), "delete guard present");
  assert(existsSync(join(root, UI)), "offerings UI present");

  const sql = read(MIG);
  const guard = read(GUARD);
  const ui = read(UI);

  assert(sql.includes("BEGIN;") && sql.includes("COMMIT;"), "explicit transaction");
  assert(
    !/DELETE\s+FROM\s+public\.(course_offerings|teaching_assignments|course_offering_sections|schedule_sessions)/i.test(
      sql,
    ),
    "no business deletes",
  );
  assert(
    !/UPDATE\s+public\.(course_offerings|teaching_assignments|course_offering_sections|schedule_sessions)/i.test(
      sql,
    ),
    "no business updates",
  );
  assert(
    !/INSERT\s+INTO\s+public\.(course_offerings|teaching_assignments|course_offering_sections|schedule_sessions)/i.test(
      sql,
    ),
    "no business inserts",
  );

  // Preflight counts
  assert(sql.includes("c_expect_offerings constant integer := 84"), "offerings 84");
  assert(sql.includes("c_expect_ta        constant integer := 174"), "ta 174");
  assert(sql.includes("c_expect_cos       constant integer := 5"), "cos 5");
  assert(sql.includes("c_expect_sessions  constant integer := 0"), "sessions 0");
  assert(sql.includes("COURSE_OFFERING_DEP_PREFLIGHT_TA_ORPHANS"), "ta orphan abort");
  assert(sql.includes("COURSE_OFFERING_DEP_PREFLIGHT_COS_ORPHANS"), "cos orphan abort");
  assert(sql.includes("COURSE_OFFERING_DEP_PREFLIGHT_SESSION_ORPHANS"), "session orphan abort");
  assert(sql.includes("course_offering_id IS NULL"), "null checks");

  // Index + FKs
  assert(sql.includes("idx_schedule_sessions_course_offering_id"), "session offering index");
  assert(sql.includes("teaching_assignments_course_offering_id_fkey"), "ta fk");
  assert(sql.includes("course_offering_sections_course_offering_id_fkey"), "cos fk");
  assert(sql.includes("schedule_sessions_course_offering_id_fkey"), "session fk");
  assert((sql.match(/ON DELETE RESTRICT/g) ?? []).length >= 3, "three RESTRICT FKs");
  assert(!/ON DELETE CASCADE/i.test(sql), "no CASCADE");
  assert(!/ON DELETE SET NULL/i.test(sql), "no SET NULL");
  assert(!/NOT VALID/i.test(sql), "validated immediately (no NOT VALID)");
  assert(sql.includes("COURSE_OFFERING_DEP_FK_NOT_VALIDATED"), "requires convalidated");
  assert(sql.includes("COURSE_OFFERING_DEP_FK_CASCADE_FORBIDDEN"), "forbids CASCADE");
  assert(sql.includes("COURSE_OFFERING_DEP_FK_SET_NULL_FORBIDDEN"), "forbids SET NULL");
  assert(sql.includes("COURSE_OFFERING_DEP_FK_NOT_RESTRICT"), "requires RESTRICT");
  assert(sql.includes("'fk_validated', true"), "audit validated");
  assert(sql.includes("'on_delete_behavior', 'RESTRICT'"), "audit RESTRICT");
  assert(sql.includes("idempotent_noop"), "safe re-apply");
  assert(sql.includes("'migration_executor'"), "migration_executor actor");

  // New orphan rejected: FK without NOT VALID means insert of missing parent fails
  assert(
    sql.includes("REFERENCES public.course_offerings(id)") && !/NOT VALID/i.test(sql),
    "orphan insert rejected by validated FK",
  );

  // Offerings UI is read-only (Phase 9.2); delete guard lives in offering-delete-guard.ts.
  assert(
    ui.includes("Read-only diagnostic") || ui.includes("manual Create/Edit/Delete/import disabled"),
    "offerings UI read-only diagnostic",
  );
  assert(guard.includes("teachingAssignmentCount"), "guard counts TA");
  assert(guard.includes("courseOfferingSectionCount"), "guard counts COS");
  assert(guard.includes("scheduleSessionCount"), "guard counts sessions");
  assert(guard.includes("offeringDeleteBlockedToastMessage"), "guard Arabic toast");
  assert(guard.includes("OFFERING_IN_USE"), "guard in-use gate");
  assert(guard.includes(OFFERING_IN_USE_DELETE_MESSAGE), "Arabic message constant");

  assert(
    isOfferingInUse({
      offeringId: "used",
      teachingAssignmentCount: 1,
      courseOfferingSectionCount: 0,
      scheduleSessionCount: 0,
    }),
    "used with TA blocked",
  );
  assert(
    isOfferingInUse({
      offeringId: "used-cos",
      teachingAssignmentCount: 0,
      courseOfferingSectionCount: 2,
      scheduleSessionCount: 0,
    }),
    "used with COS blocked",
  );
  assert(
    isOfferingInUse({
      offeringId: "used-ss",
      teachingAssignmentCount: 0,
      courseOfferingSectionCount: 0,
      scheduleSessionCount: 3,
    }),
    "used with sessions blocked",
  );
  assert(
    !isOfferingInUse({
      offeringId: "free",
      teachingAssignmentCount: 0,
      courseOfferingSectionCount: 0,
      scheduleSessionCount: 0,
    }),
    "unused offering allowed",
  );

  const plan = planBulkOfferingDelete([
    {
      offeringId: "a",
      teachingAssignmentCount: 0,
      courseOfferingSectionCount: 0,
      scheduleSessionCount: 0,
    },
    {
      offeringId: "b",
      teachingAssignmentCount: 2,
      courseOfferingSectionCount: 0,
      scheduleSessionCount: 0,
    },
    {
      offeringId: "c",
      teachingAssignmentCount: 0,
      courseOfferingSectionCount: 1,
      scheduleSessionCount: 4,
    },
  ]);
  assert(plan.allowedIds.length === 1 && plan.allowedIds[0] === "a", "bulk allows unused only");
  assert(plan.blocked.length === 2, "bulk blocks used");
  assert(
    formatBulkOfferingDeleteBlockedMessage(plan.blocked).includes(OFFERING_IN_USE_DELETE_MESSAGE),
    "bulk Arabic",
  );
  assert(
    isOfferingInUseDeleteError(
      "violates foreign key constraint teaching_assignments_course_offering_id_fkey",
    ),
    "FK delete error recognized",
  );

  assert("20260715200500" < "20260715200600", "migration order after term remediation");

  console.log("course-offering-dependency-fk.harness.ts: PASS");
}

run();

/**
 * PHASE-6 self-verifying experimental reset + room hardening (source only).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOM_IN_USE_DELETE_MESSAGE,
  formatBulkRoomDeleteBlockedMessage,
  planBulkRoomDelete,
} from "../../src/lib/rooms/room-delete-guard.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
function readSrc(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function run() {
  const resetRel = "supabase/migrations/20260715130000_reset_experimental_schedule_data.sql";
  const hardenRel = "supabase/migrations/20260715130100_harden_schedule_room_references.sql";
  assert(existsSync(join(root, resetRel)), "reset migration present");
  assert(existsSync(join(root, hardenRel)), "harden migration present");

  const reset = readSrc(resetRel);
  const harden = readSrc(hardenRel);
  const roomsUi = readSrc("src/routes/_authenticated/rooms.tsx");
  const guard = readSrc("src/lib/rooms/room-delete-guard.ts");
  const verifySql = join(
    root,
    "implementation-reports/phase-6-reset-hardening-self-verifying-migrations-01/post-apply-verification.sql",
  );
  assert(existsSync(verifySql), "post-apply verification SQL present (local report)");

  // 1) No dependency on external anon / auth.uid for migration audits
  assert(!/auth\.uid\s*\(/.test(reset), "reset migration does not call auth.uid");
  assert(
    !/\bfrom\s+anon\b|\banon\s+key\b|service_role/i.test(reset),
    "reset does not depend on anon/service_role clients",
  );
  assert(reset.includes("'migration_executor'"), "reset uses migration_executor actor");
  assert(harden.includes("'migration_executor'"), "harden audit uses migration_executor");

  // 2) Preflight inside migration
  assert(reset.includes("information_schema.columns"), "catalog-safe optional columns");
  assert(reset.includes("OFFICIAL_SCHEDULE_VERSION_FOUND"), "official version abort");
  assert(reset.includes("status IN ('published', 'approved')"), "rejects published/approved");
  assert(reset.includes("event_type = 'published'"), "rejects publish lifecycle events");

  // 3–5) before/after audit + protected masters + rollback assertions
  assert(reset.includes("'phase', 'before'"), "before audit phase");
  assert(reset.includes("'phase', 'after'"), "after audit phase");
  assert(reset.includes("PROTECTED_MASTER_DATA_CHANGED"), "master count rollback assertion");
  assert(reset.includes("enrollment_fingerprint"), "enrollment fields fingerprint");
  assert(reset.includes("BEGIN;"), "explicit BEGIN");
  assert(reset.includes("COMMIT;"), "explicit COMMIT");
  assert(reset.includes("RAISE;"), "re-raise restores lock triggers then rolls back");

  // 6) Idempotent empty input noted
  assert(reset.includes("idempotent_empty_input"), "idempotent empty path recorded");

  // Deletes only experimental ops
  assert(reset.includes("DELETE FROM public.schedule_sessions"), "deletes sessions");
  assert(reset.includes("DELETE FROM public.schedule_versions"), "deletes versions");
  assert(reset.includes("DELETE FROM public.section_subgroups"), "deletes subgroups");
  assert(!/DELETE\s+FROM\s+public\.rooms/i.test(reset), "does not delete rooms");
  assert(!/DELETE\s+FROM\s+public\.courses/i.test(reset), "does not delete courses");
  assert(!/DELETE\s+FROM\s+public\.course_offerings/i.test(reset), "does not delete offerings");
  assert(
    !/DELETE\s+FROM\s+public\.teaching_assignments/i.test(reset),
    "does not delete assignments",
  );
  assert(!/DELETE\s+FROM\s+public\.sections\b/i.test(reset), "does not delete sections");
  assert(!/UPDATE\s+public\.course_offerings/i.test(reset), "does not update offerings");
  assert(!/INSERT\s+INTO\s+public\.schedule_versions/i.test(reset), "does not create UAT version");

  // 7–9) Hardening orphan + FK RESTRICT, no CASCADE
  assert(harden.includes("ORPHAN_ROOM_REFERENCES_REMAIN"), "orphan precheck");
  assert(harden.includes("idx_schedule_sessions_room_id"), "index name");
  assert(harden.includes("schedule_sessions_room_id_fkey"), "fk name");
  assert(harden.includes("ON DELETE RESTRICT"), "restrict");
  assert(harden.includes("convalidated"), "validates FK");
  assert(harden.includes("confdeltype"), "checks delete action");
  assert(!/ON DELETE CASCADE/i.test(harden), "no CASCADE clause");
  assert(harden.includes("ROOM_FK_CASCADE_FORBIDDEN"), "cascade forbidden assertion");
  assert(harden.includes("BEGIN;"), "harden explicit BEGIN");
  assert(harden.includes("COMMIT;"), "harden explicit COMMIT");
  assert(harden.includes("ROOM_REFERENCE_HARDENING"), "hardening success audit");

  // 10) Snapshot details never NULL
  assert(harden.includes("room_delete_snapshot"), "snapshot action");
  assert(
    harden.includes("never NULL") || harden.includes("jsonb_build_object"),
    "non-null details",
  );
  for (const field of [
    "'id'",
    "'college_id'",
    "'code'",
    "'name'",
    "'room_type'",
    "'capacity'",
    "'is_active'",
    "'deleted_by'",
    "'deleted_at'",
  ]) {
    assert(harden.includes(field), `snapshot field ${field}`);
  }

  // UI guards retained
  assert(roomsUi.includes("schedule_sessions"), "UI pre-counts sessions");
  assert(roomsUi.includes("roomDeleteBlockedToastMessage"), "UI Arabic guard");
  assert(guard.includes(ROOM_IN_USE_DELETE_MESSAGE), "exact Arabic message");
  assert(harden.includes(ROOM_IN_USE_DELETE_MESSAGE), "DB trigger Arabic message");

  const plan = planBulkRoomDelete([
    { roomId: "a", sessionCount: 0 },
    { roomId: "b", sessionCount: 3 },
    { roomId: "c", sessionCount: 1 },
  ]);
  assert(plan.allowedIds.length === 1 && plan.allowedIds[0] === "a", "bulk allows unused only");
  assert(plan.blocked.length === 2, "bulk blocks used");
  assert(
    formatBulkRoomDeleteBlockedMessage(plan.blocked).includes(ROOM_IN_USE_DELETE_MESSAGE),
    "bulk Arabic",
  );

  assert("20260715130000" < "20260715130100", "migration order");

  console.log("experimental-schedule-reset-room-integrity.harness.ts: PASS");
}

run();

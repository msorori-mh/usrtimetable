/**
 * PHASE-6-EXPERIMENTAL-SCHEDULE-RESET-AND-ROOM-INTEGRITY-HARDENING-01
 * Source-only migrations — no apply / no runtime DB writes.
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

  // 1) Reset rejects published
  assert(reset.includes("OFFICIAL_SCHEDULE_VERSION_FOUND"), "preflight official guard");
  assert(reset.includes("status = 'published'"), "rejects published");
  assert(reset.includes("status = 'approved'"), "rejects approved");

  // 2–6) Reset deletes experimental schedule ops only
  assert(reset.includes("DELETE FROM public.schedule_sessions"), "deletes sessions");
  assert(reset.includes("DELETE FROM public.schedule_versions"), "deletes versions");
  assert(reset.includes("DELETE FROM public.section_subgroups"), "deletes subgroups");
  assert(reset.includes("DELETE FROM public.conflict_results"), "deletes conflict results");
  assert(reset.includes("DELETE FROM public.conflict_checks"), "deletes conflict checks");
  assert(
    reset.includes("DELETE FROM public.schedule_version_conflict_exceptions"),
    "deletes exceptions",
  );
  assert(reset.includes("DELETE FROM public.schedule_quality_runs"), "deletes quality runs");
  assert(reset.includes("EXPERIMENTAL_SCHEDULE_RESET"), "admin audit action");
  assert(reset.includes("OWNER_CONFIRMED_EXPERIMENTAL_DISPOSABLE"), "owner policy tag");
  assert(!/DELETE\s+FROM\s+public\.rooms/i.test(reset), "does not delete rooms");
  assert(!/DELETE\s+FROM\s+public\.courses/i.test(reset), "does not delete courses");
  assert(!/DELETE\s+FROM\s+public\.course_offerings/i.test(reset), "does not delete offerings");
  assert(
    !/DELETE\s+FROM\s+public\.teaching_assignments/i.test(reset),
    "does not delete teaching_assignments",
  );
  assert(!/DELETE\s+FROM\s+public\.sections\b/i.test(reset), "does not delete sections");
  assert(!/UPDATE\s+public\.course_offerings/i.test(reset), "does not touch offering enrollment");
  assert(!/INSERT\s+INTO\s+public\.schedule_versions/i.test(reset), "does not rebuild schedule");

  // 13) Transactional DO block + rollback path
  assert(reset.includes("DO $$"), "runs inside DO transaction block");
  assert(reset.includes("EXCEPTION"), "rollback path on failure");
  assert(reset.includes("RAISE;"), "re-raises after cleanup");

  // 7–9) Room FK RESTRICT, never CASCADE on schedule_sessions
  assert(harden.includes("idx_schedule_sessions_room_id"), "room_id index");
  assert(
    harden.includes("CREATE INDEX IF NOT EXISTS idx_schedule_sessions_room_id"),
    "creates room_id index",
  );
  assert(harden.includes("FOREIGN KEY (room_id)"), "adds room_id FK");
  assert(harden.includes("REFERENCES public.rooms(id)"), "references rooms");
  assert(harden.includes("ON DELETE RESTRICT"), "restrict delete when used");
  assert(harden.includes("schedule_sessions_room_id_fkey"), "named sessions FK");
  assert(harden.includes("ROOM_FK_BLOCKED"), "orphan preflight");
  assert(
    /ADD CONSTRAINT schedule_sessions_room_id_fkey[\s\S]*?ON DELETE RESTRICT/.test(harden),
    "schedule_sessions FK uses RESTRICT",
  );
  assert(!/ON DELETE CASCADE/i.test(harden), "no ON DELETE CASCADE clause in harden migration");

  // 10) Audit snapshot fields
  assert(harden.includes("room_delete_snapshot"), "full snapshot audit");
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
    assert(harden.includes(field), `audit snapshot field ${field}`);
  }
  assert(harden.includes("to_jsonb(OLD)"), "full row snapshot retained");

  // 8 / UI Arabic + pre-check
  assert(harden.includes(ROOM_IN_USE_DELETE_MESSAGE), "DB trigger Arabic message");
  assert(roomsUi.includes("schedule_sessions"), "UI counts schedule_sessions before delete");
  assert(roomsUi.includes('count: "exact"'), "UI exact session count");
  assert(roomsUi.includes("roomDeleteBlockedToastMessage"), "UI uses guard message");
  assert(guard.includes(ROOM_IN_USE_DELETE_MESSAGE), "guard exports exact Arabic message");
  assert(guard.includes("تعطيل"), "guard suggests deactivate instead of delete");
  assert(roomsUi.includes("عطّل القاعة") || roomsUi.includes("تعطيل"), "UI suggests deactivate");

  // 11) Bulk delete planning never silently allows used rooms
  const plan = planBulkRoomDelete([
    { roomId: "a", sessionCount: 0 },
    { roomId: "b", sessionCount: 3 },
    { roomId: "c", sessionCount: 1 },
  ]);
  assert(plan.allowedIds.length === 1 && plan.allowedIds[0] === "a", "bulk allows unused only");
  assert(plan.blocked.length === 2, "bulk blocks used rooms");
  const bulkMsg = formatBulkRoomDeleteBlockedMessage(plan.blocked);
  assert(bulkMsg.includes(ROOM_IN_USE_DELETE_MESSAGE), "bulk message Arabic");
  assert(bulkMsg.includes("عدد القاعات الممنوعة: 2"), "bulk reports blocked count");

  // Ordering: reset timestamp before harden
  assert("20260715130000" < "20260715130100", "migration order");

  console.log("experimental-schedule-reset-room-integrity.harness.ts: PASS");
}

run();

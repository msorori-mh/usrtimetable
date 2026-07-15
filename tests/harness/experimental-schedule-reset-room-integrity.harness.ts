/**
 * PHASE-6-EXPERIMENTAL-SCHEDULE-RESET-AND-ROOM-INTEGRITY-HARDENING-01
 * Source-only migrations — no apply / no runtime DB writes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

  // Reset contract
  assert(reset.includes("OFFICIAL_SCHEDULE_VERSION_FOUND"), "preflight official guard");
  assert(reset.includes("status = 'published'"), "rejects published");
  assert(reset.includes("status = 'approved'"), "rejects approved");
  assert(reset.includes("DELETE FROM public.schedule_sessions"), "deletes sessions");
  assert(reset.includes("DELETE FROM public.schedule_versions"), "deletes versions");
  assert(reset.includes("DELETE FROM public.section_subgroups"), "deletes subgroups");
  assert(reset.includes("DELETE FROM public.conflict_results"), "deletes conflict results");
  assert(reset.includes("DELETE FROM public.schedule_quality_runs"), "deletes quality runs");
  assert(reset.includes("experimental_schedule_reset"), "admin audit action");
  assert(reset.includes("OWNER_CONFIRMED_EXPERIMENTAL_DISPOSABLE"), "owner policy tag");
  assert(reset.includes("course_offerings"), "documents preserved offerings");
  assert(!/DELETE\s+FROM\s+public\.rooms/i.test(reset), "does not delete rooms");
  assert(!/DELETE\s+FROM\s+public\.courses/i.test(reset), "does not delete courses");
  assert(!/DELETE\s+FROM\s+public\.course_offerings/i.test(reset), "does not delete offerings");
  assert(!/UPDATE\s+public\.course_offerings/i.test(reset), "does not touch offering enrollment");
  assert(!/INSERT\s+INTO\s+public\.schedule_versions/i.test(reset), "does not rebuild schedule");

  // Room hardening
  assert(harden.includes("FOREIGN KEY (room_id)"), "adds room_id FK");
  assert(harden.includes("REFERENCES public.rooms(id)"), "references rooms");
  assert(harden.includes("ON DELETE RESTRICT"), "restrict delete when used");
  assert(harden.includes("schedule_sessions_room_id_fkey"), "named sessions FK");
  assert(harden.includes("ROOM_FK_BLOCKED"), "orphan preflight");
  assert(harden.includes("ROOM_IN_USE"), "used-room Arabic guard");
  assert(harden.includes("room_delete_snapshot"), "full snapshot audit");
  assert(harden.includes("to_jsonb(OLD)"), "full row snapshot");
  assert(harden.includes("ON DELETE CASCADE"), "availability cascade on unused room delete");

  // UI
  assert(roomsUi.includes("ROOM_IN_USE"), "rooms UI maps in-use error");

  // Ordering: reset timestamp before harden
  assert("20260715130000" < "20260715130100", "migration order");

  console.log("experimental-schedule-reset-room-integrity.harness.ts: PASS");
}

run();

/**
 * Schedule Builder drag-and-drop → local pending only.
 * Pure helpers + source guards. No DB, no network, no save on drop.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addMinutesToTime,
  applyPendingToSessions,
  buildPendingChange,
  hasPendingChanges,
  proposeSlotFromDragDrop,
  snapshotOriginalFromSession,
  timeToMinutes,
  type PendingScheduleSessionChange,
} from "../../src/lib/schedule-builder/pending-change";
import type { WorkspaceSessionView } from "../../src/lib/schedule-builder/workspace";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

function readSrc(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function sampleSession(
  partial: Partial<WorkspaceSessionView> & { id: string },
): WorkspaceSessionView {
  return {
    day_of_week: 6,
    start_time: "08:00:00",
    end_time: "10:00:00",
    session_type: "lecture",
    study_system: "regular",
    course_code: "CS101",
    course_name: "مقدمة",
    instructor_name: "د. أحمد",
    room_label: "A1 — قاعة",
    section_number: "1",
    program_name: "علوم حاسب",
    level_name: "الأول",
    department_name: "حاسب",
    instructor_id: "i1",
    section_id: "s1",
    room_id: "r1",
    program_id: "p1",
    level_id: "l1",
    updated_at: "2026-07-01T12:00:00.000Z",
    is_locked: false,
    ...partial,
  };
}

function run() {
  const page = readSrc("src/routes/_authenticated/schedule-builder.tsx");
  const pendingSrc = readSrc("src/lib/schedule-builder/pending-change.ts");
  const rpcClient = readSrc("src/lib/schedule-builder/session-move-rpc.ts");

  assert(page.includes("onGridDrop"), "page has onGridDrop");
  assert(page.includes("onDropAt={onGridDrop}"), "grid wires onDropAt");
  assert(
    page.includes("draggable={editModeActive && mayEnterEdit}"),
    "drag gated to edit mode + manage access",
  );
  assert(page.includes("proposeSlotFromDragDrop"), "uses pure drag proposal helper");
  assert(page.includes("setValidation(null)"), "clears validation on local edit/drop");

  const dropStart = page.indexOf("const onGridDrop =");
  const dropEnd = page.indexOf("const onCancelSessionChange", dropStart);
  assert(dropStart >= 0 && dropEnd > dropStart, "onGridDrop block extractable");
  const dropBody = page.slice(dropStart, dropEnd);
  assert(!dropBody.includes("validateScheduleSessionMove"), "drop does not validate via RPC");
  assert(!dropBody.includes("moveOrRescheduleScheduleSession"), "drop does not save via RPC");
  assert(!dropBody.includes(".rpc("), "drop has no rpc call");
  assert(!dropBody.includes(".update("), "drop has no direct update");
  assert(dropBody.includes("setValidation(null)"), "drop clears prior validation");
  assert(dropBody.includes("buildPendingChange"), "drop creates pending change");
  assert(dropBody.includes("setEditSheetOpen(true)"), "drop opens edit sheet");

  assert(rpcClient.includes("validate_schedule_session_move"), "validate RPC still present");
  assert(rpcClient.includes("move_or_reschedule_schedule_session"), "save RPC still present");
  assert(page.includes("onValidateConflicts"), "validate still user-triggered");
  assert(page.includes("onSaveChange"), "save still user-triggered");
  assert(!page.includes("draggable={false}"), "read-only false drag flag removed");

  assert(pendingSrc.includes("proposeSlotFromDragDrop"), "helper exported");
  assert(pendingSrc.includes("addMinutesToTime"), "duration helper exported");

  // Duration preserved, room preserved
  const session = sampleSession({ id: "sess-1" });
  const source = snapshotOriginalFromSession(session);
  assert(timeToMinutes(source.end_time)! - timeToMinutes(source.start_time)! === 120, "2h");

  const moved = proposeSlotFromDragDrop({
    sourceSlot: source,
    day_of_week: 0,
    start_time: "09:00",
  });
  assert(moved.ok, "move ok");
  if (!moved.ok) throw new Error("unreachable");
  assert(moved.proposed.day_of_week === 0, "day changed");
  assert(moved.proposed.start_time === "09:00", "start changed");
  assert(moved.proposed.end_time === "11:00", "end = start + duration");
  assert(moved.proposed.room_id === "r1", "room preserved");

  const same = proposeSlotFromDragDrop({
    sourceSlot: source,
    day_of_week: 6,
    start_time: "08:00",
  });
  assert(!same.ok, "identical drop is no-op");

  assert(addMinutesToTime("08:00", 90) === "09:30", "addMinutes 90");
  assert(addMinutesToTime("23:00", 120) === "01:00", "wrap modulo 24h");

  const pending = buildPendingChange({
    session,
    proposed: moved.proposed,
    changeReason: "",
  });
  assert(hasPendingChanges(pending), "pending dirty after drag");
  assert(pending.original.room_id === "r1", "original room from DB snapshot");
  assert(pending.proposed.room_id === "r1", "proposed room unchanged");
  assert(pending.expectedUpdatedAt === session.updated_at, "concurrency token kept");

  const rooms = [{ id: "r1", code: "A1", name: "قاعة" }];
  const displayed = applyPendingToSessions([session], pending, rooms);
  assert(displayed[0].day_of_week === 0, "display day from pending");
  assert(displayed[0].start_time === "09:00", "display start from pending");
  assert(displayed[0].end_time === "11:00", "display end from pending");
  assert(displayed[0].room_id === "r1", "display room unchanged");
  assert(session.day_of_week === 6, "source session object untouched");

  // Re-drag after pending: preserve pending room + duration, change day/start only
  const afterRoom: PendingScheduleSessionChange = {
    ...pending,
    proposed: { ...pending.proposed, room_id: "r2" },
  };
  const reDrag = proposeSlotFromDragDrop({
    sourceSlot: afterRoom.proposed,
    day_of_week: 1,
    start_time: "10:00",
  });
  assert(reDrag.ok, "re-drag ok");
  if (!reDrag.ok) throw new Error("unreachable");
  assert(reDrag.proposed.room_id === "r2", "re-drag keeps pending room");
  assert(reDrag.proposed.end_time === "12:00", "re-drag keeps pending duration");

  // Locked sessions: page guards via canOpenSessionForLocalEdit
  assert(dropBody.includes("canOpenSessionForLocalEdit"), "drop checks edit gate");
  assert(dropBody.includes("is_locked"), "drop mentions lock guard path");

  console.log("schedule-builder-drag-drop harness: PASS");
}

run();

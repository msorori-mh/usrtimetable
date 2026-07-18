import {
  approvedExceptionForResult,
  classifyConflict,
  overlappingInterval,
  type ConflictSessionEvidence,
} from "../../src/lib/reports/conflict-read-model.ts";

const VERSION = "version-a";
const session = (partial: Partial<ConflictSessionEvidence> = {}): ConflictSessionEvidence => ({
  id: "session-a", schedule_version_id: VERSION, day_of_week: 2,
  start_time: "09:00", end_time: "10:30", study_system: "regular", ...partial,
});
const result = { conflict_code: "room_conflict", severity: "hard", schedule_session_id: "session-a", related_session_id: "session-b" };
const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };

const primary = session();
const related = session({ id: "session-b", start_time: "10:00", end_time: "11:00" });
assert(overlappingInterval(primary, related)?.start === "10:00:00", "exact overlap start retained");
assert(classifyConflict({ result, versionId: VERSION, primary, related }).classification === "hard_blocker", "verified hard blocker");
assert(classifyConflict({ result, versionId: VERSION, primary }).classification === "unknown", "missing related session is readiness unknown");
assert(classifyConflict({ result, versionId: VERSION, primary, related: session({ id: "session-b", day_of_week: 3 }) }).classification === "unknown", "different day is not temporal conflict evidence");
assert(classifyConflict({ result, versionId: VERSION, primary, related: session({ id: "session-b", start_time: "11:00", end_time: "12:00" }) }).classification === "unknown", "non-overlap is not temporal conflict evidence");
assert(classifyConflict({ result, versionId: VERSION, primary, related: session({ id: "session-b", study_system: "parallel" }) }).classification === "unknown", "regular/parallel remain isolated");
assert(classifyConflict({ result, versionId: VERSION, primary: session({ schedule_version_id: "version-b" }), related }).classification === "unknown", "version mismatch fails closed");

const exception = {
  id: "exception-a", schedule_version_id: VERSION, conflict_code: "room_conflict",
  session_id: "session-b", related_session_id: "session-a", approval_type: "owner_approved",
  reason: "documented", source: "harness", status: "approved", approved_by: null,
  approved_at: "2026-07-18T00:00:00Z", metadata: null,
};
const index = new Map([[`${VERSION}|room_conflict|session-a|session-b`, exception]]);
const matched = approvedExceptionForResult(index, VERSION, result);
assert(matched?.id === exception.id, "approved exception matches normalized pair");
assert(classifyConflict({ result, versionId: VERSION, primary, related, approvedException: matched }).classification === "approved_exception", "approved exception is separate classification");
assert(classifyConflict({ result: { ...result, severity: "soft" }, versionId: VERSION, primary, related }).classification === "warning", "warning is separate classification");

console.log("conflict-exception-reporting.harness.ts: PASS");

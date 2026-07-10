/**
 * F002 — validateScheduleVersion loads approved exceptions before applyApprovedExceptions.
 * Pure unit / source-contract tests — no DB writes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildApprovedExceptionIndex,
  findMatchingException,
  type ApprovedException,
} from "@/lib/conflict-engine/exceptions";
import { applyApprovedExceptions } from "@/lib/conflict-engine/validator";

const VERSION = "482af19b-0d44-4631-b80a-753f5ead4089";

function ex(partial: Partial<ApprovedException> & Pick<ApprovedException, "id" | "conflict_code" | "session_id">): ApprovedException {
  return {
    schedule_version_id: VERSION,
    related_session_id: null,
    approval_type: "legacy_overlap_inherited",
    reason: "test reason",
    source: "harness",
    status: "approved",
    approved_by: null,
    approved_at: new Date().toISOString(),
    metadata: null,
    ...partial,
  };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const tests: Array<{ name: string; run: () => void }> = [];

tests.push({
  name: "validateScheduleVersion source loads approved exceptions before applyApprovedExceptions",
  run: () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const src = readFileSync(path.join(root, "src/lib/conflict-engine/validator.ts"), "utf8");
    const fnStart = src.indexOf("export async function validateScheduleVersion");
    assert(fnStart >= 0, "validateScheduleVersion must exist");
    const fnBody = src.slice(fnStart, fnStart + 3500);
    assert(fnBody.includes("loadApprovedExceptions"), "must call loadApprovedExceptions");
    assert(fnBody.includes("applyApprovedExceptions(conflicts, scheduleVersionId, approvedExceptions)"), "must pass loaded exceptions to applyApprovedExceptions");
    const loadIdx = fnBody.indexOf("loadApprovedExceptions");
    const applyIdx = fnBody.indexOf("applyApprovedExceptions(conflicts, scheduleVersionId, approvedExceptions)");
    assert(loadIdx >= 0 && applyIdx > loadIdx, "load must precede apply");
  },
});

tests.push({
  name: "loadApprovedExceptions throws on query error (no silent empty fallback)",
  run: () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const src = readFileSync(path.join(root, "src/lib/conflict-engine/exceptions.ts"), "utf8");
    assert(src.includes("if (error) throw error"), "loader must throw on Supabase error");
  },
});

tests.push({
  name: "UI path without exceptions yields 96/0/96 (pre-fix regression guard)",
  run: () => {
    const conflicts = Array.from({ length: 96 }, (_, i) => ({
      code: i < 86 ? "instructor_conflict" : "room_type_mismatch",
      severity: "hard" as const,
      message_ar: `c ${i}`,
      message_en: `c ${i}`,
      schedule_session_id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      related_session_id: i < 44 ? `00000000-0000-0000-0001-${String(i).padStart(12, "0")}` : null,
    }));
    const without = applyApprovedExceptions(conflicts, VERSION);
    assert(without.totalHardConflicts === 96, "total 96");
    assert(without.approvedHardConflicts === 0, "approved 0 without loader");
    assert(without.unapprovedHardConflicts === 96, "unapproved 96 without loader");
  },
});

tests.push({
  name: "UI path with loaded exceptions yields canonical 96/86/10",
  run: () => {
    const conflicts = Array.from({ length: 96 }, (_, i) => ({
      code: i < 86 ? "instructor_conflict" : "room_type_mismatch",
      severity: "hard" as const,
      message_ar: `c ${i}`,
      message_en: `c ${i}`,
      schedule_session_id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      related_session_id: i < 44 ? `00000000-0000-0000-0001-${String(i).padStart(12, "0")}` : null,
    }));
    const exceptions: ApprovedException[] = [];
    for (let i = 0; i < 86; i++) {
      exceptions.push(
        ex({
          id: `approved-${i}`,
          conflict_code: conflicts[i].code,
          session_id: conflicts[i].schedule_session_id!,
          related_session_id: conflicts[i].related_session_id,
        }),
      );
    }
    const result = applyApprovedExceptions(conflicts, VERSION, exceptions);
    assert(result.totalHardConflicts === 96, `total 96 got ${result.totalHardConflicts}`);
    assert(result.approvedHardConflicts === 86, `approved 86 got ${result.approvedHardConflicts}`);
    assert(result.unapprovedHardConflicts === 10, `unapproved 10 got ${result.unapprovedHardConflicts}`);
    assert(result.unapprovedHardConflicts > 0, "eligibility FAIL (10 unapproved blockers remain)");
  },
});

tests.push({
  name: "revoked exception not counted as approved",
  run: () => {
    const sid = "11111111-1111-1111-1111-111111111111";
    const revoked = ex({ id: "rev", conflict_code: "instructor_conflict", session_id: sid, status: "revoked" });
    const index = buildApprovedExceptionIndex([revoked], VERSION);
    assert(findMatchingException(index, { scheduleVersionId: VERSION, conflictCode: "instructor_conflict", sessionId: sid }) === null, "revoked excluded");
  },
});

tests.push({
  name: "cross-version exception not counted",
  run: () => {
    const other = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const exOther = ex({ id: "x", conflict_code: "instructor_conflict", session_id: "11111111-1111-1111-1111-111111111111", schedule_version_id: other });
    const index = buildApprovedExceptionIndex([exOther], VERSION);
    assert(index.size === 0, "wrong version excluded from index");
  },
});

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t.run();
    passed++;
    console.log(`PASS ${t.name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${t.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log(JSON.stringify({ phase: "F002-FIX-EXEC-01", passed, failed, total: tests.length }));
process.exit(failed > 0 ? 1 : 0);

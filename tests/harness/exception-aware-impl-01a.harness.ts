/**
 * LEGACY-PUBLISH-LIFECYCLE-EXCEPTION-AWARE-IMPL-01A verification harness.
 * Pure unit tests — no DB writes.
 */
import {
  buildApprovedExceptionIndex,
  exceptionMatchKey,
  findMatchingException,
  normalizeSessionPair,
  summarizeConflictExceptions,
  type ApprovedException,
} from "@/lib/conflict-engine/exceptions";
import { applyApprovedExceptions } from "@/lib/conflict-engine/validator";
import { validateGate, type EligibilityResult } from "@/lib/schedule-versions/lifecycle";

const VERSION = "482af19b-0d44-4631-b80a-753f5ead4089";
const OTHER_VERSION = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function ex(
  partial: Partial<ApprovedException> &
    Pick<ApprovedException, "id" | "conflict_code" | "session_id">,
): ApprovedException {
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

// 1. Pair matching with reversed session ids
tests.push({
  name: "pair matching with reversed session ids",
  run: () => {
    const a = "11111111-1111-1111-1111-111111111111";
    const b = "22222222-2222-2222-2222-222222222222";
    const exceptions = [
      ex({
        id: "ex-1",
        conflict_code: "instructor_conflict",
        session_id: b,
        related_session_id: a,
      }),
    ];
    const index = buildApprovedExceptionIndex(exceptions, VERSION);
    const match = findMatchingException(index, {
      scheduleVersionId: VERSION,
      conflictCode: "instructor_conflict",
      sessionId: a,
      relatedSessionId: b,
    });
    assert(match?.id === "ex-1", "reversed pair should match");
  },
});

// 2. Single-session room_type exception
tests.push({
  name: "single-session room_type_mismatch exception",
  run: () => {
    const sid = "33333333-3333-3333-3333-333333333333";
    const exceptions = [ex({ id: "ex-rt", conflict_code: "room_type_mismatch", session_id: sid })];
    const index = buildApprovedExceptionIndex(exceptions, VERSION);
    const match = findMatchingException(index, {
      scheduleVersionId: VERSION,
      conflictCode: "room_type_mismatch",
      sessionId: sid,
    });
    assert(match?.id === "ex-rt", "single-session room_type should match");
    const pair = normalizeSessionPair(sid, null);
    assert(pair.secondary === null, "single-session pair secondary is null");
  },
});

// 3. Exception from other version rejected
tests.push({
  name: "exception from other version rejected",
  run: () => {
    const exceptions = [
      ex({
        id: "ex-other",
        conflict_code: "room_conflict",
        session_id: "44444444-4444-4444-4444-444444444444",
        related_session_id: "55555555-5555-5555-5555-555555555555",
        schedule_version_id: OTHER_VERSION,
      }),
    ];
    const index = buildApprovedExceptionIndex(exceptions, VERSION);
    const match = findMatchingException(index, {
      scheduleVersionId: VERSION,
      conflictCode: "room_conflict",
      sessionId: "44444444-4444-4444-4444-444444444444",
      relatedSessionId: "55555555-5555-5555-5555-555555555555",
    });
    assert(match === null, "other version exception must not match");
  },
});

// 4. Revoked exception rejected
tests.push({
  name: "revoked exception rejected",
  run: () => {
    const exceptions = [
      ex({
        id: "ex-revoked",
        conflict_code: "section_conflict",
        session_id: "66666666-6666-6666-6666-666666666666",
        related_session_id: "77777777-7777-7777-7777-777777777777",
        status: "revoked",
      }),
    ];
    const index = buildApprovedExceptionIndex(exceptions, VERSION);
    const match = findMatchingException(index, {
      scheduleVersionId: VERSION,
      conflictCode: "section_conflict",
      sessionId: "66666666-6666-6666-6666-666666666666",
      relatedSessionId: "77777777-7777-7777-7777-777777777777",
    });
    assert(match === null, "revoked exception must not match");
  },
});

// 5. Different conflict_code rejected
tests.push({
  name: "different conflict_code rejected",
  run: () => {
    const a = "88888888-8888-8888-8888-888888888888";
    const b = "99999999-9999-9999-9999-999999999999";
    const exceptions = [
      ex({ id: "ex-code", conflict_code: "room_conflict", session_id: a, related_session_id: b }),
    ];
    const index = buildApprovedExceptionIndex(exceptions, VERSION);
    const match = findMatchingException(index, {
      scheduleVersionId: VERSION,
      conflictCode: "instructor_conflict",
      sessionId: a,
      relatedSessionId: b,
    });
    assert(match === null, "different conflict_code must not match");
  },
});

// 6-8. Fixture 96/86/10 via synthetic conflicts + exceptions
tests.push({
  name: "fixture 96 total / 86 approved / 10 unapproved + gate FAIL",
  run: () => {
    const conflicts = Array.from({ length: 96 }, (_, i) => ({
      code: i < 86 ? "instructor_conflict" : "room_type_mismatch",
      severity: "hard" as const,
      message_ar: `conflict ${i}`,
      message_en: `conflict ${i}`,
      schedule_session_id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      related_session_id: i < 44 ? `00000000-0000-0000-0001-${String(i).padStart(12, "0")}` : null,
    }));

    const exceptions: ApprovedException[] = [];
    for (let i = 0; i < 86; i++) {
      exceptions.push(
        ex({
          id: `approved-${i}`,
          conflict_code: i < 86 ? "instructor_conflict" : "room_type_mismatch",
          session_id: conflicts[i].schedule_session_id!,
          related_session_id: conflicts[i].related_session_id,
          reason: `approved ${i}`,
        }),
      );
    }

    const result = applyApprovedExceptions(conflicts, VERSION, exceptions);
    assert(
      result.totalHardConflicts === 96,
      `totalHardConflicts expected 96 got ${result.totalHardConflicts}`,
    );
    assert(
      result.approvedHardConflicts === 86,
      `approvedHardConflicts expected 86 got ${result.approvedHardConflicts}`,
    );
    assert(
      result.unapprovedHardConflicts === 10,
      `unapprovedHardConflicts expected 10 got ${result.unapprovedHardConflicts}`,
    );

    const eligibility: EligibilityResult = {
      ok: result.unapprovedHardConflicts === 0,
      reasons: [],
      warnings: [],
      hardConflicts: result.unapprovedHardConflicts,
      totalHardConflicts: result.totalHardConflicts,
      approvedHardConflicts: result.approvedHardConflicts,
      unapprovedHardConflicts: result.unapprovedHardConflicts,
      qualityScore: null,
      sessionsCount: 198,
    };
    const gateErrs = validateGate("approved", eligibility);
    assert(gateErrs.length > 0, "eligibility must FAIL for approved gate with 10 unapproved");
    assert(eligibility.unapprovedHardConflicts > 0, "unapproved must block");
    assert(
      result.conflicts.filter((c) => c.approved_exception).length === 86,
      "approved conflicts visible",
    );
    assert(
      result.conflicts.filter((c) => !c.approved_exception).length === 10,
      "unapproved conflicts visible",
    );
  },
});

// 9. Self-conflict doesn't return (structural check on key builder — no wildcard)
tests.push({
  name: "no wildcard matching — exact key only",
  run: () => {
    const key = exceptionMatchKey({
      scheduleVersionId: VERSION,
      conflictCode: "instructor_conflict",
      sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      relatedSessionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    });
    const wrong = exceptionMatchKey({
      scheduleVersionId: VERSION,
      conflictCode: "instructor_conflict",
      sessionId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      relatedSessionId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    });
    assert(key !== wrong, "different pairs must have different keys");
    const index = buildApprovedExceptionIndex(
      [
        ex({
          id: "only-one",
          conflict_code: "instructor_conflict",
          session_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          related_session_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        }),
      ],
      VERSION,
    );
    assert(index.size === 1, "index has exactly one entry");
    assert(
      findMatchingException(index, {
        scheduleVersionId: VERSION,
        conflictCode: "instructor_conflict",
        sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        relatedSessionId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      }) !== null,
      "exact match",
    );
    assert(
      findMatchingException(index, {
        scheduleVersionId: VERSION,
        conflictCode: "instructor_conflict",
        sessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        relatedSessionId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      }) === null,
      "self-pair must not wildcard-match",
    );
  },
});

// 10. Duplicate prevention in schema (documented constraint name)
tests.push({
  name: "duplicate prevention unique index contract",
  run: () => {
    const a = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
    const b = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    const k1 = exceptionMatchKey({
      scheduleVersionId: VERSION,
      conflictCode: "room_conflict",
      sessionId: a,
      relatedSessionId: b,
    });
    const k2 = exceptionMatchKey({
      scheduleVersionId: VERSION,
      conflictCode: "room_conflict",
      sessionId: b,
      relatedSessionId: a,
    });
    assert(k1 === k2, "normalized pair keys must be equal for duplicate prevention");
  },
});

// Scorer summary counts
tests.push({
  name: "scorer summarize counts approved/unapproved correctly",
  run: () => {
    const summary = summarizeConflictExceptions([
      { approved_exception: true },
      { approved_exception: true },
      { approved_exception: false },
    ]);
    assert(summary.totalHardConflicts === 3, "total 3");
    assert(summary.approvedHardConflicts === 2, "approved 2");
    assert(summary.unapprovedHardConflicts === 1, "unapproved 1");
  },
});

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const t of tests) {
  try {
    t.run();
    passed++;
    console.log(`PASS ${t.name}`);
  } catch (e) {
    failed++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${t.name}: ${msg}`);
    console.error(`FAIL ${t.name}: ${msg}`);
  }
}

const summary = {
  phase: "LEGACY-PUBLISH-LIFECYCLE-EXCEPTION-AWARE-IMPL-01A",
  passed,
  failed,
  total: tests.length,
  fixture: { totalHard: 96, approved: 86, unapproved: 10, eligibility: "FAIL" },
  failures,
};

console.log(JSON.stringify(summary, null, 2));
process.exit(failed > 0 ? 1 : 0);

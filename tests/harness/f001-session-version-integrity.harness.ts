/**
 * LEGACY-PUBLISH-LIFECYCLE-EXCEPTION-AWARE-IMPL-01B-F001-FIX harness.
 * Mirrors ensure_svce_session_version_integrity() — no DB writes.
 */
import {
  assertNoDuplicateActivePair,
  duplicateNormalizedPairKey,
  SvceIntegrityError,
  validateSvceSessionVersionIntegrity,
  validateSvceUpdate,
  type ScheduleSession,
  type ScheduleVersion,
  type SvceRow,
} from "./svce-integrity-model";

const COLLEGE = "7168345f-cf9d-4789-b2ad-547abb687dc8";
const VERSION_A = "482af19b-0d44-4631-b80a-753f5ead4089";
const VERSION_B = "a90aa87e-c029-46a1-8b76-1cb2f0b72398";
const OTHER_COLLEGE = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const S1 = "11111111-1111-1111-1111-111111111111";
const S2 = "22222222-2222-2222-2222-222222222222";
const S3 = "33333333-3333-3333-3333-333333333333";
const S4 = "44444444-4444-4444-4444-444444444444";
const S_OTHER_VER = "55555555-5555-5555-5555-555555555555";
const S_OTHER_COLLEGE = "66666666-6666-6666-6666-666666666666";

function versions(): Map<string, ScheduleVersion> {
  return new Map([
    [VERSION_A, { id: VERSION_A, college_id: COLLEGE }],
    [VERSION_B, { id: VERSION_B, college_id: COLLEGE }],
    ["other-ver", { id: "other-ver", college_id: OTHER_COLLEGE }],
  ]);
}

function sessions(): Map<string, ScheduleSession> {
  return new Map([
    [S1, { id: S1, college_id: COLLEGE, schedule_version_id: VERSION_A }],
    [S2, { id: S2, college_id: COLLEGE, schedule_version_id: VERSION_A }],
    [S3, { id: S3, college_id: COLLEGE, schedule_version_id: VERSION_B }],
    [S4, { id: S4, college_id: COLLEGE, schedule_version_id: VERSION_B }],
    [S_OTHER_VER, { id: S_OTHER_VER, college_id: COLLEGE, schedule_version_id: VERSION_B }],
    [S_OTHER_COLLEGE, { id: S_OTHER_COLLEGE, college_id: OTHER_COLLEGE, schedule_version_id: "other-ver" }],
  ]);
}

function row(partial: Partial<SvceRow> & Pick<SvceRow, "session_id">): SvceRow {
  return {
    college_id: COLLEGE,
    schedule_version_id: VERSION_A,
    related_session_id: null,
    ...partial,
  };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertThrows(fn: () => void, substr: string) {
  try {
    fn();
    throw new Error(`expected SvceIntegrityError containing "${substr}"`);
  } catch (e) {
    if (e instanceof SvceIntegrityError) {
      assert(e.message.includes(substr), `expected "${substr}" in "${e.message}"`);
      return;
    }
    throw e;
  }
}

const tests: Array<{ id: number; name: string; run: () => void }> = [];

tests.push({
  id: 1,
  name: "session_id from same schedule_version → PASS",
  run: () => {
    validateSvceSessionVersionIntegrity(row({ session_id: S1 }), versions(), sessions());
  },
});

tests.push({
  id: 2,
  name: "session_id from other schedule_version same college → FAIL",
  run: () => {
    assertThrows(
      () => validateSvceSessionVersionIntegrity(row({ session_id: S3 }), versions(), sessions()),
      "session/schedule_version mismatch",
    );
  },
});

tests.push({
  id: 3,
  name: "related_session_id from other version → FAIL",
  run: () => {
    assertThrows(
      () =>
        validateSvceSessionVersionIntegrity(
          row({ session_id: S1, related_session_id: S_OTHER_VER }),
          versions(),
          sessions(),
        ),
      "related_session/schedule_version mismatch",
    );
  },
});

tests.push({
  id: 4,
  name: "both sessions from other version same college → FAIL",
  run: () => {
    assertThrows(
      () =>
        validateSvceSessionVersionIntegrity(
          row({ session_id: S3, related_session_id: S4 }),
          versions(),
          sessions(),
        ),
      "session/schedule_version mismatch",
    );
  },
});

tests.push({
  id: 5,
  name: "UPDATE valid row then session_id to other version → FAIL",
  run: () => {
    const before = row({ session_id: S1 });
    const after = row({ session_id: S3 });
    assertThrows(() => validateSvceUpdate(before, after, versions(), sessions()), "session/schedule_version mismatch");
  },
});

tests.push({
  id: 6,
  name: "UPDATE schedule_version_id while sessions stay on old version → FAIL",
  run: () => {
    const before = row({ session_id: S1, schedule_version_id: VERSION_A });
    const after = row({ session_id: S1, schedule_version_id: VERSION_B });
    assertThrows(() => validateSvceUpdate(before, after, versions(), sessions()), "session/schedule_version mismatch");
  },
});

tests.push({
  id: 7,
  name: "single-session room_type with related_session_id NULL → PASS",
  run: () => {
    validateSvceSessionVersionIntegrity(row({ session_id: S2, related_session_id: null }), versions(), sessions());
  },
});

tests.push({
  id: 8,
  name: "pair exception same version reversed order → PASS + normalized key equal",
  run: () => {
    validateSvceSessionVersionIntegrity(
      row({ session_id: S1, related_session_id: S2 }),
      versions(),
      sessions(),
    );
    validateSvceSessionVersionIntegrity(
      row({ session_id: S2, related_session_id: S1 }),
      versions(),
      sessions(),
    );
    const k1 = duplicateNormalizedPairKey(VERSION_A, "instructor_conflict", S1, S2);
    const k2 = duplicateNormalizedPairKey(VERSION_A, "instructor_conflict", S2, S1);
    assert(k1 === k2, "normalized pair keys must match");
  },
});

tests.push({
  id: 9,
  name: "duplicate normalized pair → FAIL",
  run: () => {
    const key = duplicateNormalizedPairKey(VERSION_A, "room_conflict", S1, S2);
    assertThrows(
      () => assertNoDuplicateActivePair([{ status: "approved", key }], key),
      "duplicate normalized pair",
    );
  },
});

tests.push({
  id: 10,
  name: "cross-college session → FAIL",
  run: () => {
    assertThrows(
      () => validateSvceSessionVersionIntegrity(row({ session_id: S_OTHER_COLLEGE }), versions(), sessions()),
      "session/college mismatch",
    );
  },
});

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const t of tests) {
  try {
    t.run();
    passed++;
    console.log(`PASS Test ${t.id}: ${t.name}`);
  } catch (e) {
    failed++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`Test ${t.id}: ${msg}`);
    console.error(`FAIL Test ${t.id}: ${t.name}: ${msg}`);
  }
}

const summary = {
  phase: "LEGACY-PUBLISH-LIFECYCLE-EXCEPTION-AWARE-IMPL-01B-F001-FIX",
  passed,
  failed,
  total: tests.length,
  failures,
};

console.log(JSON.stringify(summary, null, 2));
process.exit(failed > 0 ? 1 : 0);

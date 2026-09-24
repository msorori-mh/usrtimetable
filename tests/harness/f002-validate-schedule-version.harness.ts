/**
 * F002 — validateScheduleVersion loads approved exceptions before applyApprovedExceptions.
 * Pure unit / source-contract tests — no DB writes.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import {
  buildApprovedExceptionIndex,
  findMatchingException,
  type ApprovedException,
} from "@/lib/conflict-engine/exceptions";
import { applyApprovedExceptions } from "@/lib/conflict-engine/validator";

const VERSION = "482af19b-0d44-4631-b80a-753f5ead4089";

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

function assertExceptionWiring(src: string) {
  const source = ts.createSourceFile("validator.ts", src, ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(
    (node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === "validateScheduleVersion",
  );
  assert(!!fn?.body, "validateScheduleVersion must exist");
  const declarations = fn!.body!.statements.flatMap((node) =>
    ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [],
  );
  const loaded = declarations.find((node) => node.name.getText(source) === "approvedExceptions");
  const result = declarations.find((node) => node.name.getText(source) === "result");
  const awaited = loaded?.initializer;
  assert(!!awaited && ts.isAwaitExpression(awaited), "must await approved exceptions");
  const loader = (awaited as ts.AwaitExpression).expression;
  assert(ts.isCallExpression(loader), "must call approved exception loader");
  const call = loader as ts.CallExpression;
  assert(call.expression.getText(source) === "loadApprovedExceptions", "must use approved loader");
  const scope = call.arguments[0];
  assert(
    !!scope && ts.isObjectLiteralExpression(scope),
    "loader must receive version and college scope",
  );
  for (const name of ["scheduleVersionId", "collegeId"]) {
    assert(
      (scope as ts.ObjectLiteralExpression).properties.some(
        (property) => ts.isShorthandPropertyAssignment(property) && property.name.text === name,
      ),
      `loader must be scoped by ${name}`,
    );
  }
  const applied = result?.initializer;
  assert(!!applied && ts.isCallExpression(applied), "must apply loaded exceptions");
  const apply = applied as ts.CallExpression;
  assert(
    apply.expression.getText(source) === "applyApprovedExceptions",
    "must apply approved exceptions",
  );
  assert(
    JSON.stringify(apply.arguments.map((arg) => arg.getText(source))) ===
      JSON.stringify(["conflicts", "scheduleVersionId", "approvedExceptions"]),
    "must pass loaded exceptions for the same version",
  );
  assert(loaded!.pos < result!.pos, "load must precede apply");
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const validatorSource = readFileSync(
  path.join(root, "src/lib/conflict-engine/validator.ts"),
  "utf8",
);
tests.push({
  name: "validateScheduleVersion awaits scoped exceptions before applying them regardless of formatting",
  run: () => assertExceptionWiring(validatorSource),
});
for (const [name, mutated] of [
  [
    "missing loaded argument",
    validatorSource.replace(/(scheduleVersionId,\s*)approvedExceptions,(\s*\);)/, "$1$2"),
  ],
  [
    "unawaited loader",
    validatorSource.replace("await loadApprovedExceptions", "loadApprovedExceptions"),
  ],
  [
    "missing college scope",
    validatorSource.replace(/(loadApprovedExceptions\(\{\s*scheduleVersionId,\s*)collegeId,/, "$1"),
  ],
]) {
  tests.push({
    name: `wiring guard rejects ${name}`,
    run: () => {
      assert(mutated !== validatorSource, "mutation must change the real source");
      let rejected = false;
      try {
        assertExceptionWiring(mutated);
      } catch {
        rejected = true;
      }
      assert(rejected, `guard must reject ${name}`);
    },
  });
}

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
    assert(
      result.unapprovedHardConflicts === 10,
      `unapproved 10 got ${result.unapprovedHardConflicts}`,
    );
    assert(result.unapprovedHardConflicts > 0, "eligibility FAIL (10 unapproved blockers remain)");
  },
});

tests.push({
  name: "revoked exception not counted as approved",
  run: () => {
    const sid = "11111111-1111-1111-1111-111111111111";
    const revoked = ex({
      id: "rev",
      conflict_code: "instructor_conflict",
      session_id: sid,
      status: "revoked",
    });
    const index = buildApprovedExceptionIndex([revoked], VERSION);
    assert(
      findMatchingException(index, {
        scheduleVersionId: VERSION,
        conflictCode: "instructor_conflict",
        sessionId: sid,
      }) === null,
      "revoked excluded",
    );
  },
});

tests.push({
  name: "cross-version exception not counted",
  run: () => {
    const other = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const exOther = ex({
      id: "x",
      conflict_code: "instructor_conflict",
      session_id: "11111111-1111-1111-1111-111111111111",
      schedule_version_id: other,
    });
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

import { canonicalizeTeachingAssignmentsV2 } from "../../src/lib/excel-import/teaching-assignments-v2-canonical";
import {
  conflictingDuplicate,
  crossSheetDuplicate,
  differentHoursDuplicate,
  expansionDuplicate,
  identicalDuplicate,
  livePartialConflictFixture,
  liveReadyToCanonicalFixture,
  mixedSafeAndConflictingDuplicates,
} from "../fixtures/teaching-assignments-v2-duplicates/cases";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertCanonicalDuplicate(rows: typeof identicalDuplicate, label: string) {
  const result = canonicalizeTeachingAssignmentsV2(rows);
  assert(result.sourceReadyRows === 2, `${label}: source READY count`);
  assert(result.canonicalOperations.length === 1, `${label}: one canonical operation`);
  assert(result.conflicts.length === 0, `${label}: no conflict`);
  const provenance = result.canonicalOperations[0].values._source_provenance as unknown[];
  assert(provenance.length === 2, `${label}: provenance preserved`);
}

assertCanonicalDuplicate(identicalDuplicate, "identical duplicate");
assertCanonicalDuplicate(crossSheetDuplicate, "cross-sheet duplicate");
assertCanonicalDuplicate(expansionDuplicate, "expansion duplicate");

for (const [label, rows] of [
  ["different hours", differentHoursDuplicate],
  ["different operational notes", conflictingDuplicate],
] as const) {
  const result = canonicalizeTeachingAssignmentsV2(rows);
  assert(result.sourceReadyRows === 2, `${label}: source READY count`);
  assert(result.canonicalOperations.length === 0, `${label}: conflicting key blocked`);
  assert(
    result.conflicts.some((e) => e.errorCode === "conflicting_assignment_duplicate"),
    `${label}: explicit conflict`,
  );
}

const mixed = canonicalizeTeachingAssignmentsV2(mixedSafeAndConflictingDuplicates);
assert(mixed.sourceReadyRows === 4, "mixed: source READY count");
assert(mixed.canonicalOperations.length === 1, "mixed: safe natural key remains executable");
assert(
  mixed.canonicalOperations[0].values._delivery_group_id === "dg-safe",
  "mixed: no member of conflicting natural key is emitted",
);
assert(mixed.conflicts.length === 2, "mixed: conflicting members remain explicit errors");

const rerunA = canonicalizeTeachingAssignmentsV2(identicalDuplicate);
const rerunB = canonicalizeTeachingAssignmentsV2(identicalDuplicate);
assert(
  JSON.stringify(rerunA.canonicalOperations) === JSON.stringify(rerunB.canonicalOperations),
  "canonicalization is deterministic/idempotent",
);

const liveCounts = canonicalizeTeachingAssignmentsV2(liveReadyToCanonicalFixture);
assert(liveCounts.sourceReadyRows === 156, "live preview source READY rows");
assert(liveCounts.canonicalOperations.length === 142, "live preview canonical operations");
assert(liveCounts.conflicts.length === 0, "live preview duplicates are identical in fixture");

const livePartial = canonicalizeTeachingAssignmentsV2(livePartialConflictFixture);
assert(livePartial.sourceReadyRows === 156, "live partial preview source READY rows");
assert(livePartial.canonicalOperations.length === 138, "live partial emits 138 safe operations");
assert(livePartial.conflicts.length === 6, "live partial reports all six conflicting extras");
assert(
  livePartial.canonicalOperations.every(
    (operation) => !String(operation.values._delivery_group_id).startsWith("dg-conflict-"),
  ),
  "live partial emits no member of the four conflicting natural keys",
);

console.log(
  JSON.stringify({
    harness: "teaching-assignments-v2-duplicate-contract",
    sourceReadyRows: livePartial.sourceReadyRows,
    canonicalOperations: livePartial.canonicalOperations.length,
    ok: true,
  }),
);

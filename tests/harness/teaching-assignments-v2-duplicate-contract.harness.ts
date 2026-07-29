import { canonicalizeTeachingAssignmentsV2 } from "../../src/lib/excel-import/teaching-assignments-v2-canonical";
import {
  conflictingDuplicate,
  crossSheetDuplicate,
  differentHoursDuplicate,
  expansionDuplicate,
  identicalDuplicate,
  liveReadyToCanonicalFixture,
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
  assert(result.canonicalOperations.length === 0, `${label}: fail closed`);
  assert(
    result.conflicts.some((e) => e.errorCode === "conflicting_assignment_duplicate"),
    `${label}: explicit conflict`,
  );
}

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

console.log(
  JSON.stringify({
    harness: "teaching-assignments-v2-duplicate-contract",
    sourceReadyRows: liveCounts.sourceReadyRows,
    canonicalOperations: liveCounts.canonicalOperations.length,
    ok: true,
  }),
);

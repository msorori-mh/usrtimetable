import { canonicalizeTeachingAssignmentsV2 } from "../../src/lib/excel-import/teaching-assignments-v2-canonical";
import { preflightCanonicalTeachingHours } from "../../src/lib/excel-import/teaching-assignments-v2-hours-preflight";
import {
  STAGE_03I_J_EXPECTED,
  stage03iJCorrectedReadySourceRows,
  stage03iJLegacyRows,
  stage03iJMissingAssignedHoursRows,
  stage03iJReadySourceRows,
  stage03iJStrictDowngrades,
} from "../fixtures/teaching-assignments-targeted-hours/stage-03i-j";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hoursErrors(rows: typeof stage03iJReadySourceRows) {
  const canonical = canonicalizeTeachingAssignmentsV2(rows);
  const preflight = preflightCanonicalTeachingHours({
    canonicalOperations: canonical.canonicalOperations,
  });
  return { canonical, preflight };
}

const before = hoursErrors(stage03iJReadySourceRows);
const after = hoursErrors(stage03iJCorrectedReadySourceRows);
const missing = hoursErrors(stage03iJMissingAssignedHoursRows);

assert(
  stage03iJReadySourceRows.length === STAGE_03I_J_EXPECTED.readySourceRows,
  "93 READY source rows are preserved",
);
assert(
  before.canonical.sourceReadyRows === STAGE_03I_J_EXPECTED.readySourceRows,
  "canonicalizer reports all 93 READY source rows",
);
assert(
  before.canonical.canonicalOperations.length === STAGE_03I_J_EXPECTED.canonicalOperations,
  "93 READY rows canonicalize to 87 operations",
);
assert(
  before.preflight.errors.filter((error) => error.errorCode === "CO_TEACHING_HOURS_OVER_ALLOCATED")
    .length === STAGE_03I_J_EXPECTED.invalidHoursBeforeFix,
  "the uncorrected fixture identifies all four invalid co-teacher rows",
);
assert(
  after.canonical.canonicalOperations.length === STAGE_03I_J_EXPECTED.canonicalOperations,
  "the hours-only fixture correction does not change canonical keys",
);
assert(
  after.preflight.errors.length === STAGE_03I_J_EXPECTED.invalidHoursAfterFixture,
  "the corrected 1+1 co-teacher fixture has no invalid hours",
);
assert(
  after.canonical.canonicalOperations
    .filter((row) => String(row.values._delivery_group_id).startsWith("fr231-"))
    .every(
      (row) => row.values.component_total_hours === 2 && row.values.assigned_component_hours === 1,
    ),
  "FR231 keeps component total 2 while EMP012 and EMP017 each receive assigned hours 1",
);
assert(
  missing.preflight.errors.filter(
    (error) => error.errorCode === "CO_TEACHER_ASSIGNED_HOURS_REQUIRED",
  ).length === 4,
  "missing assigned-hours fixture blocks all four regular/parallel FR231 operations",
);
assert(
  stage03iJMissingAssignedHoursRows.filter((row) => {
    const key = `${String(row.values._delivery_group_id)}|${String(row.values._instructor_id)}`;
    return !missing.preflight.blockedNaturalKeys.has(key);
  }).length === 89,
  "missing assigned-hours fixture has 89 safe source rows and no four-row false READY",
);
assert(
  missing.canonical.canonicalOperations.filter((row) => {
    const key = `${String(row.values._delivery_group_id)}|${String(row.values._instructor_id)}`;
    return !missing.preflight.blockedNaturalKeys.has(key);
  }).length === 83,
  "missing assigned-hours fixture has only 83 safe canonical operations",
);
assert(
  [...after.preflight.instructorTotals.values()].every((hours) => hours <= 18),
  "no instructor is overallocated",
);
assert(
  stage03iJStrictDowngrades.length === STAGE_03I_J_EXPECTED.strictDowngrades,
  "all 63 strict downgrades remain excluded from READY",
);
assert(
  stage03iJStrictDowngrades.every((row) => row.outcome === "AMBIGUOUS"),
  "strict downgrades are never promoted to READY",
);
assert(
  stage03iJLegacyRows.every((row) => row.delivery_group_id === null) &&
    after.canonical.canonicalOperations.every((row) => row.values._delivery_group_id),
  "Legacy rows never mix with canonical V2 operations",
);

const deliveryGroupScopes = new Map<string, Set<string>>();
for (const row of after.canonical.canonicalOperations) {
  const deliveryGroup = String(row.values._delivery_group_id);
  const scope = `${String(row.values._term_id)}|${String(row.values.study_system)}`;
  const scopes = deliveryGroupScopes.get(deliveryGroup) ?? new Set<string>();
  scopes.add(scope);
  deliveryGroupScopes.set(deliveryGroup, scopes);
}
assert(
  [...deliveryGroupScopes.values()].every((scopes) => scopes.size === 1),
  "delivery groups never mix terms or regular/parallel systems",
);

console.log(
  JSON.stringify({
    harness: "stage-03i-j-targeted-hours-remediation",
    readySourceRows: stage03iJReadySourceRows.length,
    canonicalOperations: after.canonical.canonicalOperations.length,
    strictDowngrades: stage03iJStrictDowngrades.length,
    invalidHoursBefore: before.preflight.errors.length,
    invalidHoursAfter: after.preflight.errors.length,
    missingAssignedHoursBlocked: missing.preflight.blockedNaturalKeys.size,
    sourceRows: STAGE_03I_J_EXPECTED.sourceRows,
    expandedRows: STAGE_03I_J_EXPECTED.expandedRows,
    dryRun: STAGE_03I_J_EXPECTED.dryRun,
    overallocatedInstructors: 0,
    noLegacyMixing: true,
    noCrossTermMixing: true,
    noRegularParallelMixing: true,
    ok: true,
  }),
);

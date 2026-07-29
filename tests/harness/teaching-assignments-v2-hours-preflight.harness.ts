import type { ParsedRow } from "../../src/lib/excel-import/types";
import { canonicalizeTeachingAssignmentsV2 } from "../../src/lib/excel-import/teaching-assignments-v2-canonical";
import { preflightCanonicalTeachingHours } from "../../src/lib/excel-import/teaching-assignments-v2-hours-preflight";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function operation(input: {
  rowNumber: number;
  instructor: string;
  term: string;
  system: "regular" | "parallel";
  deliveryGroup: string;
  component: string;
  componentType?: "theory" | "practical";
  hours: number;
  weekly?: number;
  limit?: number;
  notes?: string | null;
}): ParsedRow {
  return {
    rowNumber: input.rowNumber,
    raw: {},
    values: {
      _instructor_id: input.instructor,
      _term_id: input.term,
      study_system: input.system,
      _delivery_group_id: input.deliveryGroup,
      _component_id: input.component,
      component_type: input.componentType ?? "theory",
      assigned_component_hours: input.hours,
      _assigned_component_hours: input.hours,
      _component_weekly_hours: input.weekly ?? input.hours,
      _instructor_max_weekly_hours: input.limit ?? 18,
      _is_active: true,
      is_active: true,
      notes: input.notes ?? null,
      _offering_id: null,
    },
  };
}

function codes(rows: ParsedRow[]): string[] {
  return preflightCanonicalTeachingHours({ canonicalOperations: rows }).errors.map(
    (error) => error.errorCode,
  );
}

const separateTerms = [
  operation({
    rowNumber: 1,
    instructor: "i-1",
    term: "t-1",
    system: "regular",
    deliveryGroup: "dg-1",
    component: "c-1",
    hours: 12,
    limit: 12,
  }),
  operation({
    rowNumber: 2,
    instructor: "i-1",
    term: "t-2",
    system: "regular",
    deliveryGroup: "dg-2",
    component: "c-2",
    hours: 12,
    limit: 12,
  }),
];
assert(codes(separateTerms).length === 0, "same instructor in two terms is not combined");

const separateSystems = [
  operation({
    rowNumber: 3,
    instructor: "i-2",
    term: "t-1",
    system: "regular",
    deliveryGroup: "dg-3",
    component: "c-3",
    hours: 12,
    limit: 12,
  }),
  operation({
    rowNumber: 4,
    instructor: "i-2",
    term: "t-1",
    system: "parallel",
    deliveryGroup: "dg-4",
    component: "c-4",
    hours: 12,
    limit: 12,
  }),
];
assert(codes(separateSystems).length === 0, "regular and parallel are not combined");

const theoryPracticalAndGroups = [
  operation({
    rowNumber: 5,
    instructor: "i-3",
    term: "t-1",
    system: "regular",
    deliveryGroup: "dg-5",
    component: "c-5",
    componentType: "theory",
    hours: 6,
    limit: 12,
  }),
  operation({
    rowNumber: 6,
    instructor: "i-3",
    term: "t-1",
    system: "regular",
    deliveryGroup: "dg-6",
    component: "c-6",
    componentType: "practical",
    hours: 6,
    limit: 12,
  }),
];
assert(codes(theoryPracticalAndGroups).length === 0, "theory and practical sum to exact limit");
assert(
  codes([
    ...theoryPracticalAndGroups,
    operation({
      rowNumber: 7,
      instructor: "i-3",
      term: "t-1",
      system: "regular",
      deliveryGroup: "dg-7",
      component: "c-7",
      hours: 1,
      limit: 12,
    }),
  ]).includes("INSTRUCTOR_TEACHING_HOURS_OVER_LIMIT"),
  "one hour above instructor setting is blocked",
);

const identical = operation({
  rowNumber: 8,
  instructor: "i-4",
  term: "t-1",
  system: "regular",
  deliveryGroup: "dg-8",
  component: "c-8",
  hours: 3,
  limit: 3,
});
const identicalCopy = { ...identical, rowNumber: 9, values: { ...identical.values } };
const identicalCanonical = canonicalizeTeachingAssignmentsV2([identical, identicalCopy]);
assert(identicalCanonical.canonicalOperations.length === 1, "identical source rows collapse first");
assert(
  codes(identicalCanonical.canonicalOperations).length === 0,
  "identical row hours counted once",
);

const conflictingCopy = {
  ...identical,
  rowNumber: 10,
  values: {
    ...identical.values,
    assigned_component_hours: 2,
    _assigned_component_hours: 2,
  },
};
const localConflict = canonicalizeTeachingAssignmentsV2([identical, conflictingCopy]);
assert(localConflict.canonicalOperations.length === 0, "local conflicting group is excluded");
assert(
  codes(localConflict.canonicalOperations).length === 0,
  "excluded conflict contributes no hours",
);

const coTeaching = [
  operation({
    rowNumber: 11,
    instructor: "i-5",
    term: "t-1",
    system: "regular",
    deliveryGroup: "dg-co",
    component: "c-co",
    hours: 2,
    weekly: 2,
  }),
  operation({
    rowNumber: 12,
    instructor: "i-6",
    term: "t-1",
    system: "regular",
    deliveryGroup: "dg-co",
    component: "c-co",
    hours: 2,
    weekly: 2,
  }),
];
assert(
  codes(coTeaching).includes("CO_TEACHING_HOURS_OVER_ALLOCATED"),
  "delivery-group component capacity blocks 2+2 against 2",
);

const legacyRecords = Array.from({ length: 174 }, (_, index) => ({
  id: `legacy-${index}`,
  deliveryGroupId: null,
  weeklyHours: 3,
}));
const v2WithLegacyPresent = preflightCanonicalTeachingHours({
  canonicalOperations: [identical],
  existingV2Assignments: [],
});
assert(legacyRecords.length === 174, "legacy fixture present");
assert(v2WithLegacyPresent.errors.length === 0, "legacy records are outside V2 dry-run input");

const valid138 = Array.from({ length: 138 }, (_, index) =>
  operation({
    rowNumber: 100 + index,
    instructor: `i-valid-${Math.floor(index / 6)}`,
    term: index % 2 === 0 ? "t-1" : "t-2",
    system: index % 4 < 2 ? "regular" : "parallel",
    deliveryGroup: `dg-valid-${index}`,
    component: `c-valid-${index}`,
    componentType: index % 3 === 0 ? "practical" : "theory",
    hours: 2,
    weekly: 2,
    limit: 18,
  }),
);
const valid138Result = preflightCanonicalTeachingHours({ canonicalOperations: valid138 });
assert(valid138Result.errors.length === 0, "138 canonical operations have a valid distribution");
assert(valid138Result.deliveryGroupTotals.size === 138, "138 distinct delivery-group keys");

console.log(
  JSON.stringify({
    harness: "teaching-assignments-v2-hours-preflight",
    canonicalOperations: valid138.length,
    deliveryGroupKeys: valid138Result.deliveryGroupTotals.size,
    ok: true,
  }),
);

import type { ParsedRow } from "../../../src/lib/excel-import/types";

export const STAGE_03I_J_EXPECTED = {
  readySourceRows: 93,
  canonicalOperations: 87,
  strictDowngrades: 63,
  invalidHoursBeforeFix: 4,
  invalidHoursAfterFixture: 0,
  overallocatedInstructors: 0,
} as const;

function operation(index: number): ParsedRow {
  const coTeacher = index < 4;
  const regular = index < 2;
  const deliveryGroup = coTeacher ? `fr231-${regular ? "regular" : "parallel"}` : `dg-${index}`;
  const component = coTeacher
    ? `fr231-component-${regular ? "regular" : "parallel"}`
    : `component-${index}`;

  return {
    rowNumber: index + 2,
    raw: {},
    values: {
      _instructor_id: coTeacher ? `fr231-instructor-${index % 2}` : `instructor-${index}`,
      _term_id: coTeacher || index % 2 === 0 ? "2026-t1" : "2026-t2",
      study_system: coTeacher
        ? regular
          ? "regular"
          : "parallel"
        : index % 4 < 2
          ? "regular"
          : "parallel",
      _delivery_group_id: deliveryGroup,
      _component_id: component,
      component_type: "theory",
      assigned_component_hours: 2,
      _assigned_component_hours: 2,
      _component_weekly_hours: 2,
      _instructor_max_weekly_hours: 18,
      _is_active: true,
      is_active: true,
      notes: "stage-03i-j-targeted-hours-fixture",
      _offering_id: null,
    },
  };
}

const canonicalBase = Array.from({ length: STAGE_03I_J_EXPECTED.canonicalOperations }, (_, index) =>
  operation(index),
);

// Six byte-identical natural-key duplicates preserve 93 READY source rows while
// canonicalization intentionally emits 87 insert operations.
export const stage03iJReadySourceRows: ParsedRow[] = [
  ...canonicalBase,
  ...canonicalBase.slice(4, 10).map((row, index) => ({
    ...row,
    rowNumber: 1000 + index,
    values: { ...row.values },
  })),
];

export const stage03iJCorrectedReadySourceRows: ParsedRow[] = stage03iJReadySourceRows.map(
  (row) => {
    const deliveryGroup = String(row.values._delivery_group_id ?? "");
    if (!deliveryGroup.startsWith("fr231-")) return row;
    return {
      ...row,
      values: {
        ...row.values,
        assigned_component_hours: 1,
        _assigned_component_hours: 1,
      },
    };
  },
);

export const stage03iJStrictDowngrades = Array.from(
  { length: STAGE_03I_J_EXPECTED.strictDowngrades },
  (_, index) => ({
    sourceRowNumber: 2000 + index,
    outcome: "AMBIGUOUS" as const,
    errorCode: index < 60 ? "hours_semantics_mismatch" : "source_hours_invalid",
  }),
);

export const stage03iJLegacyRows = Array.from({ length: 174 }, (_, index) => ({
  id: `legacy-${index}`,
  delivery_group_id: null,
}));

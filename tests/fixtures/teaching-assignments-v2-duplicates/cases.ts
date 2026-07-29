import type { ParsedRow } from "../../../src/lib/excel-import/types";

function row(
  rowNumber: number,
  sheet: string,
  deliveryGroupId: string,
  instructorId: string,
  hours: number,
  notes: string | null = null,
): ParsedRow {
  return {
    rowNumber,
    raw: {},
    values: {
      _delivery_group_id: deliveryGroupId,
      _instructor_id: instructorId,
      _assigned_component_hours: hours,
      assigned_component_hours: hours,
      _is_active: true,
      _offering_id: null,
      notes,
      expected_students: 0,
      required_room_type: null,
      component_type: "theory",
      _source_sheet: sheet,
      _source_row_number: rowNumber,
      _expansion_index: rowNumber,
    },
  };
}

export const identicalDuplicate = [
  row(2, "S1", "dg-1", "ins-1", 2),
  row(3, "S1", "dg-1", "ins-1", 2),
];

export const differentHoursDuplicate = [
  row(4, "S1", "dg-2", "ins-1", 2),
  row(5, "S1", "dg-2", "ins-1", 3),
];

export const crossSheetDuplicate = [
  row(6, "S1", "dg-3", "ins-2", 2),
  row(2, "S2", "dg-3", "ins-2", 2),
];

export const expansionDuplicate = [
  row(7, "S1", "dg-4", "ins-3", 1),
  row(7, "S1", "dg-4", "ins-3", 1),
];

export const conflictingDuplicate = [
  row(8, "S1", "dg-5", "ins-4", 2, "أ"),
  row(9, "S2", "dg-5", "ins-4", 2, "ب"),
];

export const mixedSafeAndConflictingDuplicates = [
  row(10, "S1", "dg-safe", "ins-safe", 2),
  row(11, "S1", "dg-conflict", "ins-conflict", 2),
  row(12, "S2", "dg-conflict", "ins-conflict", 3),
  row(13, "S3", "dg-conflict", "ins-conflict", 2),
];

export const liveReadyToCanonicalFixture: ParsedRow[] = Array.from({ length: 142 }, (_, index) =>
  row(index + 2, "LIVE-ANON", `dg-live-${index + 1}`, `ins-live-${index + 1}`, 2),
);

for (let index = 0; index < 14; index++) {
  const original = liveReadyToCanonicalFixture[index];
  liveReadyToCanonicalFixture.push({
    ...original,
    rowNumber: 200 + index,
    raw: { ...original.raw },
    values: {
      ...original.values,
      _source_sheet: index % 2 === 0 ? "LIVE-ANON-2" : "LIVE-ANON",
      _source_row_number: 200 + index,
      _expansion_index: 143 + index,
    },
  });
}

export const livePartialConflictFixture: ParsedRow[] = Array.from({ length: 130 }, (_, index) =>
  row(index + 2, "LIVE-PARTIAL", `dg-single-${index + 1}`, `ins-single-${index + 1}`, 2),
);

for (let index = 0; index < 8; index++) {
  livePartialConflictFixture.push(
    row(200 + index * 2, "LIVE-PARTIAL", `dg-identical-${index + 1}`, "ins-identical", 2),
    row(201 + index * 2, "LIVE-PARTIAL-2", `dg-identical-${index + 1}`, "ins-identical", 2),
  );
}

for (let index = 0; index < 4; index++) {
  const members = index < 2 ? 3 : 2;
  for (let member = 0; member < members; member++) {
    livePartialConflictFixture.push(
      row(
        300 + index * 10 + member,
        "LIVE-CONFLICT",
        `dg-conflict-${index + 1}`,
        "ins-conflict",
        member === 0 ? 2 : 3,
      ),
    );
  }
}

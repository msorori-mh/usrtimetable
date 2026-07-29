import type { ParsedRow, RowError } from "./types";

export interface TeachingAssignmentV2Provenance {
  sourceSheet: string;
  sourceRowNumber: number;
  expansionIndex: number;
}

export interface CanonicalTeachingAssignmentsV2Result {
  sourceReadyRows: number;
  canonicalOperations: ParsedRow[];
  conflicts: RowError[];
}

const OPERATIONAL_FIELDS = [
  "_delivery_group_id",
  "_instructor_id",
  "_assigned_component_hours",
  "assigned_component_hours",
  "_is_active",
  "is_active",
  "_offering_id",
  "notes",
  "expected_students",
  "required_room_type",
  "component_type",
] as const;

function normalizedValue(value: unknown): unknown {
  if (value === undefined || value === "") return null;
  if (typeof value === "number") return Number(value);
  if (typeof value === "string") return value.trim();
  return value;
}

function naturalKey(row: ParsedRow): string | null {
  const deliveryGroupId = String(row.values._delivery_group_id ?? "").trim();
  const instructorId = String(row.values._instructor_id ?? "").trim();
  return deliveryGroupId && instructorId ? `${deliveryGroupId}|${instructorId}` : null;
}

function operationFingerprint(row: ParsedRow): string {
  return JSON.stringify(
    OPERATIONAL_FIELDS.map((field) => [field, normalizedValue(row.values[field])]),
  );
}

function provenanceFor(row: ParsedRow, fallbackIndex: number): TeachingAssignmentV2Provenance {
  return {
    sourceSheet: String(row.values._source_sheet ?? row.raw._source_sheet ?? "unknown"),
    sourceRowNumber: Number(row.values._source_row_number ?? row.rowNumber),
    expansionIndex: Number(row.values._expansion_index ?? fallbackIndex),
  };
}

export function canonicalizeTeachingAssignmentsV2(
  rows: ParsedRow[],
): CanonicalTeachingAssignmentsV2Result {
  const byNaturalKey = new Map<
    string,
    { canonical: ParsedRow; fingerprint: string; provenance: TeachingAssignmentV2Provenance[] }
  >();
  const conflictingNaturalKeys = new Set<string>();
  const conflicts: RowError[] = [];

  rows.forEach((row, index) => {
    const key = naturalKey(row);
    if (!key) {
      conflicts.push({
        rowNumber: row.rowNumber,
        columnName: "delivery_group_id|instructor_id",
        errorCode: "missing_assignment_natural_key",
        message: "تعذر تكوين المفتاح الطبيعي للإسناد",
      });
      return;
    }

    const fingerprint = operationFingerprint(row);
    const provenance = provenanceFor(row, index + 1);
    if (conflictingNaturalKeys.has(key)) {
      conflicts.push({
        rowNumber: row.rowNumber,
        columnName: "delivery_group_id|instructor_id",
        errorCode: "conflicting_assignment_duplicate",
        message: `إسنادات متعارضة للمفتاح الطبيعي ${key}`,
        rawValue: JSON.stringify([provenance]),
      });
      return;
    }

    const existing = byNaturalKey.get(key);
    if (!existing) {
      byNaturalKey.set(key, {
        canonical: {
          ...row,
          raw: { ...row.raw },
          values: { ...row.values, _source_provenance: [provenance] },
        },
        fingerprint,
        provenance: [provenance],
      });
      return;
    }

    if (existing.fingerprint !== fingerprint) {
      conflictingNaturalKeys.add(key);
      conflicts.push({
        rowNumber: row.rowNumber,
        columnName: "delivery_group_id|instructor_id",
        errorCode: "conflicting_assignment_duplicate",
        message: `إسنادات متعارضة للمفتاح الطبيعي ${key}`,
        rawValue: JSON.stringify([...existing.provenance, provenance]),
      });
      return;
    }

    existing.provenance.push(provenance);
    existing.canonical.values._source_provenance = [...existing.provenance];
  });

  return {
    sourceReadyRows: rows.length,
    canonicalOperations: [...byNaturalKey.entries()]
      .filter(([key]) => !conflictingNaturalKeys.has(key))
      .map(([, value]) => value.canonical),
    conflicts,
  };
}

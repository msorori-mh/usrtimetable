import type { ParsedRow, RowError } from "./types";

type TeachingHoursOperation = {
  row: ParsedRow;
  instructorId: string;
  termId: string;
  studySystem: string;
  deliveryGroupId: string;
  componentId: string;
  componentType: string;
  assignedHours: number;
  componentWeeklyHours: number;
  instructorMaxWeeklyHours: number | null;
};

export type ExistingTeachingAssignmentV2Hours = {
  instructorId: string;
  termId: string;
  studySystem: string;
  deliveryGroupId: string;
  componentId: string;
  componentType: string;
  assignedHours: number;
  componentWeeklyHours: number;
  instructorMaxWeeklyHours: number | null;
  isActive: boolean;
};

export type TeachingHoursPreflightResult = {
  errors: RowError[];
  deliveryGroupTotals: Map<string, number>;
  instructorTotals: Map<string, number>;
};

function requiredString(row: ParsedRow, key: string): string | null {
  const value = String(row.values[key] ?? "").trim();
  return value || null;
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function operationFromCanonicalRow(row: ParsedRow): TeachingHoursOperation | null {
  const instructorId = requiredString(row, "_instructor_id");
  const termId = requiredString(row, "_term_id");
  const studySystem = requiredString(row, "study_system");
  const deliveryGroupId = requiredString(row, "_delivery_group_id");
  const componentId = requiredString(row, "_component_id");
  const componentType = requiredString(row, "component_type");
  const assignedHours = finiteNumber(
    row.values._assigned_component_hours ?? row.values.assigned_component_hours,
  );
  const componentWeeklyHours = finiteNumber(row.values._component_weekly_hours);
  if (
    !instructorId ||
    !termId ||
    !studySystem ||
    !deliveryGroupId ||
    !componentId ||
    !componentType ||
    assignedHours === null ||
    componentWeeklyHours === null
  ) {
    return null;
  }
  return {
    row,
    instructorId,
    termId,
    studySystem,
    deliveryGroupId,
    componentId,
    componentType,
    assignedHours,
    componentWeeklyHours,
    instructorMaxWeeklyHours: finiteNumber(row.values._instructor_max_weekly_hours),
  };
}

function deliveryGroupKey(operation: Omit<TeachingHoursOperation, "row">): string {
  return [
    operation.termId,
    operation.studySystem,
    operation.deliveryGroupId,
    operation.componentId,
  ].join("|");
}

function instructorKey(operation: Omit<TeachingHoursOperation, "row">): string {
  return [operation.instructorId, operation.termId, operation.studySystem].join("|");
}

function countsTowardWeeklyLimit(componentType: string): boolean {
  return componentType !== "project" && componentType !== "summer_training";
}

/**
 * Audits canonical V2 operations only. Legacy assignments have no delivery group and are not
 * accepted by this contract. Existing active V2 rows may be supplied separately for a dry-run.
 */
export function preflightCanonicalTeachingHours(input: {
  canonicalOperations: ParsedRow[];
  existingV2Assignments?: ExistingTeachingAssignmentV2Hours[];
}): TeachingHoursPreflightResult {
  const operations = input.canonicalOperations
    .map(operationFromCanonicalRow)
    .filter((operation): operation is TeachingHoursOperation => operation !== null);
  const errors: RowError[] = [];
  const deliveryGroupTotals = new Map<string, number>();
  const deliveryGroupLimits = new Map<string, number>();
  const deliveryGroupRows = new Map<string, ParsedRow[]>();
  const instructorTotals = new Map<string, number>();
  const instructorLimits = new Map<string, number>();

  const add = (
    operation: Omit<TeachingHoursOperation, "row">,
    rowNumber: number,
    naturalKey: string,
  ) => {
    const dgKey = deliveryGroupKey(operation);
    deliveryGroupTotals.set(dgKey, (deliveryGroupTotals.get(dgKey) ?? 0) + operation.assignedHours);
    deliveryGroupLimits.set(dgKey, operation.componentWeeklyHours);

    if (countsTowardWeeklyLimit(operation.componentType)) {
      const insKey = instructorKey(operation);
      instructorTotals.set(insKey, (instructorTotals.get(insKey) ?? 0) + operation.assignedHours);
      if (operation.instructorMaxWeeklyHours !== null) {
        instructorLimits.set(insKey, operation.instructorMaxWeeklyHours);
      }
    }

    if (operation.assignedHours <= 0) {
      errors.push({
        rowNumber,
        columnName: "assigned_component_hours",
        errorCode: "ASSIGNED_HOURS_MUST_BE_POSITIVE",
        message: `ساعات الإسناد يجب أن تكون موجبة للمفتاح ${naturalKey}`,
      });
    }
  };

  for (const existing of input.existingV2Assignments ?? []) {
    if (!existing.isActive) continue;
    add(existing, 0, `${existing.deliveryGroupId}|${existing.instructorId}`);
  }
  for (const operation of operations) {
    const dgKey = deliveryGroupKey(operation);
    const rows = deliveryGroupRows.get(dgKey) ?? [];
    rows.push(operation.row);
    deliveryGroupRows.set(dgKey, rows);
    add(
      operation,
      operation.row.rowNumber,
      `${operation.deliveryGroupId}|${operation.instructorId}`,
    );
  }

  for (const [key, total] of deliveryGroupTotals) {
    const limit = deliveryGroupLimits.get(key) ?? 0;
    if (total > limit + 0.001) {
      const affectedRows = deliveryGroupRows.get(key) ?? [];
      const rowNumbers = affectedRows.length > 0 ? affectedRows.map((row) => row.rowNumber) : [0];
      for (const rowNumber of rowNumbers) {
        errors.push({
          rowNumber,
          columnName: "assigned_component_hours",
          errorCode: "CO_TEACHING_HOURS_OVER_ALLOCATED",
          message: `مجموع ساعات مجموعة التقديم ${total} يتجاوز ساعات المكوّن ${limit} (${key})`,
        });
      }
    }
  }

  for (const [key, total] of instructorTotals) {
    const limit = instructorLimits.get(key);
    if (limit !== undefined && total > limit + 0.001) {
      errors.push({
        rowNumber: 0,
        columnName: "assigned_component_hours",
        errorCode: "INSTRUCTOR_TEACHING_HOURS_OVER_LIMIT",
        message: `ساعات المحاضر ${total} تتجاوز الحد الأسبوعي ${limit} (${key})`,
      });
    }
  }

  return { errors, deliveryGroupTotals, instructorTotals };
}

import type { ParsedRow, RowError } from "./types";

type TeachingHoursOperation = {
  row: ParsedRow;
  naturalKey: string;
  instructorId: string;
  termId: string;
  studySystem: string;
  deliveryGroupId: string;
  componentId: string;
  componentType: string;
  assignedHours: number | null;
  componentTotalHours: number;
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

export type CoTeachingGroupSummary = {
  coTeacherCount: number;
  componentTotalHours: number;
  assignedTotalHours: number | null;
  validationStatus: "READY" | string;
};

export type TeachingHoursPreflightResult = {
  errors: RowError[];
  deliveryGroupTotals: Map<string, number>;
  instructorTotals: Map<string, number>;
  blockedNaturalKeys: Set<string>;
  groupSummaries: Map<string, CoTeachingGroupSummary>;
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

export function teachingAssignmentNaturalKey(row: ParsedRow): string | null {
  const deliveryGroupId = requiredString(row, "_delivery_group_id");
  const instructorId = requiredString(row, "_instructor_id");
  return deliveryGroupId && instructorId ? `${deliveryGroupId}|${instructorId}` : null;
}

function operationFromCanonicalRow(row: ParsedRow): TeachingHoursOperation | null {
  const instructorId = requiredString(row, "_instructor_id");
  const termId = requiredString(row, "_term_id");
  const studySystem = requiredString(row, "study_system");
  const deliveryGroupId = requiredString(row, "_delivery_group_id");
  const componentId = requiredString(row, "_component_id");
  const componentType = requiredString(row, "component_type");
  const naturalKey = teachingAssignmentNaturalKey(row);
  const assignedHours = finiteNumber(
    row.values._assigned_component_hours ?? row.values.assigned_component_hours,
  );
  const componentWeeklyHours = finiteNumber(row.values._component_weekly_hours);
  const componentTotalHours = finiteNumber(
    row.values._component_total_hours ??
      row.values.component_total_hours ??
      row.values._component_weekly_hours,
  );
  if (
    !instructorId ||
    !termId ||
    !studySystem ||
    !deliveryGroupId ||
    !componentId ||
    !componentType ||
    !naturalKey ||
    componentTotalHours === null ||
    componentWeeklyHours === null
  ) {
    return null;
  }
  return {
    row,
    naturalKey,
    instructorId,
    termId,
    studySystem,
    deliveryGroupId,
    componentId,
    componentType,
    assignedHours,
    componentTotalHours,
    componentWeeklyHours,
    instructorMaxWeeklyHours: finiteNumber(row.values._instructor_max_weekly_hours),
  };
}

function deliveryGroupKey(
  operation: Pick<
    TeachingHoursOperation,
    "termId" | "studySystem" | "deliveryGroupId" | "componentId"
  >,
): string {
  return [
    operation.deliveryGroupId,
    operation.componentId,
    operation.termId,
    operation.studySystem,
  ].join("|");
}

function instructorKey(
  operation: Pick<TeachingHoursOperation, "instructorId" | "termId" | "studySystem">,
): string {
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
  const blockedNaturalKeys = new Set<string>();
  const deliveryGroupTotals = new Map<string, number>();
  const instructorTotals = new Map<string, number>();
  const instructorLimits = new Map<string, number>();
  const groupOperations = new Map<string, TeachingHoursOperation[]>();
  const groupSummaries = new Map<string, CoTeachingGroupSummary>();

  const addInstructorHours = (
    operation: Pick<
      TeachingHoursOperation,
      | "assignedHours"
      | "componentType"
      | "instructorId"
      | "termId"
      | "studySystem"
      | "instructorMaxWeeklyHours"
    >,
  ) => {
    if (
      operation.assignedHours === null ||
      operation.assignedHours <= 0 ||
      !countsTowardWeeklyLimit(operation.componentType)
    ) {
      return;
    }
    const key = instructorKey(operation);
    instructorTotals.set(key, (instructorTotals.get(key) ?? 0) + operation.assignedHours);
    if (operation.instructorMaxWeeklyHours !== null) {
      instructorLimits.set(key, operation.instructorMaxWeeklyHours);
    }
  };

  for (const existing of input.existingV2Assignments ?? []) {
    if (!existing.isActive) continue;
    addInstructorHours(existing);
  }

  for (const operation of operations) {
    const key = deliveryGroupKey(operation);
    const members = groupOperations.get(key) ?? [];
    members.push(operation);
    groupOperations.set(key, members);
    addInstructorHours(operation);
  }

  for (const [key, members] of groupOperations) {
    const componentTotals = new Set(members.map((member) => member.componentTotalHours));
    const componentTotalHours = members[0]?.componentTotalHours ?? 0;
    const componentWeeklyHours = members[0]?.componentWeeklyHours ?? 0;
    const coTeacherCount = new Set(members.map((member) => member.instructorId)).size;
    const assignedValues = members.map((member) => member.assignedHours);
    const assignedTotalHours = assignedValues.every(
      (hours): hours is number => hours !== null && Number.isFinite(hours),
    )
      ? assignedValues.reduce((total, hours) => total + hours, 0)
      : null;
    if (assignedTotalHours !== null) deliveryGroupTotals.set(key, assignedTotalHours);

    let validationStatus = "READY";
    const blockGroup = (errorCode: string, message: string) => {
      validationStatus = errorCode;
      for (const member of members) {
        blockedNaturalKeys.add(member.naturalKey);
        errors.push({
          rowNumber: member.row.rowNumber,
          columnName: "assigned_component_hours",
          errorCode,
          message,
        });
      }
    };

    if (
      componentTotals.size !== 1 ||
      Math.abs(componentTotalHours - componentWeeklyHours) >= 0.001
    ) {
      blockGroup(
        "COMPONENT_TOTAL_HOURS_MISMATCH",
        `إجمالي ساعات المحاضرة ${componentTotalHours} لا يطابق ساعات الخطة ${componentWeeklyHours} (${key})`,
      );
    } else if (assignedValues.some((hours) => hours === null)) {
      blockGroup(
        "CO_TEACHER_ASSIGNED_HOURS_REQUIRED",
        `ساعات كل محاضر مطلوبة صراحة عند التدريس المشترك (${key})`,
      );
    } else if (assignedValues.some((hours) => Number(hours) <= 0)) {
      validationStatus = "ASSIGNED_HOURS_MUST_BE_POSITIVE";
      for (const member of members) {
        if ((member.assignedHours ?? 0) > 0) continue;
        blockedNaturalKeys.add(member.naturalKey);
        errors.push({
          rowNumber: member.row.rowNumber,
          columnName: "assigned_component_hours",
          errorCode: "ASSIGNED_HOURS_MUST_BE_POSITIVE",
          message: `ساعات الإسناد يجب أن تكون موجبة للمفتاح ${member.naturalKey}`,
        });
      }
      if ((assignedTotalHours ?? 0) < componentTotalHours - 0.001) {
        blockGroup(
          "CO_TEACHING_HOURS_UNDER_ALLOCATED",
          `مجموع ساعات التدريس المشترك ${assignedTotalHours ?? 0} أقل من إجمالي المحاضرة ${componentTotalHours} (${key})`,
        );
      }
    } else if ((assignedTotalHours ?? 0) > componentTotalHours + 0.001) {
      blockGroup(
        "CO_TEACHING_HOURS_OVER_ALLOCATED",
        `مجموع ساعات التدريس المشترك ${assignedTotalHours} يتجاوز إجمالي المحاضرة ${componentTotalHours} (${key})`,
      );
    } else if ((assignedTotalHours ?? 0) < componentTotalHours - 0.001) {
      blockGroup(
        "CO_TEACHING_HOURS_UNDER_ALLOCATED",
        `مجموع ساعات التدريس المشترك ${assignedTotalHours} أقل من إجمالي المحاضرة ${componentTotalHours} (${key})`,
      );
    }

    groupSummaries.set(key, {
      coTeacherCount,
      componentTotalHours,
      assignedTotalHours,
      validationStatus,
    });
    for (const member of members) {
      member.row.values.co_teacher_count = coTeacherCount;
      member.row.values.co_teaching_group_total = assignedTotalHours;
      member.row.values._validation_status = validationStatus;
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
      for (const operation of operations) {
        if (instructorKey(operation) === key) blockedNaturalKeys.add(operation.naturalKey);
      }
    }
  }

  return {
    errors,
    deliveryGroupTotals,
    instructorTotals,
    blockedNaturalKeys,
    groupSummaries,
  };
}

import {
  derivePlanCourseComponents,
  type ComponentType,
  type ExplicitHoursInput,
} from "./plan-course-components";
import { normalizeToken, resolveAliasToCanonical } from "@/lib/excel-import/room-type-normalize";

export type PlanRoomTypeField =
  | "required_room_type_code_lecture"
  | "required_room_type_code_practical"
  | "required_room_type_code_tutorial"
  | "required_room_type_code_project";

export type PlanRoomTypeErrorCode =
  | "ROOM_TYPE_CODE_REQUIRED"
  | "ROOM_TYPE_CODE_UNKNOWN"
  | "ROOM_TYPE_CODE_AMBIGUOUS"
  | "ROOM_TYPE_INACTIVE"
  | "ROOM_TYPE_ZERO_CAPACITY"
  | "ROOM_TYPE_WRONG_COLLEGE"
  | "ROOM_TYPE_ALIAS_CONFLICT";

export const PLAN_ROOM_TYPE_HEADERS: Record<PlanRoomTypeField, string> = {
  required_room_type_code_lecture: "نوع_قاعة_المحاضرة_رمز",
  required_room_type_code_practical: "نوع_قاعة_العملي_رمز",
  required_room_type_code_tutorial: "نوع_قاعة_التمرين_رمز",
  required_room_type_code_project: "نوع_قاعة_المشروع_رمز",
};

export const PLAN_ROOM_TYPE_ALIASES = {
  required_room_type_code_lecture: ["نوع_قاعة_المحاضرة", "required_room_type_for_lecture"],
  required_room_type_code_practical: ["نوع_قاعة_المعمل", "required_room_type_for_lab"],
  required_room_type_code_tutorial: [],
  required_room_type_code_project: [],
} satisfies Record<PlanRoomTypeField, string[]>;

const COMPONENT_FIELD: Record<Exclude<ComponentType, "summer_training">, PlanRoomTypeField> = {
  theory: "required_room_type_code_lecture",
  practical: "required_room_type_code_practical",
  tutorial: "required_room_type_code_tutorial",
  project: "required_room_type_code_project",
};

export interface RoomTypeCatalogEntry {
  id: string;
  code: string;
  college_id: string;
  is_active: boolean;
  default_capacity: number;
}

export interface PlanRoomTypeContext {
  rowNumber: number;
  programCode: string;
  courseCode: string;
  courseName: string;
  levelNumber: number | string;
  semester: number | string;
}

export interface PlanRoomTypeError extends PlanRoomTypeContext {
  errorCode: PlanRoomTypeErrorCode;
  componentType: ComponentType;
  componentHours: number;
  field: PlanRoomTypeField;
  rawValue?: string;
  reason: string;
  message: string;
}

export type PlanRoomTypeValues = Partial<Record<PlanRoomTypeField, unknown>> &
  Record<string, unknown>;

function canonical(raw: unknown): string | null {
  const token = normalizeToken(raw == null ? null : String(raw));
  return token ? resolveAliasToCanonical(token) : null;
}

function present(raw: unknown): boolean {
  return raw != null && String(raw).trim() !== "";
}

export function resolvePlanRoomTypeField(
  field: PlanRoomTypeField,
  values: PlanRoomTypeValues,
): { raw: string | null; canonicalCode: string | null; conflict: boolean } {
  const candidates = [field, ...PLAN_ROOM_TYPE_ALIASES[field]]
    .map((key) => values[key])
    .filter(present)
    .map((raw) => ({ raw: String(raw).trim(), canonical: canonical(raw) }));
  const distinct = new Set(
    candidates.map((item) => item.canonical ?? `?${item.raw.toLowerCase()}`),
  );
  return {
    raw: candidates[0]?.raw ?? null,
    canonicalCode: candidates[0]?.canonical ?? null,
    conflict: distinct.size > 1,
  };
}

function error(
  context: PlanRoomTypeContext,
  componentType: ComponentType,
  componentHours: number,
  field: PlanRoomTypeField,
  errorCode: PlanRoomTypeErrorCode,
  rawValue: string | null,
  reason: string,
): PlanRoomTypeError {
  const message = [
    `Excel row=${context.rowNumber}`,
    `program=${context.programCode}`,
    `course=${context.courseCode} (${context.courseName})`,
    `level=${context.levelNumber}`,
    `semester=${context.semester}`,
    `component=${componentType}`,
    `hours=${componentHours}`,
    `field=${field}`,
    `raw=${rawValue ?? "<empty>"}`,
    `reason=${reason}`,
  ].join("; ");
  return {
    ...context,
    componentType,
    componentHours,
    field,
    errorCode,
    rawValue: rawValue ?? undefined,
    reason,
    message,
  };
}

/**
 * Resolve every schedulable positive-hour component. Summer training is intentionally
 * excluded because it is non-timetabled; callers that schedule it must fail separately
 * with SUMMER_TRAINING_ROOM_POLICY_REQUIRED.
 */
export function validatePlanComponentRoomTypes(input: {
  context: PlanRoomTypeContext;
  hours: ExplicitHoursInput;
  values: PlanRoomTypeValues;
  collegeId: string;
  catalog: RoomTypeCatalogEntry[];
}): {
  errors: PlanRoomTypeError[];
  resolvedIds: Partial<Record<ComponentType, string>>;
} {
  const errors: PlanRoomTypeError[] = [];
  const resolvedIds: Partial<Record<ComponentType, string>> = {};

  for (const component of derivePlanCourseComponents(input.hours)) {
    if (
      component.component_type === "summer_training" ||
      !component.is_timetabled ||
      component.weekly_contact_hours <= 0
    ) {
      continue;
    }
    const field = COMPONENT_FIELD[component.component_type];
    const resolved = resolvePlanRoomTypeField(field, input.values);
    const fail = (code: PlanRoomTypeErrorCode, reason: string) =>
      errors.push(
        error(
          input.context,
          component.component_type,
          component.weekly_contact_hours,
          field,
          code,
          resolved.raw,
          reason,
        ),
      );
    if (resolved.conflict) {
      fail("ROOM_TYPE_ALIAS_CONFLICT", "canonical and alias values disagree");
      continue;
    }
    if (!resolved.raw) {
      fail("ROOM_TYPE_CODE_REQUIRED", "positive schedulable component hours require a code");
      continue;
    }
    if (!resolved.canonicalCode) {
      fail("ROOM_TYPE_CODE_UNKNOWN", "code or alias is not recognized");
      continue;
    }
    const matches = input.catalog.filter((row) => canonical(row.code) === resolved.canonicalCode);
    const local = matches.filter((row) => row.college_id === input.collegeId);
    if (local.length === 0 && matches.length > 0) {
      fail("ROOM_TYPE_WRONG_COLLEGE", "code exists only outside the plan college");
      continue;
    }
    if (local.length === 0) {
      fail("ROOM_TYPE_CODE_UNKNOWN", "canonical code does not exist");
      continue;
    }
    if (local.length !== 1) {
      fail("ROOM_TYPE_CODE_AMBIGUOUS", "canonical code resolves more than once");
      continue;
    }
    const roomType = local[0];
    if (!roomType.is_active) {
      fail("ROOM_TYPE_INACTIVE", "resolved room type is inactive");
      continue;
    }
    if (!(Number(roomType.default_capacity) > 0)) {
      fail("ROOM_TYPE_ZERO_CAPACITY", "resolved room type capacity is not positive");
      continue;
    }
    resolvedIds[component.component_type] = roomType.id;
  }
  return { errors, resolvedIds };
}

export function buildPlanComponentSyncPayload(
  hours: ExplicitHoursInput,
  resolvedIds: Partial<Record<ComponentType, string>>,
) {
  return derivePlanCourseComponents(hours).map((component) => ({
    ...component,
    required_room_type_id:
      component.is_timetabled && component.weekly_contact_hours > 0
        ? (resolvedIds[component.component_type] ?? null)
        : null,
  }));
}

export type PlanComponentRoomTypeIssueCode =
  | "NULL_REQUIRED_ROOM_TYPE"
  | "ORPHAN_ROOM_TYPE"
  | "INACTIVE_ROOM_TYPE"
  | "ZERO_CAPACITY_ROOM_TYPE"
  | "WRONG_COLLEGE_ROOM_TYPE";

export interface PlanComponentReadinessRow {
  college_code: string;
  college_id: string;
  program_code: string;
  study_plan_id: string;
  level_number: number;
  semester: number;
  course_code: string;
  course_name: string;
  component_type: ComponentType;
  component_hours: number;
  is_timetabled: boolean;
  room_type_id: string | null;
  room_type_code: string | null;
  room_type_college_id: string | null;
  room_type_active: boolean | null;
  room_type_capacity: number | null;
}

export interface PlanComponentRoomTypeIssue extends PlanComponentReadinessRow {
  issue_code: PlanComponentRoomTypeIssueCode;
  issue_message: string;
}

export function collectPlanComponentRoomTypeIssues(
  rows: PlanComponentReadinessRow[],
): PlanComponentRoomTypeIssue[] {
  return rows.flatMap((row) => {
    if (
      row.component_type === "summer_training" ||
      !row.is_timetabled ||
      row.component_hours <= 0
    ) {
      return [];
    }
    let issue: [PlanComponentRoomTypeIssueCode, string] | null = null;
    if (!row.room_type_id) issue = ["NULL_REQUIRED_ROOM_TYPE", "نوع القاعة مطلوب"];
    else if (!row.room_type_code) issue = ["ORPHAN_ROOM_TYPE", "مرجع نوع القاعة غير موجود"];
    else if (row.room_type_college_id !== row.college_id)
      issue = ["WRONG_COLLEGE_ROOM_TYPE", "نوع القاعة يتبع كلية أخرى"];
    else if (row.room_type_active === false) issue = ["INACTIVE_ROOM_TYPE", "نوع القاعة غير نشط"];
    else if (!(Number(row.room_type_capacity) > 0))
      issue = ["ZERO_CAPACITY_ROOM_TYPE", "سعة نوع القاعة ليست موجبة"];
    return issue ? [{ ...row, issue_code: issue[0], issue_message: issue[1] }] : [];
  });
}

export class MissingRoomTypeComponentsError extends Error {
  readonly code = "MISSING_ROOM_TYPE_COMPONENTS";
  constructor(readonly issues: PlanComponentRoomTypeIssue[]) {
    super(`MISSING_ROOM_TYPE_COMPONENTS: ${issues.length}`);
    this.name = "MissingRoomTypeComponentsError";
  }
}

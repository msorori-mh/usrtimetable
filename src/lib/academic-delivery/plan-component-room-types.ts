/**
 * PLAN-COMPONENT-ROOM-TYPE-PERMANENT-FIX-01 — room type requirements for schedulable
 * plan_course_components. Pure logic (no DB writes); mirrors future import sync + DG gate.
 */

import {
  derivePlanCourseComponents,
  type ComponentType,
  type DerivedComponent,
  type ExplicitHoursInput,
} from "./plan-course-components";
import { normalizeToken, resolveAliasToCanonical } from "@/lib/excel-import/room-type-normalize";
import {
  findTutorialRoomType,
  isLectureHallRoomTypeCode,
  TUTORIAL_ROOM_TYPE_ERROR_AR,
} from "@/lib/academic-delivery/tutorial-room-type";

export type PlanComponentRoomTypeField =
  | "required_room_type_code_lecture"
  | "required_room_type_code_practical"
  | "required_room_type_code_tutorial"
  | "required_room_type_code_project";

export type RoomTypeReferenceState = "NULL" | "ORPHAN" | "INACTIVE" | "ZERO_CAPACITY" | "OK";

export type RoomTypeCatalogEntry = {
  id: string;
  code: string;
  college_id: string;
  is_active: boolean;
  default_capacity: number;
};

const COMPONENT_ROOM_TYPE_FIELD: Record<
  Exclude<ComponentType, "summer_training">,
  PlanComponentRoomTypeField
> = {
  theory: "required_room_type_code_lecture",
  practical: "required_room_type_code_practical",
  tutorial: "required_room_type_code_tutorial",
  project: "required_room_type_code_project",
};

/** Legacy Excel headers → canonical import field keys. */
export const STUDY_PLAN_ROOM_TYPE_HEADER_ALIASES: Record<string, PlanComponentRoomTypeField> = {
  نوع_قاعة_المحاضرة: "required_room_type_code_lecture",
  نوع_قاعة_المعمل: "required_room_type_code_practical",
};

export const STUDY_PLAN_ROOM_TYPE_FIELD_HEADERS: Record<PlanComponentRoomTypeField, string> = {
  required_room_type_code_lecture: "رمز_نوع_قاعة_المحاضرة",
  required_room_type_code_practical: "رمز_نوع_قاعة_المعمل",
  required_room_type_code_tutorial: "رمز_نوع_قاعة_التمرين",
  required_room_type_code_project: "رمز_نوع_قاعة_المشروع",
};

export function roomTypeFieldForComponent(
  componentType: ComponentType,
): PlanComponentRoomTypeField | null {
  if (componentType === "summer_training") return null;
  return COMPONENT_ROOM_TYPE_FIELD[componentType];
}

/** Room type mandatory only when weekly hours > 0 and component enters scheduling. */
export function requiresRoomTypeForComponent(component: DerivedComponent): boolean {
  if (component.component_type === "summer_training") return false;
  if (!component.is_timetabled) return false;
  if (component.weekly_contact_hours <= 0) return false;
  return true;
}

export function classifyRoomTypeReference(
  roomTypeId: string | null | undefined,
  catalogById: Map<string, RoomTypeCatalogEntry>,
  collegeId: string,
): RoomTypeReferenceState {
  if (!roomTypeId) return "NULL";
  const row = catalogById.get(roomTypeId);
  if (!row) return "ORPHAN";
  if (row.college_id !== collegeId) return "ORPHAN";
  if (!row.is_active) return "INACTIVE";
  if (!(row.default_capacity > 0)) return "ZERO_CAPACITY";
  return "OK";
}

export type PlanRoomTypeValidationError = {
  errorCode:
    | "missing_room_type_code"
    | "unknown_room_type_code"
    | "inactive_room_type"
    | "zero_capacity_room_type"
    | "cross_college_room_type"
    | "tutorial_room_type_must_be_lecture_hall"
    | "tutorial_lecture_hall_room_type_missing";
  courseCode: string;
  componentType: ComponentType;
  fieldName: PlanComponentRoomTypeField;
  header: string;
  message: string;
  rawValue?: string;
};

export type PlanRoomTypeCodeInput = Partial<
  Record<PlanComponentRoomTypeField, string | null | undefined>
>;

function resolveCodeToCatalogId(
  rawCode: string | null | undefined,
  catalogByCode: Map<string, RoomTypeCatalogEntry>,
): { canonical: string | null; catalog: RoomTypeCatalogEntry | null } {
  const tok = normalizeToken(rawCode);
  if (!tok) return { canonical: null, catalog: null };
  const canonical = resolveAliasToCanonical(tok);
  if (!canonical) return { canonical: null, catalog: null };
  return { canonical, catalog: catalogByCode.get(canonical) ?? null };
}

/**
 * Validate room type codes for all schedulable components on one import row.
 * Collects every error — never stops at the first failure.
 */
export function validatePlanRowRoomTypes(input: {
  courseCode: string;
  hours: ExplicitHoursInput;
  roomTypeCodes: PlanRoomTypeCodeInput;
  collegeId: string;
  catalog: RoomTypeCatalogEntry[];
}): { errors: PlanRoomTypeValidationError[]; resolvedIds: Partial<Record<ComponentType, string>> } {
  const catalogByCode = new Map(input.catalog.map((r) => [r.code, r]));
  const catalogById = new Map(input.catalog.map((r) => [r.id, r]));
  const components = derivePlanCourseComponents(input.hours);
  const errors: PlanRoomTypeValidationError[] = [];
  const resolvedIds: Partial<Record<ComponentType, string>> = {};

  for (const component of components) {
    if (!requiresRoomTypeForComponent(component)) continue;

    const field = roomTypeFieldForComponent(component.component_type);
    if (!field) continue;

    const header = STUDY_PLAN_ROOM_TYPE_FIELD_HEADERS[field];
    const rawCode = input.roomTypeCodes[field];
    const { canonical, catalog } = resolveCodeToCatalogId(rawCode, catalogByCode);

    // TUTORIAL-LECTURE-HALL-PERMANENT-RULE-01 — tutorial is never a lab.
    if (component.component_type === "tutorial") {
      const provided = normalizeToken(rawCode) ? (canonical ?? String(rawCode)) : null;
      if (provided && !isLectureHallRoomTypeCode(provided)) {
        errors.push({
          errorCode: "tutorial_room_type_must_be_lecture_hall",
          courseCode: input.courseCode,
          componentType: component.component_type,
          fieldName: field,
          header,
          message: `المقرر ${input.courseCode}: ${TUTORIAL_ROOM_TYPE_ERROR_AR.TUTORIAL_ROOM_TYPE_MUST_BE_LECTURE_HALL}`,
          rawValue: String(rawCode),
        });
        continue;
      }
      const lectureHall = findTutorialRoomType(input.catalog, input.collegeId);
      if (!lectureHall) {
        errors.push({
          errorCode: "tutorial_lecture_hall_room_type_missing",
          courseCode: input.courseCode,
          componentType: component.component_type,
          fieldName: field,
          header,
          message: `المقرر ${input.courseCode}: ${TUTORIAL_ROOM_TYPE_ERROR_AR.TUTORIAL_LECTURE_HALL_ROOM_TYPE_MISSING}`,
          rawValue: rawCode == null ? undefined : String(rawCode),
        });
        continue;
      }
      resolvedIds[component.component_type] = lectureHall.id;
      continue;
    }

    if (!canonical || !rawCode || String(rawCode).trim() === "") {
      errors.push({
        errorCode: "missing_room_type_code",
        courseCode: input.courseCode,
        componentType: component.component_type,
        fieldName: field,
        header,
        message: `المقرر ${input.courseCode}: المكوّن ${component.component_type} يتطلب ${header} (ساعات أسبوعية=${component.weekly_contact_hours})`,
        rawValue: rawCode == null ? undefined : String(rawCode),
      });
      continue;
    }

    if (!catalog) {
      errors.push({
        errorCode: "unknown_room_type_code",
        courseCode: input.courseCode,
        componentType: component.component_type,
        fieldName: field,
        header,
        message: `المقرر ${input.courseCode}: المكوّن ${component.component_type} — ${header} غير معروف: ${rawCode}`,
        rawValue: String(rawCode),
      });
      continue;
    }

    if (catalog.college_id !== input.collegeId) {
      errors.push({
        errorCode: "cross_college_room_type",
        courseCode: input.courseCode,
        componentType: component.component_type,
        fieldName: field,
        header,
        message: `المقرر ${input.courseCode}: المكوّن ${component.component_type} — ${header} (${rawCode}) لا يتبع نفس الكلية`,
        rawValue: String(rawCode),
      });
      continue;
    }

    if (!catalog.is_active) {
      errors.push({
        errorCode: "inactive_room_type",
        courseCode: input.courseCode,
        componentType: component.component_type,
        fieldName: field,
        header,
        message: `المقرر ${input.courseCode}: المكوّن ${component.component_type} — نوع القاعة ${rawCode} غير نشط`,
        rawValue: String(rawCode),
      });
      continue;
    }

    if (!(catalog.default_capacity > 0)) {
      errors.push({
        errorCode: "zero_capacity_room_type",
        courseCode: input.courseCode,
        componentType: component.component_type,
        fieldName: field,
        header,
        message: `المقرر ${input.courseCode}: المكوّن ${component.component_type} — نوع القاعة ${rawCode} سعته الافتراضية ≤ 0`,
        rawValue: String(rawCode),
      });
      continue;
    }

    const refState = classifyRoomTypeReference(catalog.id, catalogById, input.collegeId);
    if (refState !== "OK") {
      errors.push({
        errorCode:
          refState === "INACTIVE"
            ? "inactive_room_type"
            : refState === "ZERO_CAPACITY"
              ? "zero_capacity_room_type"
              : "unknown_room_type_code",
        courseCode: input.courseCode,
        componentType: component.component_type,
        fieldName: field,
        header,
        message: `المقرر ${input.courseCode}: المكوّن ${component.component_type} — ${header} (${rawCode}) حالة=${refState}`,
        rawValue: String(rawCode),
      });
      continue;
    }

    resolvedIds[component.component_type] = catalog.id;
  }

  return { errors, resolvedIds };
}

export type PlanComponentSyncRow = {
  component_type: ComponentType;
  weekly_contact_hours: number;
  is_timetabled: boolean;
  counts_toward_regular_load: boolean;
  counts_toward_overtime: boolean;
  compensation_mode: "per_hour" | "per_group_flat" | "none";
  required_room_type_id: string | null;
};

/**
 * Build plan_course_components sync payload for import commit (TS contract for RPC).
 */
export function buildPlanComponentSyncPayload(input: {
  hours: ExplicitHoursInput;
  resolvedRoomTypeIds: Partial<Record<ComponentType, string>>;
}): PlanComponentSyncRow[] {
  return derivePlanCourseComponents(input.hours).map((c) => ({
    component_type: c.component_type,
    weekly_contact_hours: c.weekly_contact_hours,
    is_timetabled: c.is_timetabled,
    counts_toward_regular_load: c.counts_toward_regular_load,
    counts_toward_overtime: c.counts_toward_overtime,
    compensation_mode: c.compensation_mode,
    required_room_type_id: requiresRoomTypeForComponent(c)
      ? (input.resolvedRoomTypeIds[c.component_type] ?? null)
      : null,
  }));
}

export type CohortPlanComponentRow = {
  componentId: string;
  componentType: ComponentType;
  weeklyContactHours: number;
  isTimetabled: boolean;
  explicitGroupSize?: number | null;
  requiredRoomTypeId: string | null;
  courseCode: string;
  courseName: string;
  programName: string;
  levelName: string;
  semester: number;
  roomDefaultCapacity?: number | null;
  roomTypeActive?: boolean | null;
  roomTypeCollegeId?: string | null;
};

export type MissingRoomTypeComponent = {
  program: string;
  level: string;
  term: string;
  courseCode: string;
  courseName: string;
  componentType: ComponentType;
  referenceState: Exclude<RoomTypeReferenceState, "OK">;
  componentId: string;
};

export type MissingRoomTypeGateResult =
  | { ok: true }
  | {
      ok: false;
      code: "MISSING_ROOM_TYPE_COMPONENTS";
      components: MissingRoomTypeComponent[];
    };

/** Pre-generation gate: batch all missing/invalid room types for cohort plan components. */
export function collectMissingRoomTypeComponents(
  rows: CohortPlanComponentRow[],
  ctx: { collegeId: string; termLabel: string },
): MissingRoomTypeGateResult {
  const missing: MissingRoomTypeComponent[] = [];

  for (const row of rows) {
    if (row.componentType === "summer_training") continue;
    if (row.componentType === "project" && (row.weeklyContactHours ?? 0) <= 0) continue;
    if (!row.isTimetabled || (row.weeklyContactHours ?? 0) <= 0) continue;
    if (
      row.componentType === "tutorial" &&
      row.explicitGroupSize != null &&
      row.explicitGroupSize > 0
    ) {
      continue;
    }
    if (row.componentType === "project") continue;

    let referenceState: Exclude<RoomTypeReferenceState, "OK"> | null = null;

    if (!row.requiredRoomTypeId) {
      referenceState = "NULL";
    } else if (row.roomTypeCollegeId != null && row.roomTypeCollegeId !== ctx.collegeId) {
      referenceState = "ORPHAN";
    } else if (row.roomTypeActive === false) {
      referenceState = "INACTIVE";
    } else if (row.roomDefaultCapacity == null) {
      referenceState = "ORPHAN";
    } else if (row.roomDefaultCapacity <= 0) {
      referenceState = "ZERO_CAPACITY";
    }

    if (referenceState) {
      missing.push({
        program: row.programName,
        level: row.levelName,
        term: ctx.termLabel,
        courseCode: row.courseCode,
        courseName: row.courseName,
        componentType: row.componentType,
        referenceState,
        componentId: row.componentId,
      });
    }
  }

  if (missing.length === 0) return { ok: true };
  return { ok: false, code: "MISSING_ROOM_TYPE_COMPONENTS", components: missing };
}

export const PLAN_COMPONENT_ROOM_TYPE_MISSING_BLOCKER = "PLAN_COMPONENT_ROOM_TYPE_MISSING";

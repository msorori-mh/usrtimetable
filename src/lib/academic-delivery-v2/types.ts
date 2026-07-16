/** Phase 9.2 — Academic delivery model V2 shared types (pure logic). */

export const COMPONENT_TYPES = [
  "theory",
  "practical",
  "tutorial",
  "project",
  "summer_training",
] as const;

export type ComponentType = (typeof COMPONENT_TYPES)[number];

export const TIMETABLED_COMPONENT_TYPES = [
  "theory",
  "practical",
  "tutorial",
  "project",
] as const satisfies readonly ComponentType[];

export type TimetabledComponentType = (typeof TIMETABLED_COMPONENT_TYPES)[number];

export interface ComponentHoursInput {
  theory_hours?: number | null;
  practical_hours?: number | null;
  tutorial_hours?: number | null;
  project_hours?: number | null;
  summer_training_hours?: number | null;
}

export interface ParsedComponentHours {
  components: Array<{
    component_type: ComponentType;
    weekly_contact_hours: number;
    is_timetabled: boolean;
    counts_toward_regular_load: boolean;
    counts_toward_overtime: boolean;
    compensation_mode: "per_hour" | "per_group_flat" | "none";
  }>;
  warnings: string[];
}

export interface RoomTypeCapacityRef {
  id: string;
  default_capacity: number;
  strict_capacity: boolean;
}

export interface GroupCountInput {
  component_type: ComponentType;
  student_count: number;
  /** Required room type capacity reference; null if unset on component. */
  roomType: RoomTypeCapacityRef | null;
  /** Optional explicit group count override (e.g. project groups). */
  explicit_group_count?: number | null;
}

export interface GroupCountResult {
  ok: boolean;
  group_count: number;
  capacity_limit: number | null;
  error_code?: string;
  message_ar?: string;
  warning?: string;
}

export interface GeneratorSummary {
  cohorts_processed: number;
  offerings_created: number;
  offerings_updated: number;
  delivery_groups_created: number;
  delivery_groups_updated: number;
  unchanged: number;
  warnings: Array<{ code: string; message_ar: string; cohort_id?: string; detail?: string }>;
  validation_errors: Array<{
    code: string;
    message_ar: string;
    cohort_id?: string;
    detail?: string;
  }>;
}

export function emptyGeneratorSummary(): GeneratorSummary {
  return {
    cohorts_processed: 0,
    offerings_created: 0,
    offerings_updated: 0,
    delivery_groups_created: 0,
    delivery_groups_updated: 0,
    unchanged: 0,
    warnings: [],
    validation_errors: [],
  };
}

/** Legacy session_type mapping for Schedule Builder / teaching_assignments compat. */
export function componentTypeToSessionType(
  componentType: ComponentType,
): "lecture" | "lab" | "tutorial" | "seminar" | "workshop" | null {
  switch (componentType) {
    case "theory":
      return "lecture";
    case "practical":
      return "lab";
    case "tutorial":
      return "tutorial";
    case "project":
      return "seminar";
    case "summer_training":
      return null;
    default:
      return null;
  }
}

export function sessionTypeToComponentType(sessionType: string): ComponentType | null {
  switch (sessionType) {
    case "lecture":
      return "theory";
    case "lab":
      return "practical";
    case "tutorial":
      return "tutorial";
    case "seminar":
    case "workshop":
      return "project";
    default:
      return null;
  }
}

/** Elective display: مقرر اختياري (اسم المقرر الفعلي) */
export function formatElectiveCourseLabel(actualCourseName: string): string {
  const name = actualCourseName.trim();
  return name ? `مقرر اختياري (${name})` : "مقرر اختياري";
}

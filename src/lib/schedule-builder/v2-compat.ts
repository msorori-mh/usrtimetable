/**
 * Minimal Schedule Builder V2 compatibility helpers.
 * Does not change save/validate/move contracts — mapping/read-only only.
 */
import {
  componentTypeToSessionType,
  formatElectiveCourseLabel,
  sessionTypeToComponentType,
  type ComponentType,
} from "@/lib/academic-delivery-v2/types";

export { componentTypeToSessionType, formatElectiveCourseLabel, sessionTypeToComponentType };

/** Prefer V2 delivery_group_id when present; else fall back to legacy section_number. */
export function resolveCompatGroupLabel(input: {
  delivery_group_code?: string | null;
  section_number?: string | null;
}): string {
  if (input.delivery_group_code && String(input.delivery_group_code).trim()) {
    return String(input.delivery_group_code).trim();
  }
  if (input.section_number != null && String(input.section_number).trim() !== "") {
    return String(input.section_number).trim();
  }
  return "";
}

/** True when assignment/session should be excluded from regular teaching-load totals. */
export function isExcludedFromRegularLoad(input: {
  component_type?: ComponentType | string | null;
  counts_toward_regular_load?: boolean | null;
}): boolean {
  if (input.counts_toward_regular_load === false) return true;
  if (input.component_type === "project" || input.component_type === "summer_training") {
    return true;
  }
  return false;
}

/** Display name for elective-backed offerings. */
export function resolveOfferingDisplayName(input: {
  is_elective?: boolean;
  course_name?: string | null;
  notes?: string | null;
}): string {
  const name = (input.course_name ?? "").trim() || "مقرر";
  if (input.is_elective) return formatElectiveCourseLabel(name);
  // Compat: notes may carry "elective:" marker from generator
  if (input.notes?.startsWith("elective:")) {
    return formatElectiveCourseLabel(name);
  }
  return name;
}

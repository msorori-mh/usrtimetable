import { isInstructorAvailabilityEnforced } from "./instructor-availability-policy.ts";

export interface InstructorAvailabilityWindow {
  start_time: string;
  end_time: string;
  availability_type?: string | null;
  is_preference?: boolean | null;
}

export type InstructorSlotAvailabilityReason =
  | "enforcement_disabled"
  | "available"
  | "explicit_availability_required"
  | "outside_available_window"
  | "blocked_window";

export interface InstructorSlotAvailabilityResult {
  available: boolean;
  reason: InstructorSlotAvailabilityReason;
}

const minutes = (value: string): number => {
  const [hour = "0", minute = "0"] = String(value).split(":");
  return Number(hour) * 60 + Number(minute);
};

/**
 * Canonical interpretation of one instructor's HARD windows for one weekday.
 * Preference rows are deliberately ignored here and belong to quality scoring.
 */
export function evaluateInstructorSlotAvailability(input: {
  enforce: boolean | null | undefined;
  startTime: string;
  endTime: string;
  windows: readonly InstructorAvailabilityWindow[];
  requiresExplicitPositiveWindow?: boolean;
}): InstructorSlotAvailabilityResult {
  if (!isInstructorAvailabilityEnforced(input.enforce)) {
    return { available: true, reason: "enforcement_disabled" };
  }

  const start = minutes(input.startTime);
  const end = minutes(input.endTime);
  const hardWindows = input.windows.filter((window) => !window.is_preference);
  const positive = hardWindows.filter((window) => window.availability_type !== "unavailable");
  const blocked = hardWindows.some(
    (window) =>
      window.availability_type === "unavailable" &&
      start < minutes(window.end_time) &&
      end > minutes(window.start_time),
  );

  if (blocked) return { available: false, reason: "blocked_window" };
  if (input.requiresExplicitPositiveWindow && positive.length === 0) {
    return { available: false, reason: "explicit_availability_required" };
  }
  if (
    positive.length > 0 &&
    !positive.some(
      (window) => start >= minutes(window.start_time) && end <= minutes(window.end_time),
    )
  ) {
    return { available: false, reason: "outside_available_window" };
  }
  return { available: true, reason: "available" };
}

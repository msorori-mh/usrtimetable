import type { AvailabilityWindow, GridSession } from "@/components/timetable/timetable-grid";
import type {
  WorkspaceExternalBusySlot,
  WorkspaceInstructorAvailabilityWindow,
  WorkspaceInstructorPlanningContext,
} from "@/lib/schedule-builder/queries";
import { evaluateInstructorSlotAvailability } from "@/lib/scheduling/instructor-slot-availability";

export const BUILDER_DAY_LABEL_AR: Record<number, string> = {
  6: "السبت",
  0: "الأحد",
  1: "الإثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
  5: "الجمعة",
};

const hhmm = (value: string) => String(value).slice(0, 5);

const minutes = (value: string): number => {
  const [hour = "0", minute = "0"] = hhmm(value).split(":");
  return Number(hour) * 60 + Number(minute);
};

export interface InstructorAvailabilityOverlay {
  available: AvailabilityWindow[] | undefined;
  unavailable: AvailabilityWindow[];
  preferred: WorkspaceInstructorAvailabilityWindow[];
  hardWindowCount: number;
}

/** Convert policy rows to the exact visual semantics used by the grid. */
export function buildInstructorAvailabilityOverlay(input: {
  enforced: boolean;
  windows: readonly WorkspaceInstructorAvailabilityWindow[];
}): InstructorAvailabilityOverlay {
  const hard = input.windows.filter((window) => !window.is_preference);
  const positive = hard.filter((window) => window.availability_type !== "unavailable");
  const blocked = hard.filter((window) => window.availability_type === "unavailable");
  const toWindow = (window: WorkspaceInstructorAvailabilityWindow): AvailabilityWindow => ({
    day_of_week: window.day_of_week,
    start_time: hhmm(window.start_time),
    end_time: hhmm(window.end_time),
  });
  return {
    // When enforcement is off, policy rows are informational and must not make
    // the manual grid behave as if the server would reject the slot.
    available: input.enforced && positive.length ? positive.map(toWindow) : undefined,
    unavailable: input.enforced ? blocked.map(toWindow) : [],
    preferred: input.windows.filter((window) => !!window.is_preference),
    hardWindowCount: hard.length,
  };
}

export function buildExternalBusyGridSessions(
  slots: readonly WorkspaceExternalBusySlot[],
): GridSession[] {
  return slots.map((slot, index) => ({
    id: `external-busy:${slot.day_of_week}:${hhmm(slot.start_time)}:${hhmm(slot.end_time)}:${index}`,
    day_of_week: slot.day_of_week,
    start_time: slot.start_time,
    end_time: slot.end_time,
    study_system: "all",
    session_type: "external_busy",
    title: "مشغول في كلية أخرى",
    subtitle: "مرجع موحّد لمنع تعارض المحاضر",
    badge: "للقراءة فقط",
    readOnly: true,
  }));
}

export interface InstructorPlanningSummary {
  dailyLimit: number | null;
  targetAttendanceDays: number | null;
  maxAttendanceDays: number | null;
  pendingRequests: number;
  approvedRequests: number;
  preferenceWindows: number;
  hardWindows: number;
}

export function summarizeInstructorPlanningContext(
  context: WorkspaceInstructorPlanningContext | null | undefined,
  defaultDailyLimit: number | null | undefined,
): InstructorPlanningSummary {
  const policies = context?.policy_records ?? [];
  const positiveLimits = policies
    .map((policy) => policy.max_hours_per_day)
    .filter((value): value is number => typeof value === "number" && value > 0);
  const targetDays = policies
    .map((policy) => policy.target_attendance_days_per_week)
    .filter((value): value is number => typeof value === "number" && value > 0);
  const maxDays = policies
    .map((policy) => policy.max_attendance_days_per_week)
    .filter((value): value is number => typeof value === "number" && value > 0);
  const requests = context?.requests ?? [];
  const windows = context?.availability ?? [];
  return {
    // Multiple physical aliases represent one person. The strictest recorded
    // maximum is the safe preview; the server remains authoritative on save.
    dailyLimit: positiveLimits.length
      ? Math.min(...positiveLimits)
      : typeof defaultDailyLimit === "number"
        ? defaultDailyLimit
        : null,
    targetAttendanceDays: targetDays.length ? Math.min(...targetDays) : null,
    maxAttendanceDays: maxDays.length ? Math.min(...maxDays) : null,
    pendingRequests: requests.filter((request) => request.status === "submitted").length,
    approvedRequests: requests.filter((request) => request.status === "approved").length,
    preferenceWindows: windows.filter((window) => !!window.is_preference).length,
    hardWindows: windows.filter((window) => !window.is_preference).length,
  };
}

export function instructorSlotBlockReason(input: {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  availabilityEnforced: boolean;
  availability: readonly WorkspaceInstructorAvailabilityWindow[];
  externalBusy: readonly WorkspaceExternalBusySlot[];
}): string | null {
  if (
    input.externalBusy.some(
      (slot) =>
        slot.day_of_week === input.dayOfWeek &&
        minutes(slot.start_time) < minutes(input.endTime) &&
        minutes(input.startTime) < minutes(slot.end_time),
    )
  ) {
    return "المحاضر مرتبط بمحاضرة في كلية أخرى خلال هذا الوقت.";
  }

  const windows = input.availability.filter((window) => window.day_of_week === input.dayOfWeek);
  const availability = evaluateInstructorSlotAvailability({
    enforce: input.availabilityEnforced,
    startTime: input.startTime,
    endTime: input.endTime,
    windows,
  });
  if (!availability.available) {
    if (availability.reason === "blocked_window") {
      return "هذا الوقت محظور صراحة في إتاحة المحاضر.";
    }
    return "الموعد المقترح خارج نوافذ إتاحة المحاضر الملزمة.";
  }
  return null;
}

export function formatInstructorWindow(window: {
  day_of_week: number;
  start_time: string;
  end_time: string;
}): string {
  return `${BUILDER_DAY_LABEL_AR[window.day_of_week] ?? `يوم ${window.day_of_week}`} · ${hhmm(window.start_time)}–${hhmm(window.end_time)}`;
}

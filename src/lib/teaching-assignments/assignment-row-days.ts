import { DAY_NAMES_AR } from "@/lib/reports/formatters";
import type { ScheduleVersionOption } from "@/lib/reports/types";
import {
  instructorNameMatches,
  normalizeArabicName,
} from "@/lib/teaching-assignments/instructor-name-search";

/** Display order: Saturday first, then Sunday → Friday (Arabic academic week). */
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];

export const UNSCHEDULED_DAY_LABEL = "غير مسكن";

/** Picks the newest populated working version, then the newest populated published version. */
export function currentScheduleVersionId(
  published: readonly ScheduleVersionOption[],
  working: readonly ScheduleVersionOption[],
  populatedVersionIds: ReadonlySet<string>,
): string | null {
  return (
    working.find((version) => populatedVersionIds.has(version.id))?.id ??
    published.find((version) => populatedVersionIds.has(version.id))?.id ??
    null
  );
}

type AssignmentSessionRow = {
  schedule_version_id: string;
  delivery_group_id: string | null;
  day_of_week: number | null;
  teaching_assignment_id: string | null;
};

/** Excludes sessions detached from an active teaching assignment. */
export function sessionsForActiveAssignments(
  sessions: readonly AssignmentSessionRow[],
  activeAssignmentIds: ReadonlySet<string>,
): AssignmentSessionRow[] {
  return sessions.filter(
    (session) =>
      session.teaching_assignment_id != null &&
      activeAssignmentIds.has(session.teaching_assignment_id),
  );
}

/** Groups session day numbers per delivery group. */
export function deliveryGroupDayMap(
  sessions: readonly { delivery_group_id: string | null; day_of_week: number | null }[],
): Map<string, number[]> {
  const map = new Map<string, Set<number>>();
  for (const session of sessions) {
    if (!session.delivery_group_id || session.day_of_week == null) continue;
    const set = map.get(session.delivery_group_id) ?? new Set<number>();
    set.add(session.day_of_week);
    map.set(session.delivery_group_id, set);
  }
  return new Map(
    [...map].map(([groupId, days]) => [
      groupId,
      [...days].sort((a, b) => WEEK_ORDER.indexOf(a) - WEEK_ORDER.indexOf(b)),
    ]),
  );
}

/** Arabic day names for one assignment row, or «غير مسكن» when nothing is placed. */
export function assignmentRowDaysLabel(days: readonly number[] | undefined): string {
  const names = (days ?? [])
    .map((day) => DAY_NAMES_AR[day])
    .filter((name): name is string => !!name);
  return names.length ? names.join("، ") : UNSCHEDULED_DAY_LABEL;
}

export type InstructorAttendanceDaysSummary = {
  /** Sum of per-instructor unique attendance days (equals the day count for a single match). */
  totalDays: number;
  perInstructor: { name: string; days: number }[];
};

type AttendanceDaysRow = {
  delivery_group_id: string;
  instructors: ReadonlyArray<{ instructor_name: string | null; is_active?: boolean }>;
};

/**
 * عدد أيام الحضور الفعلية للمحاضر/المحاضرين المطابقين للبحث، من أيام الجلسات
 * المسكنة في النسخة الجدولية الحالية. اليوم يُحتسب مرة واحدة مهما تعدّدت
 * محاضرات المحاضر فيه، والمجموعات غير المسكنة لا تُحتسب.
 */
export function summarizeInstructorAttendanceDays(
  rows: readonly AttendanceDaysRow[],
  query: string,
  sessionDays: ReadonlyMap<string, readonly number[]> | undefined,
): InstructorAttendanceDaysSummary {
  const q = normalizeArabicName(query);
  if (!q) return { totalDays: 0, perInstructor: [] };

  const byInstructor = new Map<string, { name: string; days: Set<number> }>();
  for (const row of rows) {
    const days = sessionDays?.get(row.delivery_group_id) ?? [];
    if (days.length === 0) continue;
    for (const instructor of row.instructors) {
      if (instructor.is_active === false) continue;
      if (!instructorNameMatches(instructor.instructor_name, q)) continue;
      const displayName = String(instructor.instructor_name ?? "").trim();
      const key = normalizeArabicName(displayName);
      if (!key) continue;
      const entry = byInstructor.get(key) ?? { name: displayName, days: new Set<number>() };
      for (const day of days) entry.days.add(day);
      byInstructor.set(key, entry);
    }
  }

  const perInstructor = [...byInstructor.values()].map((entry) => ({
    name: entry.name,
    days: entry.days.size,
  }));
  return {
    totalDays: perInstructor.reduce((sum, entry) => sum + entry.days, 0),
    perInstructor,
  };
}

import { DAY_NAMES_AR } from "@/lib/reports/formatters";
import type { ScheduleVersionOption } from "@/lib/reports/types";

/** Display order: Saturday first, then Sunday → Friday (Arabic academic week). */
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];

export const UNSCHEDULED_DAY_LABEL = "غير مسكن";

/**
 * Picks the version the platform treats as current for reports:
 * the newest published version when one exists, otherwise the newest
 * working (draft/review/approved) version. Inputs are already ordered
 * newest-first by fetchScheduleVersions.
 */
export function currentScheduleVersionId(
  published: readonly ScheduleVersionOption[],
  working: readonly ScheduleVersionOption[],
): string | null {
  return published[0]?.id ?? working[0]?.id ?? null;
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

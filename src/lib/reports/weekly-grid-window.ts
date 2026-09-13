/**
 * Single source of truth for weekly-grid presentation in reports.
 *
 * - Day order follows the Arabic academic week (Saturday first, Friday off) so
 *   the RTL grid shows السبت at the far right of the day columns.
 * - The visible hour window comes from the college's `scheduling_settings`
 *   (`day_start_time` / `day_end_time`), never a hardcoded 07:00–15:00.
 *
 * Pure module: no queries, no scheduling logic, no session mutation.
 */

/** JS day numbers ordered as displayed RTL: Sat, Sun, Mon, Tue, Wed, Thu. */
export const RTL_WEEK_DAY_ORDER = [6, 0, 1, 2, 3, 4] as const;

export const WEEK_DAY_LABELS_AR: Record<number, string> = {
  6: "السبت",
  0: "الأحد",
  1: "الاثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
  5: "الجمعة",
};

/** Rank used for sorting: Saturday = 0 … Thursday = 5, Friday last. */
export function rtlDayRank(day: number): number {
  const idx = RTL_WEEK_DAY_ORDER.indexOf(day as (typeof RTL_WEEK_DAY_ORDER)[number]);
  return idx === -1 ? RTL_WEEK_DAY_ORDER.length : idx;
}

/**
 * Orders arbitrary day numbers into the displayed week order and drops
 * duplicates. Unknown/extra days (e.g. Friday when configured) keep a stable
 * position at the end so nothing disappears from a report.
 */
export function orderWeekDaysRtl(days: readonly number[]): number[] {
  return [...new Set(days.filter((d) => Number.isFinite(d)))].sort(
    (a, b) => rtlDayRank(a) - rtlDayRank(b) || a - b,
  );
}

export interface WeeklyGridSettings {
  working_days?: number[] | null;
  day_start_time?: string | null;
  day_end_time?: string | null;
}

export interface WeeklyGridWindow {
  workingDays: number[];
  /** First hour label shown in the grid. */
  startHour: number;
  /** Last hour boundary of the grid (no row is drawn beyond it). */
  endHour: number;
  source: "settings" | "fallback";
}

/** Default window used only when the college has no scheduling settings row. */
export const WEEKLY_GRID_FALLBACK = { startHour: 8, endHour: 14 } as const;

function hourOf(time: string | null | undefined, mode: "floor" | "ceil"): number | null {
  if (!time) return null;
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  const minutes = Number.isFinite(m) ? m : 0;
  if (mode === "floor") return h;
  return minutes > 0 ? h + 1 : h;
}

/** Derives the displayed week + hour window from the college's settings. */
export function weeklyGridWindow(settings?: WeeklyGridSettings | null): WeeklyGridWindow {
  const configuredDays = orderWeekDaysRtl(settings?.working_days ?? []);
  const workingDays = configuredDays.length ? configuredDays : [...RTL_WEEK_DAY_ORDER];
  const start = hourOf(settings?.day_start_time, "floor");
  const end = hourOf(settings?.day_end_time, "ceil");
  if (start == null || end == null || end <= start) {
    return { workingDays, ...WEEKLY_GRID_FALLBACK, source: "fallback" };
  }
  return { workingDays, startHour: start, endHour: end, source: "settings" };
}

/** Hour marks inside the window, inclusive of the start, exclusive of the end. */
export function weeklyGridHourSlots(window: {
  startHour: number;
  endHour: number;
}): { label: string; mins: number }[] {
  const slots: { label: string; mins: number }[] = [];
  for (let h = window.startHour; h < window.endHour; h++) {
    slots.push({ label: `${String(h).padStart(2, "0")}:00`, mins: h * 60 });
  }
  return slots;
}

/** Pure helpers for availability “all active working days” (no DB). */

export const DEFAULT_WORKING_DAYS = [6, 0, 1, 2, 3, 4] as const; // Sat–Thu; Friday (5) excluded

export const DAY_LABELS_AR = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
] as const;

/** Sentinel used only in UI select — never persisted. */
export const ALL_ACTIVE_DAYS_SENTINEL = "all_active_days";

export function resolveWorkingDays(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...DEFAULT_WORKING_DAYS];
  }
  const days = [
    ...new Set(raw.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)),
  ];
  return days.length > 0 ? days : [...DEFAULT_WORKING_DAYS];
}

export function timesOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
  return start1 < end2 && start2 < end1;
}

export function isValidTimeRange(start: string, end: string): boolean {
  return Boolean(start && end && end > start);
}

/**
 * LAUNCH-CLOSURE-02 — pure planner mirroring the authoritative SQL source
 * `supabase/migrations/20260720120000_source_only_availability_all_active_days.sql`.
 *
 * Authoritative semantics reproduced here, per target day:
 *   1. "unchanged" requires an EXACT row match. For rooms the exact match
 *      includes the validity window (start_date / end_date compared with SQL
 *      `IS NOT DISTINCT FROM`), so two disjoint date windows are NOT duplicates.
 *   2. "overlap" is evaluated on rows with non-null times only, and — like the
 *      SQL — ignores the date window, so an overlapping time on the same weekday
 *      rejects the whole request instead of reporting a false "unchanged".
 *   3. Every target day is validated BEFORE any row is emitted (all-or-nothing).
 *
 * Deliberate divergence, documented: rows that block the whole day (null time,
 * or a null weekday meaning "every day") are invisible to the SQL comparison.
 * Silently inserting a redundant window under such a closure would report a
 * success that changes nothing meaningful, so the planner fails closed with
 * `all_day_block` and the caller must surface it.
 */
export type ExistingUnavailabilityWindow = {
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

export type BulkUnavailabilityPlan =
  | { ok: true; daysToCreate: number[]; daysUnchanged: number[]; daysTargeted: number[] }
  | { ok: false; reason: "invalid_time" }
  | { ok: false; reason: "overlap"; conflictDay: number }
  | { ok: false; reason: "all_day_block"; conflictDay: number };

/** SQL `IS NOT DISTINCT FROM` for nullable date columns. */
export function sameNullableDate(a: string | null | undefined, b: string | null | undefined) {
  const norm = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);
  return norm(a) === norm(b);
}

export function planBulkUnavailability(input: {
  activeDays: number[];
  dayOfWeek: number | null;
  startTime: string;
  endTime: string;
  /** Room path only: part of the exact-match key, mirroring the SQL. */
  compareDates?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  existing: ExistingUnavailabilityWindow[];
}): BulkUnavailabilityPlan {
  if (!isValidTimeRange(input.startTime, input.endTime)) {
    return { ok: false, reason: "invalid_time" };
  }
  const hhmm = (t: string) => t.slice(0, 5);
  const start = hhmm(input.startTime);
  const end = hhmm(input.endTime);
  const daysTargeted =
    input.dayOfWeek === null
      ? resolveWorkingDays(input.activeDays)
      : [input.dayOfWeek].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);

  if (daysTargeted.length === 0) return { ok: false, reason: "invalid_time" };

  const daysToCreate: number[] = [];
  const daysUnchanged: number[] = [];

  // Pre-validate ALL days before any DML.
  for (const day of daysTargeted) {
    const rowsForDay = input.existing.filter((e) => e.day_of_week === day);
    // A null weekday row applies to every day; a null time means the whole day.
    const blocksWholeDay = input.existing.some(
      (e) =>
        (e.day_of_week === null || e.day_of_week === day) &&
        (e.start_time === null || e.end_time === null),
    );
    if (blocksWholeDay) return { ok: false, reason: "all_day_block", conflictDay: day };

    const timed = rowsForDay.filter((e) => e.start_time !== null && e.end_time !== null);

    const exact = timed.some(
      (e) =>
        hhmm(e.start_time as string) === start &&
        hhmm(e.end_time as string) === end &&
        (input.compareDates !== true ||
          (sameNullableDate(e.start_date, input.startDate) &&
            sameNullableDate(e.end_date, input.endDate))),
    );
    if (exact) {
      daysUnchanged.push(day);
      continue;
    }

    // Mirrors the SQL overlap probe: time-based, date window not considered.
    const conflict = timed.find((e) =>
      timesOverlap(hhmm(e.start_time as string), hhmm(e.end_time as string), start, end),
    );
    if (conflict) return { ok: false, reason: "overlap", conflictDay: day };
    daysToCreate.push(day);
  }

  return { ok: true, daysToCreate, daysUnchanged, daysTargeted };
}

export type BulkAvailabilityResult = {
  status: string;
  days_targeted?: number[];
  days_created?: number;
  days_unchanged?: number;
  college_id?: string;
  resource?: string;
};

export function formatBulkSuccessMessage(r: BulkAvailabilityResult): string {
  const created = Number(r.days_created ?? 0);
  const unchanged = Number(r.days_unchanged ?? 0);
  const targeted = Array.isArray(r.days_targeted) ? r.days_targeted.length : created + unchanged;
  if (created === 0 && unchanged > 0) {
    return `لا تغيير: الفترة موجودة مسبقًا في ${unchanged} يومًا من أصل ${targeted}.`;
  }
  if (unchanged > 0) {
    return `تم إنشاء ${created} يومًا · بدون تغيير ${unchanged} · المستهدف ${targeted}.`;
  }
  return `تم تطبيق الفترة على ${created} يومًا.`;
}

export function groupIdenticalWindows<
  T extends {
    day_of_week: number;
    start_time: string;
    end_time: string;
    availability_type?: string;
    is_preference?: boolean;
    notes?: string | null;
  },
>(rows: T[], activeDays: number[]): Array<{ label: string; days: number[]; sample: T }> {
  const byKey = new Map<string, { days: number[]; sample: T }>();
  for (const r of rows) {
    const key = [
      r.start_time.slice(0, 5),
      r.end_time.slice(0, 5),
      r.availability_type ?? "",
      String(r.is_preference ?? ""),
      r.notes ?? "",
    ].join("|");
    const g = byKey.get(key);
    if (g) g.days.push(r.day_of_week);
    else byKey.set(key, { days: [r.day_of_week], sample: r });
  }
  const activeSet = new Set(activeDays);
  return [...byKey.values()].map((g) => {
    const uniq = [...new Set(g.days)].sort((a, b) => a - b);
    const coversAll =
      activeDays.length > 0 &&
      activeDays.every((d) => uniq.includes(d)) &&
      uniq.every((d) => activeSet.has(d));
    return {
      label: coversAll
        ? "كل أيام الدوام"
        : uniq.map((d) => DAY_LABELS_AR[d] ?? String(d)).join(" · "),
      days: uniq,
      sample: g.sample,
    };
  });
}

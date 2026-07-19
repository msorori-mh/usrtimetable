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

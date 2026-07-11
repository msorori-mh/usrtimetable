/**
 * Pure weekly time-slot template generation + validation.
 * Writes map to existing time_slot_templates rows (no schema change).
 * session_type is NOT on time_slot_templates — lab/theory duration policy
 * is enforced at plan/assignment level; generator emits general 120/180 windows.
 */

export const DEFAULT_WORKING_DAYS = [6, 0, 1, 2, 3] as const; // Sat–Wed
export const ALL_WEEK_DAYS = [6, 0, 1, 2, 3, 4] as const; // Sat–Thu selectable
export const DEFAULT_DAY_START = "08:00";
export const DEFAULT_DAY_END = "14:00";
export const DEFAULT_GRID_MINUTES = 60;
export const ALLOWED_DURATIONS = [120, 180] as const;
/** Academic policy: labs are 120 minutes (not 180). Enforced when session_type is known. */
export const LAB_DURATION_MINUTES = 120;
export const THEORY_DURATIONS = [120, 180] as const;

export const DAY_LABELS_AR: Record<number, string> = {
  0: "الأحد",
  1: "الإثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
  5: "الجمعة",
  6: "السبت",
};

export type StudySystem = "regular" | "parallel" | "both";

export interface BreakWindow {
  start_time: string;
  end_time: string;
  days?: number[] | null;
  affects_scheduling?: boolean | null;
  is_active?: boolean | null;
}

export interface DayOverride {
  enabled: boolean;
  startTime: string;
  endTime: string;
  durations: number[];
  /** Extra blocked windows for this day only (HH:MM–HH:MM). */
  blockedWindows: { start: string; end: string }[];
}

export interface WeeklySetupInput {
  studySystem: StudySystem;
  days: number[];
  dayStart: string;
  dayEnd: string;
  gridMinutes: number;
  durations: number[];
  breaks?: BreakWindow[];
  dayOverrides?: Record<number, DayOverride>;
  /** When set, filter durations by academic policy (lab → 120 only). */
  sessionType?: "theory" | "lab" | null;
}

export interface GeneratedTemplate {
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  study_system: StudySystem;
}

export interface GenerationSummary {
  selectedDays: number;
  slots120PerDay: number;
  slots180PerDay: number;
  total: number;
  templates: GeneratedTemplate[];
  skippedBreakConflicts: number;
  errors: string[];
}

export interface ExistingTemplateKey {
  study_system: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  /** Optional influential metadata for conflict detection (not part of identity key). */
  is_active?: boolean | null;
}

export interface DiffResult {
  /** New templates — safe to insert. */
  toInsert: GeneratedTemplate[];
  /** Exact semantic-key matches already in DB (existingExact). */
  duplicates: GeneratedTemplate[];
  /**
   * Same semantic identity but incompatible influential metadata
   * (e.g. existing inactive vs generated active), or contradictory
   * generated rows that cannot be merged safely.
   * Time overlaps alone are NOT conflicts (120/180 windows intentionally overlap).
   */
  conflicts: Array<GeneratedTemplate & { reason: string }>;
  /** Duplicate keys inside the generated batch (kept once; extras listed here). */
  duplicatesInGeneratedBatch: GeneratedTemplate[];
}

export function timeToMinutes(t: string): number {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

export function minutesToTime(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function validateWeeklySetup(input: WeeklySetupInput): string[] {
  const errors: string[] = [];
  if (!input.days || input.days.length === 0) {
    errors.push("يجب اختيار يوم دراسي واحد على الأقل.");
  }
  if (!input.durations || input.durations.length === 0) {
    errors.push("يجب اختيار مدة جلسة واحدة على الأقل.");
  }
  if (!(input.gridMinutes > 0)) {
    errors.push("يجب أن تكون دقة الشبكة أكبر من صفر.");
  }
  const start = timeToMinutes(input.dayStart);
  const end = timeToMinutes(input.dayEnd);
  if (!(end > start)) {
    errors.push("يجب أن يكون وقت نهاية الدوام بعد وقت البداية.");
  }
  for (const d of input.durations) {
    if (input.gridMinutes > 0 && d % input.gridMinutes !== 0) {
      errors.push(`مدة الجلسة ${d} دقيقة ليست من مضاعفات دقة الشبكة (${input.gridMinutes}).`);
    }
    if (d > end - start) {
      errors.push(`مدة الجلسة ${d} دقيقة تتجاوز طول الدوام اليومي.`);
    }
  }
  if (input.sessionType === "lab") {
    for (const d of input.durations) {
      if (d !== LAB_DURATION_MINUTES) {
        errors.push(`مدة المعامل المعتمدة ${LAB_DURATION_MINUTES} دقيقة فقط (لا يُسمح بـ ${d}).`);
      }
    }
  }
  if (input.dayOverrides) {
    for (const [dayStr, ov] of Object.entries(input.dayOverrides)) {
      if (!ov.enabled) continue;
      const ds = timeToMinutes(ov.startTime);
      const de = timeToMinutes(ov.endTime);
      if (!(de > ds)) {
        errors.push(
          `اليوم ${DAY_LABELS_AR[Number(dayStr)] ?? dayStr}: يجب أن يكون وقت نهاية الدوام بعد وقت البداية.`,
        );
      }
    }
  }
  return errors;
}

function effectiveDurations(input: WeeklySetupInput, override?: DayOverride): number[] {
  let durs = override?.durations?.length ? override.durations : input.durations;
  if (input.sessionType === "lab") {
    durs = durs.filter((d) => d === LAB_DURATION_MINUTES);
  }
  return durs;
}

function breaksForDay(
  breaks: BreakWindow[] | undefined,
  day: number,
): { start: number; end: number }[] {
  if (!breaks?.length) return [];
  return breaks
    .filter((b) => b.affects_scheduling !== false && b.is_active !== false)
    .filter((b) => !b.days || b.days.length === 0 || b.days.includes(day))
    .map((b) => ({
      start: timeToMinutes(b.start_time.slice(0, 5)),
      end: timeToMinutes(b.end_time.slice(0, 5)),
    }));
}

export function generateSlotsForDay(opts: {
  day: number;
  startTime: string;
  endTime: string;
  gridMinutes: number;
  durations: number[];
  studySystem: StudySystem;
  breaks: { start: number; end: number }[];
  blockedWindows?: { start: string; end: string }[];
}): { templates: GeneratedTemplate[]; skippedBreakConflicts: number; errors: string[] } {
  const templates: GeneratedTemplate[] = [];
  const errors: string[] = [];
  let skippedBreakConflicts = 0;
  const dayStart = timeToMinutes(opts.startTime);
  const dayEnd = timeToMinutes(opts.endTime);
  if (!(dayEnd > dayStart)) {
    errors.push(`يجب أن يكون وقت نهاية الدوام بعد وقت البداية.`);
    return { templates, skippedBreakConflicts, errors };
  }
  if (!(opts.gridMinutes > 0)) {
    errors.push("يجب أن تكون دقة الشبكة أكبر من صفر.");
    return { templates, skippedBreakConflicts, errors };
  }

  const blocked = [
    ...opts.breaks,
    ...(opts.blockedWindows ?? []).map((w) => ({
      start: timeToMinutes(w.start.slice(0, 5)),
      end: timeToMinutes(w.end.slice(0, 5)),
    })),
  ];

  for (const duration of opts.durations) {
    if (duration % opts.gridMinutes !== 0) {
      errors.push(`مدة الجلسة ${duration} دقيقة ليست من مضاعفات دقة الشبكة (${opts.gridMinutes}).`);
      continue;
    }
    for (let start = dayStart; start + duration <= dayEnd; start += opts.gridMinutes) {
      const end = start + duration;
      const hitsBreak = blocked.some((b) => rangesOverlap(start, end, b.start, b.end));
      if (hitsBreak) {
        skippedBreakConflicts += 1;
        continue;
      }
      templates.push({
        day_of_week: opts.day,
        start_time: minutesToTime(start),
        end_time: minutesToTime(end),
        slot_duration_minutes: duration,
        study_system: opts.studySystem,
      });
    }
  }
  return { templates, skippedBreakConflicts, errors };
}

export function generateWeeklyTemplates(input: WeeklySetupInput): GenerationSummary {
  const errors = validateWeeklySetup(input);
  if (errors.length > 0) {
    return {
      selectedDays: 0,
      slots120PerDay: 0,
      slots180PerDay: 0,
      total: 0,
      templates: [],
      skippedBreakConflicts: 0,
      errors,
    };
  }

  const templates: GeneratedTemplate[] = [];
  let skippedBreakConflicts = 0;
  const activeDays = input.days.filter((d) => {
    const ov = input.dayOverrides?.[d];
    return !ov || ov.enabled;
  });

  for (const day of activeDays) {
    const ov = input.dayOverrides?.[day];
    const startTime = ov?.startTime ?? input.dayStart;
    const endTime = ov?.endTime ?? input.dayEnd;
    const durations = effectiveDurations(input, ov);
    if (durations.length === 0) continue;
    const result = generateSlotsForDay({
      day,
      startTime,
      endTime,
      gridMinutes: input.gridMinutes,
      durations,
      studySystem: input.studySystem,
      breaks: breaksForDay(input.breaks, day),
      blockedWindows: ov?.blockedWindows,
    });
    templates.push(...result.templates);
    skippedBreakConflicts += result.skippedBreakConflicts;
    errors.push(...result.errors);
  }

  // Per-day counts using default day window (for summary display)
  const sample = generateSlotsForDay({
    day: activeDays[0] ?? 6,
    startTime: input.dayStart,
    endTime: input.dayEnd,
    gridMinutes: input.gridMinutes,
    durations: effectiveDurations(input),
    studySystem: input.studySystem,
    breaks: [],
  });
  const slots120PerDay = sample.templates.filter((t) => t.slot_duration_minutes === 120).length;
  const slots180PerDay = sample.templates.filter((t) => t.slot_duration_minutes === 180).length;

  return {
    selectedDays: activeDays.length,
    slots120PerDay,
    slots180PerDay,
    total: templates.length,
    templates,
    skippedBreakConflicts,
    errors: [...new Set(errors)],
  };
}

export function templateKey(t: ExistingTemplateKey): string {
  return [
    t.study_system,
    t.day_of_week,
    t.start_time.slice(0, 5),
    t.end_time.slice(0, 5),
    t.slot_duration_minutes,
  ].join("|");
}

/**
 * Application-level idempotency classification.
 * Semantic identity: study_system | day_of_week | start | end | duration.
 * Overlapping windows with different end/duration are independent templates, not conflicts.
 * DB uniqueness is NOT enforced — callers must document concurrency residual risk.
 */
export function diffAgainstExisting(
  generated: GeneratedTemplate[],
  existing: ExistingTemplateKey[],
): DiffResult {
  const existingByKey = new Map<string, ExistingTemplateKey>();
  for (const e of existing) {
    existingByKey.set(templateKey(e), e);
  }

  const seenInBatch = new Map<string, GeneratedTemplate>();
  const toInsert: GeneratedTemplate[] = [];
  const duplicates: GeneratedTemplate[] = [];
  const conflicts: Array<GeneratedTemplate & { reason: string }> = [];
  const duplicatesInGeneratedBatch: GeneratedTemplate[] = [];

  for (const g of generated) {
    const key = templateKey(g);
    if (seenInBatch.has(key)) {
      duplicatesInGeneratedBatch.push(g);
      continue;
    }
    seenInBatch.set(key, g);

    const ex = existingByKey.get(key);
    if (!ex) {
      toInsert.push(g);
      continue;
    }

    // Exact identity match. Influential metadata mismatch → conflict (do not insert/replace).
    if (ex.is_active === false) {
      conflicts.push({
        ...g,
        reason: "يوجد قالب مطابق الهوية لكنه غير نشط — لا يُعاد إدراجه ولا يُستبدل تلقائيًا.",
      });
      continue;
    }

    duplicates.push(g);
  }

  return { toInsert, duplicates, conflicts, duplicatesInGeneratedBatch };
}

/** Expected default count: 5 days × (5×120 + 4×180) = 45 with no breaks. */
export function expectedDefaultCount(): number {
  return generateWeeklyTemplates({
    studySystem: "regular",
    days: [...DEFAULT_WORKING_DAYS],
    dayStart: DEFAULT_DAY_START,
    dayEnd: DEFAULT_DAY_END,
    gridMinutes: DEFAULT_GRID_MINUTES,
    durations: [...ALLOWED_DURATIONS],
  }).total;
}

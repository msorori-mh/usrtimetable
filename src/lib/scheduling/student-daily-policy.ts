/**
 * Single source of truth for the student (partition) daily-hours policy.
 *
 * Policy — identical in generation, fill_missing, certified attendance search,
 * compaction/preview and every local pre-check:
 *  - total minutes of one student partition on one day
 *      <= `scheduling_settings.max_daily_hours_per_section` (8h today);
 *  - theory-like load (theory / lecture / tutorial, and anything ambiguous)
 *      <= `scheduling_settings.max_daily_theory_hours_per_section` (6h);
 *  - practical / lab load
 *      <= `scheduling_settings.max_daily_practical_hours_per_section` (8h),
 *      always bounded by the total cap.
 *
 * So 6h theory + 2h practical is allowed, 8h practical is allowed, 8h theory is
 * not. Classification comes from the teaching assignment's
 * `plan_course_component.component_type`; when it is missing or unrecognised the
 * load counts as theory-like (fail-closed: ambiguity can never be used to exceed
 * the theory cap).
 *
 * The instructor daily cap is a separate policy and is not touched here.
 */
import { isPracticalComponent } from "./room-type-policy.ts";

export const STUDENT_DAILY_TOTAL_HOURS_DEFAULT = 8;
export const STUDENT_DAILY_THEORY_HOURS_DEFAULT = 6;
export const STUDENT_DAILY_PRACTICAL_HOURS_DEFAULT = 8;
export const INSTRUCTOR_DAILY_HOURS_DEFAULT = 8;
export const MAX_EXTENDED_DAYS_PER_PARTITION_DEFAULT = 2;

export type StudentDailyHoursSettings = {
  max_daily_hours_per_section?: number | null;
  max_daily_theory_hours_per_section?: number | null;
  max_daily_practical_hours_per_section?: number | null;
};

export type StudentDailyPolicy = {
  totalMinutes: number;
  theoryMinutes: number;
  practicalMinutes: number;
};

const positiveHours = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function studentDailyPolicy(
  settings: StudentDailyHoursSettings = {},
): StudentDailyPolicy {
  const totalMinutes =
    positiveHours(settings.max_daily_hours_per_section, STUDENT_DAILY_TOTAL_HOURS_DEFAULT) * 60;
  return {
    totalMinutes,
    theoryMinutes: Math.min(
      totalMinutes,
      positiveHours(
        settings.max_daily_theory_hours_per_section,
        STUDENT_DAILY_THEORY_HOURS_DEFAULT,
      ) * 60,
    ),
    practicalMinutes: Math.min(
      totalMinutes,
      positiveHours(
        settings.max_daily_practical_hours_per_section,
        STUDENT_DAILY_PRACTICAL_HOURS_DEFAULT,
      ) * 60,
    ),
  };
}

/** Total daily student minutes — the single upper bound used by capacity proofs. */
export function studentDailyTotalMinutes(settings: StudentDailyHoursSettings = {}): number {
  return studentDailyPolicy(settings).totalMinutes;
}

export type StudentLoadKind = "theory" | "practical";

/** Fail-closed classification: unknown component types count as theory-like. */
export function studentLoadKind(componentType?: string | null): StudentLoadKind {
  return isPracticalComponent(componentType) ? "practical" : "theory";
}

export type StudentDailyLoad = { total: number; theory: number; practical: number };

export const emptyStudentDailyLoad = (): StudentDailyLoad => ({
  total: 0,
  theory: 0,
  practical: 0,
});

export function addStudentDailyLoad(
  load: StudentDailyLoad,
  kind: StudentLoadKind,
  minutes: number,
): StudentDailyLoad {
  return {
    total: load.total + minutes,
    theory: load.theory + (kind === "theory" ? minutes : 0),
    practical: load.practical + (kind === "practical" ? minutes : 0),
  };
}

/**
 * True when the resulting daily load respects the policy. `prior` keeps the
 * existing behaviour of never enlarging a pre-existing violation while still
 * allowing incremental repair.
 */
export function withinStudentDailyLoad(
  next: StudentDailyLoad,
  policy: StudentDailyPolicy,
  prior: StudentDailyLoad = emptyStudentDailyLoad(),
): boolean {
  return (
    next.total <= Math.max(policy.totalMinutes, prior.total) &&
    next.theory <= Math.max(policy.theoryMinutes, prior.theory) &&
    next.practical <= Math.max(policy.practicalMinutes, prior.practical)
  );
}

/** Extended-day allowance per student partition; supports any integer >= 0. */
export function extendedDayLimit(settings: {
  max_extended_days_per_partition?: number | null;
}): number {
  const n = Number(settings.max_extended_days_per_partition);
  return Number.isInteger(n) && n >= 0 ? n : MAX_EXTENDED_DAYS_PER_PARTITION_DEFAULT;
}

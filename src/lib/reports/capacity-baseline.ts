import { hoursBetween } from "@/lib/reports/formatters";

/** Fallback when college scheduling_settings are missing (5 days × 8 h). */
export const FALLBACK_WEEKLY_CAPACITY_HOURS = 40;

export interface SchedulingSettingsCapacity {
  working_days: number[] | null;
  day_start_time: string | null;
  day_end_time: string | null;
}

export interface WeeklyCapacityResult {
  hours: number;
  source: "scheduling_settings" | "fallback";
  label: string;
}

/**
 * Derive weekly room capacity from scheduling_settings.
 * Formula: working_days.length × (day_end − day_start) in hours.
 */
export function weeklyCapacityFromSettings(
  settings: SchedulingSettingsCapacity | null | undefined,
): WeeklyCapacityResult {
  const days = settings?.working_days?.filter((d) => Number.isFinite(d)) ?? [];
  const start = settings?.day_start_time;
  const end = settings?.day_end_time;

  if (days.length > 0 && start && end) {
    const daily = hoursBetween(start, end);
    if (daily > 0) {
      const hours = Number((days.length * daily).toFixed(2));
      return {
        hours,
        source: "scheduling_settings",
        label: `${hours} س/أسبوع (${days.length} أيام × ${daily.toFixed(1)} س/يوم)`,
      };
    }
  }

  return {
    hours: FALLBACK_WEEKLY_CAPACITY_HOURS,
    source: "fallback",
    label: `${FALLBACK_WEEKLY_CAPACITY_HOURS} س/أسبوع (افتراضي — لا إعدادات جدولة)`,
  };
}

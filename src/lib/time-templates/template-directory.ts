import { ACADEMIC_STUDY_SYSTEM_LABELS } from "../study-systems";
import { ALL_WEEK_DAYS, type StudySystem } from "./weekly-generator";

export interface TimeTemplateRow {
  id: string;
  study_system: StudySystem;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  is_active: boolean;
}
export const TEMPLATE_SYSTEM_LABELS: Record<StudySystem, string> = {
  regular: `${ACADEMIC_STUDY_SYSTEM_LABELS.regular} فقط`,
  parallel: `${ACADEMIC_STUDY_SYSTEM_LABELS.parallel} فقط`,
  both: "مشترك للعام والموازي",
};
export type TemplateScope = "all" | StudySystem | "available_regular" | "available_parallel";
export interface TemplateFilters {
  scope: TemplateScope;
  duration: string;
  activity: "all" | "active" | "inactive";
}
export const EMPTY_TEMPLATE_FILTERS: TemplateFilters = {
  scope: "all",
  duration: "all",
  activity: "all",
};
export const TEMPLATE_PAGE_SIZE = 12;

/** Available views include active shared templates, exactly as the scheduler does. */
export function filterTimeTemplates<T extends TimeTemplateRow>(
  rows: readonly T[],
  filters: TemplateFilters,
): T[] {
  return rows
    .filter((row) => {
      const { scope } = filters;
      if (scope === "available_regular" || scope === "available_parallel") {
        const system = scope === "available_regular" ? "regular" : "parallel";
        if (!row.is_active || (row.study_system !== system && row.study_system !== "both"))
          return false;
      } else if (scope !== "all" && row.study_system !== scope) return false;
      if (filters.duration !== "all" && row.slot_duration_minutes !== Number(filters.duration))
        return false;
      if (filters.activity === "active" && !row.is_active) return false;
      if (filters.activity === "inactive" && row.is_active) return false;
      return true;
    })
    .sort((a, b) => {
      // Saturday first; retain Friday or unexpected stored days instead of hiding records.
      const dayRank = (day: number) => (day === 6 ? 0 : day + 1);
      return (
        dayRank(a.day_of_week) - dayRank(b.day_of_week) ||
        a.start_time.localeCompare(b.start_time) ||
        a.end_time.localeCompare(b.end_time) ||
        a.study_system.localeCompare(b.study_system) ||
        a.id.localeCompare(b.id)
      );
    });
}
export function templateDayCounts(rows: readonly TimeTemplateRow[]) {
  const counts = new Map<number, number>(ALL_WEEK_DAYS.map((day) => [day, 0]));
  for (const row of rows) counts.set(row.day_of_week, (counts.get(row.day_of_week) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => (a === 6 ? -1 : b === 6 ? 1 : a - b));
}
export function timeTemplatePage<T extends TimeTemplateRow>(
  rows: readonly T[],
  day: number | "all",
  requestedPage: number,
) {
  const matching = day === "all" ? rows : rows.filter((row) => row.day_of_week === day);
  const pageCount = Math.max(1, Math.ceil(matching.length / TEMPLATE_PAGE_SIZE));
  const page = Math.max(1, Math.min(pageCount, requestedPage));
  return {
    rows: matching.slice((page - 1) * TEMPLATE_PAGE_SIZE, page * TEMPLATE_PAGE_SIZE),
    total: matching.length,
    page,
    pageCount,
  };
}

/**
 * EFFECTIVE-QUOTA-01 — single source of truth for «النصاب الفعلي».
 *
 * `instructors.max_weekly_hours` is the BASE approved weekly load («النصاب الأساسي»)
 * and is never rewritten. `instructors.administrative_release_hours` is the
 * number of weekly hours released for an administrative assignment.
 *
 *   effective = max(0, base - release)
 */

const isRealNumber = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Internal code of the hourly-contract instructor category in production. */
export const HOURLY_CONTRACT_TYPE_CODE = "con";

export function isHourlyContractTypeCode(code: string | null | undefined): boolean {
  return (code ?? "").trim().toLowerCase() === HOURLY_CONTRACT_TYPE_CODE;
}

/**
 * Net weekly quota. Returns null only when the base quota itself is undefined —
 * a missing quota never becomes 0.
 */
export function effectiveInstructorWeeklyHours(
  base: number | null | undefined,
  release: number | null | undefined,
): number | null {
  if (!isRealNumber(base)) return null;
  const rel = isRealNumber(release) ? Math.max(0, release) : 0;
  return round2(Math.max(0, base - rel));
}

export const EFFECTIVE_QUOTA_FORMULA_AR = "النصاب الفعلي = النصاب الأساسي − ساعات الإعفاء الإداري";

export const EFFECTIVE_QUOTA_LABEL_AR = "النصاب الفعلي";
export const BASE_QUOTA_LABEL_AR = "النصاب الأساسي الأسبوعي";
export const ADMIN_RELEASE_LABEL_AR = "ساعات الإعفاء الإداري";

/**
 * EFFECTIVE-QUOTA-01 — single source of truth for «النصاب الفعلي».
 *
 * `instructors.max_weekly_hours` is the BASE approved weekly load («النصاب الأساسي»)
 * and is never rewritten. `instructors.administrative_release_hours` stores the
 * approved teaching quota after administrative exemption when it is greater than
 * zero. A zero value means there is no administrative reduction.
 *
 *   effective = adminQuota > 0 ? min(base, adminQuota) : base
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
  const adminQuota = isRealNumber(release) ? Math.max(0, release) : 0;
  const normalizedBase = Math.max(0, base);
  return round2(adminQuota > 0 ? Math.min(normalizedBase, adminQuota) : normalizedBase);
}

export const EFFECTIVE_QUOTA_FORMULA_AR =
  "عند وجود إعفاء إداري، تمثل قيمته النصاب التدريسي الفعلي بعد الإعفاء";

export const EFFECTIVE_QUOTA_LABEL_AR = "النصاب الفعلي";
export const BASE_QUOTA_LABEL_AR = "النصاب الأساسي الأسبوعي";
export const ADMIN_RELEASE_LABEL_AR = "ساعات الإعفاء الإداري";

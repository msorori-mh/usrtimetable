// STAFF-METADATA-01 — shared instructor metadata option maps.
//
// `instructors.employment_type` historically defaulted to "full_time", which
// asserted a full-time fact that was never verified. The shared "unknown"
// option lets imports and the UI record "not yet confirmed" truthfully.
// No schema change: "unknown" is stored in the existing text column.

export const UNKNOWN_EMPLOYMENT_TYPE = "unknown";

export interface EmploymentTypeOption {
  value: string;
  label: string;
}

/** Ordered options for the "حالة التفرغ/التعاقد" field. */
export const EMPLOYMENT_TYPE_OPTIONS: readonly EmploymentTypeOption[] = [
  { value: UNKNOWN_EMPLOYMENT_TYPE, label: "غير محدد (لم يُثبت بعد)" },
  { value: "full_time", label: "متفرّغ" },
  { value: "part_time", label: "غير متفرّغ" },
  { value: "visiting", label: "زائر" },
  { value: "contract", label: "متعاقد" },
];

/** Values accepted by the instructors import sheet. */
export const EMPLOYMENT_TYPE_IMPORT_VALUES: readonly string[] = EMPLOYMENT_TYPE_OPTIONS.map(
  (o) => o.value,
);

/**
 * Render an employment value. Missing, empty or unrecognised values render as
 * "غير محدد" — never as a full-time claim.
 */
export function employmentTypeLabelAr(value: string | null | undefined): string {
  const found = EMPLOYMENT_TYPE_OPTIONS.find((o) => o.value === value);
  return found ? found.label : "غير محدد (لم يُثبت بعد)";
}

/**
 * Default employment value when the source row/form leaves it blank.
 * Explicit values are always preserved by callers.
 */
export function normalizeEmploymentType(value: unknown): string {
  if (typeof value !== "string") return UNKNOWN_EMPLOYMENT_TYPE;
  const trimmed = value.trim();
  return trimmed === "" ? UNKNOWN_EMPLOYMENT_TYPE : trimmed;
}

/** Academic ranks — existing ranks preserved, plus مدرس and أستاذ دكتور. */
export const ACADEMIC_RANKS: readonly string[] = [
  "معيد",
  "مدرس",
  "محاضر",
  "أستاذ مساعد",
  "أستاذ مشارك",
  "أستاذ",
  "أستاذ دكتور",
];

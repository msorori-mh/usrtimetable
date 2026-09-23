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

/**
 * INSTRUCTOR-AVAILABILITY-01 — "الحالة": independent of employment_type and
 * is_active. Canonical values are enforced by a database CHECK constraint.
 */
export const INSTRUCTOR_AVAILABILITY_OPTIONS = [
  { value: "available", label: "متوفر" },
  { value: "unavailable", label: "غير متوفر" },
  { value: "sick_leave", label: "إجازة مرضية" },
  { value: "sabbatical", label: "تفرغ علمي" },
  { value: "external_scholarship", label: "إبتعاث خارجي" },
  { value: "internal_scholarship", label: "إبتعاث داخلي" },
] as const;

export type InstructorAvailabilityStatus = (typeof INSTRUCTOR_AVAILABILITY_OPTIONS)[number]["value"];

export const DEFAULT_AVAILABILITY_STATUS: InstructorAvailabilityStatus = "available";

export function isInstructorAvailabilityStatus(v: unknown): v is InstructorAvailabilityStatus {
  return INSTRUCTOR_AVAILABILITY_OPTIONS.some((o) => o.value === v);
}

export function availabilityStatusLabelAr(value: string | null | undefined): string {
  return INSTRUCTOR_AVAILABILITY_OPTIONS.find((o) => o.value === value)?.label ?? "غير معروفة";
}

/** Only "available" instructors may receive new assignments or new sessions. */
export function canReceiveNewWork(value: string | null | undefined): boolean {
  return value === "available";
}

/** Arabic rejection message naming the instructor's status. */
export function newWorkBlockedMessage(value: string | null | undefined): string {
  return `لا يمكن إسناد أو جدولة هذا المحاضر لأن حالته: ${availabilityStatusLabelAr(value)}`;
}

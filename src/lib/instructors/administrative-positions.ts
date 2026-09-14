/**
 * ADMIN-POSITION-01 — structured administrative position for one instructor.
 *
 * The legacy free-text `instructors.admin_tasks` column is retained untouched for
 * backward compatibility. The new form and the official import template use the
 * structured `instructors.administrative_position` codes defined here.
 */

export type AdministrativePosition =
  | "department_head"
  | "vice_dean_academic"
  | "vice_dean_student_affairs"
  | "dean";

export interface AdministrativePositionOption {
  value: AdministrativePosition;
  label: string;
}

export const ADMINISTRATIVE_POSITION_OPTIONS: readonly AdministrativePositionOption[] = [
  { value: "department_head", label: "رئيس قسم" },
  { value: "vice_dean_academic", label: "نائب العميد للشؤون الأكاديمية" },
  { value: "vice_dean_student_affairs", label: "نائب العميد لشؤون الطلاب" },
  { value: "dean", label: "عميد الكلية" },
];

export const ADMINISTRATIVE_POSITION_CODES: readonly string[] = ADMINISTRATIVE_POSITION_OPTIONS.map(
  (o) => o.value,
);

export const ADMINISTRATIVE_POSITION_LABEL_AR: Record<AdministrativePosition, string> =
  Object.fromEntries(ADMINISTRATIVE_POSITION_OPTIONS.map((o) => [o.value, o.label])) as Record<
    AdministrativePosition,
    string
  >;

export function administrativePositionLabelAr(value: string | null | undefined): string {
  const found = ADMINISTRATIVE_POSITION_OPTIONS.find((o) => o.value === value);
  return found ? found.label : "";
}

const normalizeArabic = (value: string) =>
  value
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[_\s]+/g, " ")
    .trim()
    .toLowerCase();

/** Accepts the four internal codes and their Arabic labels. Anything else → null. */
export function normalizeAdministrativePosition(value: unknown): AdministrativePosition | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const code = raw.toLowerCase();
  const byCode = ADMINISTRATIVE_POSITION_OPTIONS.find((o) => o.value === code);
  if (byCode) return byCode.value;
  const key = normalizeArabic(raw);
  const byLabel = ADMINISTRATIVE_POSITION_OPTIONS.find((o) => normalizeArabic(o.label) === key);
  return byLabel ? byLabel.value : null;
}

/** Only a department head is bound to a headed department. */
export function requiresAdministrativeDepartment(
  position: string | null | undefined,
): position is "department_head" {
  return position === "department_head";
}

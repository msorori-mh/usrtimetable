/**
 * Single source of number/date formatting for the whole platform.
 *
 * Decision (2026-10-15): Arabic text with LATIN digits everywhere (screens,
 * exports, print). Time zone is fixed to Yemen so a date never shifts with the
 * viewer's device settings. Do not call toLocale*String directly elsewhere.
 */
export const APP_LOCALE = "ar-u-nu-latn";
export const APP_TIME_ZONE = "Asia/Aden";

const numberFmt = new Intl.NumberFormat(APP_LOCALE);
const dateFmt = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const longDateFmt = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat(APP_LOCALE, {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") return null;
  // A bare ISO date ("2026-10-15") is a calendar date, not an instant: pin it to
  // noon UTC so the fixed time zone can never move it to the previous day.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00Z`);
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatNumber(value: number | null | undefined, options?: Intl.NumberFormatOptions): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return options ? new Intl.NumberFormat(APP_LOCALE, options).format(value) : numberFmt.format(value);
}

export function formatDecimal(value: number | null | undefined, digits = 2): string {
  return formatNumber(value, { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function formatDate(value: DateInput): string {
  const d = toDate(value);
  return d ? dateFmt.format(d) : "—";
}

export function formatLongDate(value: DateInput): string {
  const d = toDate(value);
  return d ? longDateFmt.format(d) : "—";
}

export function formatDateTime(value: DateInput): string {
  const d = toDate(value);
  return d ? dateTimeFmt.format(d) : "—";
}

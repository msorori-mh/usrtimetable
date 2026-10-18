/**
 * M-13: strict, pure cell parsers for Excel import. No Supabase / XLSX imports
 * so they can be unit-tested directly.
 */
import { normalizeDecimalDigits } from "./arabic-normalize";

const INVISIBLE = /[​-‏؜﻿‪-‮⁦-⁩]/g;
/** Plain decimal: optional sign, digits, optional fraction. No exponent / hex / Infinity. */
const DECIMAL_RE = /^[+-]?\d+(?:\.\d+)?$/;
/** Grouped thousands as Excel formats them with raw:false ("1,250" / "1,250.5"). */
const GROUPED_RE = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

/**
 * Parses a numeric cell. Accepts Arabic-Indic / Eastern Arabic digits, the
 * Arabic decimal separator (U+066B) and thousands separators (U+066C / ",").
 * Returns null for anything that is not a plain decimal (e.g. "1e3", "0x10",
 * "Infinity", "12abc").
 */
export function parseDecimalCell(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const s = normalizeDecimalDigits(String(raw ?? ""))
    .replace(INVISIBLE, "")
    .replace(/٫/g, ".")
    .replace(/٬/g, ",")
    .replace(/−/g, "-")
    .trim();
  if (DECIMAL_RE.test(s)) return Number(s);
  if (GROUPED_RE.test(s)) return Number(s.replace(/,/g, ""));
  return null;
}

/**
 * Parses a comma-separated list of weekdays (0..6). Arabic digits and the
 * Arabic comma (U+060C) are accepted. Any invalid token makes the whole cell
 * invalid (returns `{ ok: false }`) instead of being silently dropped.
 */
export function parseDaysCsv(
  raw: unknown,
): { ok: true; days: number[] } | { ok: false; invalid: string[] } {
  const tokens = normalizeDecimalDigits(String(raw ?? ""))
    .replace(INVISIBLE, "")
    .replace(/،/g, ",")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const days: number[] = [];
  const invalid: string[] = [];
  for (const token of tokens) {
    if (/^[0-6]$/.test(token)) {
      const d = Number(token);
      if (!days.includes(d)) days.push(d);
    } else invalid.push(token);
  }
  return invalid.length ? { ok: false, invalid } : { ok: true, days };
}

export const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** "8:00" / "08:00" / "08:00:30" -> minutes since midnight (seconds ignored); null if invalid. */
export function timeToMinutes(raw: unknown): number | null {
  const s = normalizeDecimalDigits(String(raw ?? "")).trim();
  if (!TIME_RE.test(s)) return null;
  const [h, m] = s.split(":");
  return Number(h) * 60 + Number(m);
}

/** True when both times are valid and end is strictly after start (numeric, not lexical). */
export function isEndAfterStart(start: unknown, end: unknown): boolean {
  const st = timeToMinutes(start);
  const et = timeToMinutes(end);
  return st !== null && et !== null && et > st;
}

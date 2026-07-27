/**
 * Arabic text normalization for import matching (instructors, courses, programs).
 * Collapses whitespace and maps common letter variants for stable comparison.
 */

const ALEF_VARIANTS = /[\u0622\u0623\u0625\u0671\u0627]/g;
const ALEF_MAKSURA_TO_YA = /\u0649/g;
const TAA_MARBUTA = /\u0629/g;
const HAMZA_VARIANTS = /[\u0624\u0626]/g;
const TATWEEL = /\u0640/g;
const DIACRITICS = /[\u064B-\u065F\u0670]/g;

/** Normalize Arabic (and mixed) text for equality checks. */
export function normalizeArabicText(raw: string | null | undefined): string {
  if (raw === null || raw === undefined) return "";
  let s = String(raw).trim();
  if (!s) return "";
  s = s.replace(TATWEEL, "");
  s = s.replace(DIACRITICS, "");
  s = s.replace(HAMZA_VARIANTS, "\u0621");
  s = s.replace(ALEF_VARIANTS, "\u0627");
  s = s.replace(TAA_MARBUTA, "\u0647");
  s = s.replace(ALEF_MAKSURA_TO_YA, "\u064A");
  s = s.replace(/\s+/g, " ");
  return s;
}

/**
 * Strip leading academic / professional honorifics used in source workbooks
 * (e.g. أ.م.د.، أ.د.، د.، م.، Dr.) so names match catalog rows stored without titles.
 */
export function stripAcademicHonorifics(raw: string | null | undefined): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  // Longest prefixes first. Allow optional dots/spaces (د.مقبول or د. مقبول).
  const prefixes: RegExp[] = [
    /^(?:أ|ا)\.?\s*م\.?\s*د\.?\s*/u,
    /^(?:أ|ا)\.?\s*د\.?\s*/u,
    /^د\.?\s*/u,
    /^م\.?\s+/u,
    /^(?:أ|ا)\.?\s+/u,
    /^dr\.?\s*/i,
    /^eng\.?\s*/i,
    /^prof\.?\s*/i,
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const re of prefixes) {
      const next = s.replace(re, "").trim();
      if (next !== s && next.length > 0) {
        s = next;
        changed = true;
        break;
      }
    }
  }
  return s;
}

/** Case-insensitive key for maps (Arabic + Latin). */
export function normalizedMatchKey(raw: string | null | undefined): string {
  return normalizeArabicText(raw).toLocaleLowerCase("en-US");
}

/** Instructor name key: honorifics stripped then Arabic-normalized. */
export function instructorMatchKey(raw: string | null | undefined): string {
  return normalizedMatchKey(stripAcademicHonorifics(raw));
}

/** True when cell looks like a course code (e.g. CS101, CY301). */
export function looksLikeCourseCode(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  return /^[A-Za-z]{2,5}\d{2,4}[A-Za-z]?(\([A-Za-z]\))?$/.test(s);
}

/** True when value looks like an employee number rather than a person name. */
export function looksLikeEmployeeNumber(raw: string | null | undefined): boolean {
  const s = String(raw ?? "").trim();
  if (!s) return false;
  if (/^\d{3,}$/.test(s)) return true;
  if (/^EMP\d+$/i.test(s)) return true;
  return /^[A-Z]{1,4}\d{3,}$/i.test(s);
}

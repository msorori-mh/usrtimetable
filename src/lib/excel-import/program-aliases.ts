/**
 * Arabic program labels → canonical academic_programs.code values.
 */
import { normalizeArabicText, normalizedMatchKey } from "./arabic-normalize";

export const ALL_DEPARTMENTS_LABEL = "جميع الأقسام";

/** Canonical program codes used after alias resolution. */
export const PROGRAM_ALIAS_TARGETS = ["CS", "CIS", "IT", "CYB"] as const;
export type ProgramAliasCode = (typeof PROGRAM_ALIAS_TARGETS)[number];

const ALIAS_ENTRIES: ReadonlyArray<{ code: ProgramAliasCode; labels: readonly string[] }> = [
  { code: "CS", labels: ["علوم حاسوب", "علوم الحاسب", "علوم الحاسوب", "حاسوب"] },
  { code: "CIS", labels: ["نظم", "نظم معلومات", "نظم المعلومات", "نظم معلوماتية"] },
  { code: "IT", labels: ["تكنولوجيا", "تقنية", "تقنية المعلومات"] },
  { code: "CYB", labels: ["امن سيبراني", "أمن سيبراني", "الأمن السيبراني", "سيبراني"] },
];

function labelToKey(label: string): string {
  return normalizedMatchKey(normalizeArabicText(label));
}

const LABEL_TO_CODE = new Map<string, ProgramAliasCode>(
  ALIAS_ENTRIES.flatMap((e) => e.labels.map((l) => [labelToKey(l), e.code] as const)),
);

/** Resolve a single program fragment (no +) to a code, or null if unknown. */
export function resolveProgramAliasFragment(raw: string): ProgramAliasCode | null {
  const key = labelToKey(raw);
  if (!key) return null;
  const direct = LABEL_TO_CODE.get(key);
  if (direct) return direct;
  for (const [labelKey, code] of LABEL_TO_CODE) {
    if (key.includes(labelKey) || labelKey.includes(key)) return code;
  }
  return null;
}

export type ProgramResolution =
  | { kind: "all_departments" }
  | { kind: "codes"; codes: ProgramAliasCode[] }
  | { kind: "unknown"; raw: string };

/** Split compound programs on + and resolve each fragment. */
export function resolveProgramField(raw: string | null | undefined): ProgramResolution {
  const text = normalizeArabicText(String(raw ?? ""));
  if (!text) return { kind: "unknown", raw: "" };
  const allKey = labelToKey(ALL_DEPARTMENTS_LABEL);
  if (normalizedMatchKey(text) === allKey || text.includes("جميع")) {
    return { kind: "all_departments" };
  }
  const parts = text
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { kind: "unknown", raw: text };
  const codes: ProgramAliasCode[] = [];
  for (const part of parts) {
    const code = resolveProgramAliasFragment(part);
    if (!code) return { kind: "unknown", raw: text };
    if (!codes.includes(code)) codes.push(code);
  }
  return { kind: "codes", codes };
}

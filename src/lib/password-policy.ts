/**
 * M-3: policy for NEW passwords (personal reset, initial change, accounts
 * created by the super admin). Existing passwords are NOT re-validated
 * (product decision: current users are not forced to change their password).
 *
 * Pure module (no imports): the browser, the server functions and unit tests
 * share one implementation.
 */

export const PASSWORD_MIN_LENGTH = 12;
/** bcrypt (Supabase Auth) silently ignores bytes beyond 72. */
export const PASSWORD_MAX_BYTES = 72;

export const PASSWORD_POLICY_AR =
  "١٢ حرفًا على الأقل (وبحد أقصى ٧٢ بايت)، دون تكرار حرف واحد أو نمط قصير، ودون تسلسلات بسيطة مثل 123456 أو abcdef أو qwerty، ولا تحتوي على اسمك أو بريدك، وليست من كلمات المرور الشائعة. لا يُشترط إدخال رموز خاصة.";

export type PasswordContext = {
  email?: string | null;
  name?: string | null;
};

export type PasswordIssue =
  | "too_short"
  | "too_long"
  | "single_character"
  | "repeated_pattern"
  | "simple_sequence"
  | "contains_email"
  | "contains_name"
  | "common_password";

export const PASSWORD_ISSUE_AR: Record<PasswordIssue, string> = {
  too_short: `أقل من ${PASSWORD_MIN_LENGTH} حرفًا`,
  too_long: `أطول من ${PASSWORD_MAX_BYTES} بايت (قلّل عدد الأحرف، خاصة العربية)`,
  single_character: "مكوّنة من حرف واحد مكرر",
  repeated_pattern: "تكرار لنمط قصير",
  simple_sequence: "تسلسل بسيط (مثل 123456 أو abcdef أو qwerty)",
  contains_email: "تحتوي على اسم المستخدم من البريد الإلكتروني",
  contains_name: "تحتوي على اسم صاحب الحساب",
  common_password: "من كلمات المرور الشائعة",
};

const SEQUENCES = [
  "abcdefghijklmnopqrstuvwxyz",
  "01234567890",
  "٠١٢٣٤٥٦٧٨٩٠",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik9ol0p",
  "ابتثجحخدذرزسشصضطظعغفقكلمنهوي",
  "ضصثقفغعهخحجد",
  "شسيبلاتنمكط",
  "ئءؤرلاىةوزظ",
];
const SEQUENCE_REFERENCES = SEQUENCES.flatMap((s) => [s, Array.from(s).reverse().join("")]);

/** Words that make a password common when only padded with digits, symbols or a trivial run. */
const COMMON_WORDS = [
  "password",
  "passwort",
  "qwerty",
  "letmein",
  "welcome",
  "iloveyou",
  "administrator",
  "admin",
  "monkey",
  "dragon",
  "football",
  "baseball",
  "sunshine",
  "princess",
  "master",
  "superman",
  "trustno",
  "changeme",
  "secret",
  "login",
  "default",
  "yemen",
  "sanaa",
  "university",
];

const LEET: Record<string, string> = {
  "@": "a",
  "4": "a",
  "0": "o",
  "1": "i",
  "!": "i",
  "3": "e",
  $: "s",
  "5": "s",
  "7": "t",
};

/** Number of characters NOT covered by a run (≥3) of a known keyboard/alphabet sequence. */
function charactersOutsideSequences(chars: readonly string[]): number {
  let uncovered = 0;
  let i = 0;
  while (i < chars.length) {
    let best = 1;
    for (const ref of SEQUENCE_REFERENCES) {
      for (let len = chars.length - i; len > best; len--) {
        if (ref.includes(chars.slice(i, i + len).join(""))) {
          best = len;
          break;
        }
      }
    }
    if (best >= 3) i += best;
    else {
      uncovered++;
      i++;
    }
  }
  return uncovered;
}

function isRepeatedPattern(chars: readonly string[]): boolean {
  for (let period = 2; period <= 4; period++) {
    if (chars.length < period * 3) break;
    if (chars.every((c, i) => c === chars[i % period])) return true;
  }
  return false;
}

function isCommon(lower: string): boolean {
  const variants = [
    lower,
    Array.from(lower)
      .map((c) => LEET[c] ?? c)
      .join(""),
  ];
  for (const candidate of variants) {
    for (const word of COMMON_WORDS) {
      const at = candidate.indexOf(word);
      if (at < 0) continue;
      const rest = Array.from(candidate.slice(0, at) + candidate.slice(at + word.length));
      const letters = rest.filter((c) => /\p{L}/u.test(c));
      if (letters.length < 4 || charactersOutsideSequences(rest) < 4) return true;
    }
  }
  return false;
}

const HONORIFICS = new Set([
  "دكتور",
  "الدكتور",
  "أستاذ",
  "الأستاذ",
  "مهندس",
  "المهندس",
  "mr",
  "mrs",
  "dr",
  "prof",
]);

function nameTokens(name: string | null | undefined): string[] {
  if (!name) return [];
  const lower = name.toLowerCase();
  const tokens = lower
    .replace(/[.\-_,،()]/g, " ")
    .split(/\s+/)
    .filter((t) => Array.from(t).length >= 3 && !HONORIFICS.has(t));
  const compact = lower.replace(/[\s.\-_,،()]/g, "");
  if (Array.from(compact).length >= 3) tokens.push(compact);
  return tokens;
}

function emailTokens(email: string | null | undefined): string[] {
  const local = email?.trim().toLowerCase().split("@")[0] ?? "";
  const tokens = new Set<string>();
  if (Array.from(local).length >= 3) tokens.add(local);
  for (const part of local.split(/[._+\-\d]+/)) if (Array.from(part).length >= 4) tokens.add(part);
  return [...tokens];
}

/** Every rule the candidate fails, in a stable order (empty = acceptable). */
export function passwordPolicyIssues(
  value: string,
  context: PasswordContext = {},
): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  const chars = Array.from(value);
  const lowerChars = Array.from(value.toLowerCase());
  const lower = lowerChars.join("");
  if (chars.length < PASSWORD_MIN_LENGTH) issues.push("too_short");
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) issues.push("too_long");
  if (chars.length === 0) return issues;
  if (new Set(lowerChars).size === 1) issues.push("single_character");
  else {
    if (isRepeatedPattern(lowerChars)) issues.push("repeated_pattern");
    if (charactersOutsideSequences(lowerChars) < 4) issues.push("simple_sequence");
  }
  if (emailTokens(context.email).some((t) => lower.includes(t))) issues.push("contains_email");
  if (nameTokens(context.name).some((t) => lower.includes(t))) issues.push("contains_name");
  if (isCommon(lower)) issues.push("common_password");
  return issues;
}

/** Arabic, user-facing: lists every unmet rule. */
export function describePasswordIssues(issues: readonly PasswordIssue[]): string {
  if (issues.length === 0) return "";
  return `كلمة المرور غير مقبولة: ${issues.map((i) => PASSWORD_ISSUE_AR[i]).join("، ")}.`;
}

export function validPersonalPassword(value: string, context: PasswordContext = {}): boolean {
  return passwordPolicyIssues(value, context).length === 0;
}

export function requiresInitialPassword(role: string): boolean {
  return role !== "super_admin";
}

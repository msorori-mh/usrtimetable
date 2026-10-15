/**
 * L-5: sign-in / recovery / MFA errors shown on /auth. Known Supabase Auth
 * messages map to fixed Arabic text; our own Arabic messages (e.g. session
 * checks) pass through; anything else becomes a generic Arabic message —
 * raw backend text is never displayed. Pure module.
 */
export const AUTH_GENERIC_ERROR_AR = "تعذّر إكمال العملية. تحقق من البيانات وأعد المحاولة.";

const KNOWN: Array<[RegExp, string]> = [
  [/invalid login|invalid credentials/i, "بيانات الدخول غير صحيحة أو الحساب غير مخوّل"],
  [/password should|weak password|pwned/i, "كلمة المرور لا تستوفي متطلبات الحساب."],
  [/email not confirmed/i, "لم يتم تأكيد البريد الإلكتروني لهذا الحساب."],
  [/user is banned|banned/i, "هذا الحساب معطّل. تواصل مع مدير النظام."],
  [
    /rate limit|too many requests|security purposes/i,
    "محاولات كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.",
  ],
  [/invalid (totp|code)|code.*(expired|invalid)|mfa/i, "رمز التحقق غير صحيح أو منتهي الصلاحية."],
  [/network|failed to fetch|fetch failed/i, "تعذّر الاتصال بالخادم. تحقق من الاتصال وأعد المحاولة."],
];

const ARABIC = /[؀-ۿ]/;

export function translateAuthError(msg: string): string {
  for (const [pattern, ar] of KNOWN) if (pattern.test(msg)) return ar;
  if (ARABIC.test(msg)) return msg;
  return AUTH_GENERIC_ERROR_AR;
}

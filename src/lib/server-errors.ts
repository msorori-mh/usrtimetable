/**
 * L-5: backend error messages (PostgREST, GoTrue, env names) never reach the
 * browser. The full error is logged server-side with a short reference id and
 * the client receives a fixed Arabic message carrying only that reference.
 * Pure module: no imports.
 */

type BackendError = { message?: unknown; code?: unknown; status?: unknown } | null | undefined;

/** Known backend signals mapped to fixed Arabic messages. */
const KNOWN_ERRORS: Array<{ match: (code: string, message: string) => boolean; ar: string }> = [
  {
    match: (_c, m) => m.includes("LAST_SUPER_ADMIN"),
    ar: "لا يمكن إزالة آخر مدير نظام (Super Admin) في المنصة.",
  },
  {
    match: (_c, m) => m.includes("DEAN_SINGLE_COLLEGE"),
    ar: "عميد الكلية يُسند إلى كلية واحدة فقط.",
  },
  {
    match: (_c, m) => m.includes("RATE_LIMITED_MEMBERSHIP_CHANGE"),
    ar: "تم تجاوز الحد المسموح لتغيير الأدوار مؤقتًا. أعد المحاولة بعد قليل.",
  },
  {
    match: (c) => c === "email_exists" || c === "user_already_exists",
    ar: "يوجد حساب مسجّل بهذا البريد الإلكتروني.",
  },
  {
    match: (_c, m) => /already (?:been )?registered|already exists/i.test(m),
    ar: "يوجد حساب مسجّل بهذا البريد الإلكتروني.",
  },
  {
    match: (c, m) => c === "weak_password" || /password should|pwned|weak/i.test(m),
    ar: "كلمة المرور لا تستوفي سياسة كلمات المرور.",
  },
  { match: (c) => c === "23505", ar: "السجل موجود مسبقًا." },
  { match: (c) => c === "23503", ar: "السجل المرتبط غير موجود أو حُذف." },
  { match: (c) => c === "42501", ar: "ليس لديك صلاحية لتنفيذ هذا الإجراء." },
];

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Fixed Arabic message for a known backend error, or null. */
export function knownBackendMessage(error: BackendError): string | null {
  if (!error || typeof error !== "object") return null;
  const code = stringOf(error.code);
  const message = stringOf(error.message);
  return KNOWN_ERRORS.find((k) => k.match(code, message))?.ar ?? null;
}

export function newErrorReference(): string {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Logs `error` server-side under a fresh reference and returns an Error whose
 * message is `fallbackAr` (or the mapped known message) plus that reference.
 */
export function serverFailure(fallbackAr: string, error?: unknown, context?: string): Error {
  const ref = newErrorReference();
  console.error(`[server-error ${ref}]${context ? ` ${context}` : ""}`, error);
  const known = knownBackendMessage(error as BackendError);
  return new Error(`${known ?? fallbackAr} (المرجع: ${ref})`);
}

/** PostgREST / Postgres signal that an RPC does not exist (deploy-order tolerance). */
export function isMissingFunctionError(error: BackendError): boolean {
  if (!error || typeof error !== "object") return false;
  const code = stringOf(error.code);
  const message = stringOf(error.message);
  return (
    code === "42883" ||
    code === "PGRST202" ||
    /function .* does not exist|could not find the function/i.test(message)
  );
}

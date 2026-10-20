/**
 * Turns any thrown value into a message that is safe to show a user.
 *
 * Server functions and RPCs in this platform raise Arabic messages on purpose;
 * those are shown as-is. Raw Postgres/PostgREST/network errors (English, with
 * table/constraint names) are mapped to fixed Arabic text and logged to the
 * console with a short reference so support can still find the detail.
 */
const ARABIC = /[؀-ۿ]/;

const CODE_MESSAGES: Record<string, string> = {
  "23505": "يوجد سجل مطابق مسبقًا؛ لم يُحفظ التكرار.",
  "23503": "لا يمكن تنفيذ العملية لأن السجل مرتبط ببيانات أخرى.",
  "23514": "القيمة المدخلة لا تستوفي قواعد التحقق.",
  "23P01": "يتعارض هذا السجل مع سجل آخر في الوقت نفسه.",
  "42501": "ليست لديك صلاحية لتنفيذ هذه العملية.",
  "40001": "تغيّرت البيانات أثناء الحفظ؛ حدّث الصفحة وأعد المحاولة.",
  "40P01": "تغيّرت البيانات أثناء الحفظ؛ حدّث الصفحة وأعد المحاولة.",
  PGRST301: "انتهت الجلسة؛ سجّل الدخول من جديد.",
  PGRST116: "السجل غير موجود أو لا تملك صلاحية الوصول إليه.",
};

function pick(source: unknown, key: string): string | null {
  if (source && typeof source === "object" && key in source) {
    const v = (source as Record<string, unknown>)[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  }
  return null;
}

export function userErrorMessage(
  error: unknown,
  fallback = "تعذّر تنفيذ العملية. أعد المحاولة.",
): string {
  const message =
    typeof error === "string"
      ? error.trim()
      : (pick(error, "message") ?? pick(error, "error_description"));
  if (message && ARABIC.test(message)) return message;

  const code = pick(error, "code");
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];

  if (message && /failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return "تعذّر الاتصال بالخادم؛ تحقق من الشبكة وأعد المحاولة.";
  }
  if (message && /jwt|token.*expired|not authenticated/i.test(message)) {
    return "انتهت الجلسة؛ سجّل الدخول من جديد.";
  }

  const ref = Math.random().toString(16).slice(2, 10);
  console.error(`[user-error ${ref}]`, error);
  return `${fallback} (مرجع ${ref})`;
}

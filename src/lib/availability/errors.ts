/**
 * LAUNCH-CLOSURE-01 — human-readable error normalization for availability writes.
 *
 * Root cause addressed: availability writes surfaced "[object Object]" because the
 * caller stringified a rejection value with `String(e)`. Rejections here can be a
 * `PostgrestError` (an `Error` subclass carrying extra `code`/`details`/`hint`
 * fields), a plain object thrown by other layers, or a bare string. Whichever it
 * is, this module keeps the diagnostic fields instead of collapsing them.
 *
 * LAUNCH-CLOSURE-02 correction: the `instanceof Error` branch previously dropped
 * `details` and `hint`, so a real `PostgrestError` lost exactly the fields the
 * report claimed were preserved. Both branches now read the same field set.
 *
 * Pure module: no DB access, no network, no React.
 */

export const MISSING_RPC_HINT_AR =
  "خدمة الحفظ الجماعي غير متوفرة على الخادم حالياً؛ تم استخدام مسار الحفظ المباشر المكافئ بنفس الصلاحيات.";

/**
 * PostgREST / Postgres codes that mean the function is genuinely NOT deployed.
 * PGRST203 is excluded on purpose: it means an ambiguous overload (function exists).
 */
const MISSING_RPC_CODES = new Set(["PGRST202", "42883"]);

export interface NormalizedWriteError {
  message: string;
  code: string | null;
  details: string | null;
  hint: string | null;
}

function pickString(source: Record<string, unknown>, key: string): string | null {
  const raw = source[key];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

/**
 * Turns anything a Supabase/PostgREST call can reject with into a structured,
 * printable shape. Never returns "[object Object]".
 */
export function normalizeWriteError(error: unknown): NormalizedWriteError {
  if (error instanceof Error) {
    // `PostgrestError`, `AuthError`, `FunctionsHttpError` and friends ARE Error
    // subclasses that also carry code/details/hint. Read them off the instance.
    const source = error as unknown as Record<string, unknown>;
    return {
      message: error.message || error.name || "خطأ غير معروف",
      code: pickString(source, "code") ?? pickString(source, "status"),
      details: pickString(source, "details"),
      hint: pickString(source, "hint"),
    };
  }

  if (error && typeof error === "object") {
    const source = error as Record<string, unknown>;
    const message =
      pickString(source, "message") ??
      pickString(source, "error_description") ??
      pickString(source, "error") ??
      pickString(source, "msg");
    const code = pickString(source, "code") ?? pickString(source, "status");
    const details = pickString(source, "details");
    const hint = pickString(source, "hint");
    if (message || code || details || hint) {
      return {
        message: message ?? details ?? hint ?? `تعذّر تنفيذ العملية (رمز ${code ?? "غير معروف"})`,
        code,
        details,
        hint,
      };
    }
    // Last resort: never leak "[object Object]".
    try {
      return {
        message: JSON.stringify(source).slice(0, 400),
        code: null,
        details: null,
        hint: null,
      };
    } catch {
      return {
        message: "تعذّر تنفيذ العملية لسبب غير معروف",
        code: null,
        details: null,
        hint: null,
      };
    }
  }

  if (typeof error === "string" && error.trim() !== "") {
    return { message: error.trim(), code: null, details: null, hint: null };
  }

  return { message: "تعذّر تنفيذ العملية لسبب غير معروف", code: null, details: null, hint: null };
}

/** Flat readable string, safe for a toast. Never "[object Object]". */
export function readableWriteError(error: unknown): string {
  const n = normalizeWriteError(error);
  const parts = [n.message];
  if (n.details && n.details !== n.message) parts.push(n.details);
  if (n.hint && n.hint !== n.message) parts.push(n.hint);
  return parts.join(" — ");
}

/**
 * LAUNCH-CLOSURE-02 correction: PGRST203 is "could not choose the best candidate
 * function" — an AMBIGUOUS OVERLOAD, i.e. the function DOES exist. Routing it to a
 * client-side write path would bypass a deployed server function, so it is treated
 * as a hard error that must be reported, never as "missing".
 */
export function isAmbiguousRpcError(error: unknown): boolean {
  const n = normalizeWriteError(error);
  if (n.code === "PGRST203") return true;
  const haystack = `${n.message} ${n.details ?? ""} ${n.hint ?? ""}`.toLowerCase();
  return haystack.includes("could not choose the best candidate function");
}

export const AMBIGUOUS_RPC_HINT_AR =
  "توجد أكثر من نسخة من دالة الحفظ على الخادم (تعارض في التعريف)؛ لم يُنفَّذ أي حفظ. يلزم تصحيح تعريف الدالة على الخادم.";

/**
 * True ONLY when the failure means "this stored function is not deployed on the
 * server". Deliberately narrow: an ambiguous overload, a permission error, a
 * constraint violation, or any unrelated "... does not exist" / "schema cache"
 * text must NOT be routed to the direct-write fallback.
 */
export function isMissingRpcError(error: unknown): boolean {
  if (isAmbiguousRpcError(error)) return false;
  const n = normalizeWriteError(error);
  if (n.code && MISSING_RPC_CODES.has(n.code)) return true;
  if (n.code && n.code !== "PGRST202" && n.code !== "42883") return false;
  const haystack = `${n.message} ${n.details ?? ""} ${n.hint ?? ""}`.toLowerCase();
  return (
    haystack.includes("could not find the function") ||
    /function\s+[^\s]*\S*\s*.*does not exist/.test(haystack)
  );
}

/**
 * LAUNCH-CLOSURE-03 — mapping of durable database integrity failures to Arabic.
 *
 * Once docs/migrations-proposed/20260910T0025_availability_temporal_integrity_and_bulk_rpc.sql
 * is applied, an overlapping window is refused BY THE DATABASE on every write path,
 * including two concurrent transactions that both passed their own validation. Postgres
 * reports that as:
 *   23P01 exclusion_violation  — the exclusion constraints, and the RPC's own pre-check
 *   23505 unique_violation     — kept for compatibility with the pre-existing RPC source,
 *                                which raised 23505 for the same condition
 * Neither code is a bug to retry; the user must change the time or the date window.
 */
const OVERLAP_CONFLICT_CODES = new Set(["23P01", "23505"]);

export const OVERLAP_CONFLICT_AR =
  "تعارض زمني: توجد فترة عدم إتاحة متقاطعة مع الفترة المطلوبة لنفس المورد؛ لم يُحفظ أي شيء. عدّل الوقت أو نطاق التاريخ ثم أعد المحاولة.";

export const INVALID_TIME_RANGE_AR =
  "نطاق وقت غير صالح: يجب تحديد وقت البداية والنهاية معاً، وأن يكون وقت النهاية بعد وقت البداية.";

export const INVALID_DATE_RANGE_AR =
  "نطاق تاريخ غير صالح: يجب ألا يكون تاريخ النهاية قبل تاريخ البداية.";

export const WRITE_DENIED_AR =
  "لا تملك صلاحية التعديل على هذه الكلّية؛ لم يُنفَّذ أي حفظ.";

/** True for a durable overlap refusal, whether raised by a constraint or by the RPC. */
export function isOverlapConflictError(error: unknown): boolean {
  const n = normalizeWriteError(error);
  if (n.code && OVERLAP_CONFLICT_CODES.has(n.code)) return true;
  const haystack = `${n.message} ${n.details ?? ""} ${n.hint ?? ""}`.toLowerCase();
  return (
    haystack.includes("exclusion constraint") ||
    haystack.includes("availability_overlap") ||
    haystack.includes("unavailability_overlap")
  );
}

/**
 * Arabic message for an availability write failure, with the raw server text kept in
 * parentheses so a report or a screenshot stays diagnosable. Never "[object Object]".
 */
export function availabilityWriteMessage(error: unknown): string {
  const raw = readableWriteError(error);
  if (isOverlapConflictError(error)) return `${OVERLAP_CONFLICT_AR} (${raw})`;

  const n = normalizeWriteError(error);
  const haystack = `${n.message} ${n.details ?? ""} ${n.hint ?? ""}`.toLowerCase();
  if (haystack.includes("invalid_time_range")) return `${INVALID_TIME_RANGE_AR} (${raw})`;
  if (haystack.includes("invalid_date_range")) return `${INVALID_DATE_RANGE_AR} (${raw})`;
  if (n.code === "42501" || haystack.includes("college access denied")) {
    return `${WRITE_DENIED_AR} (${raw})`;
  }
  return raw;
}

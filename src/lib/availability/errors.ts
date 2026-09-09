/**
 * LAUNCH-CLOSURE-01 — human-readable error normalization for availability writes.
 *
 * Root cause addressed: supabase-js rejects with a plain `PostgrestError` object
 * (NOT an `Error` instance). Code that did `e instanceof Error ? e.message : String(e)`
 * produced the literal string "[object Object]" in the toast, hiding the real cause.
 *
 * Pure module: no DB access, no network, no React.
 */

export const MISSING_RPC_HINT_AR =
  "خدمة الحفظ الجماعي غير متوفرة على الخادم حالياً؛ تم استخدام مسار الحفظ المباشر المكافئ بنفس الصلاحيات.";

/** PostgREST codes returned when an RPC (stored function) does not exist. */
const MISSING_RPC_CODES = new Set(["PGRST202", "PGRST203", "42883"]);

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
    const withCode = error as Error & { code?: unknown };
    return {
      message: error.message || error.name || "خطأ غير معروف",
      code: typeof withCode.code === "string" ? withCode.code : null,
      details: null,
      hint: null,
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
 * True when the failure means "this stored function is not deployed on the server".
 * Used to fall back to the equivalent RLS-gated direct write path.
 */
export function isMissingRpcError(error: unknown): boolean {
  const n = normalizeWriteError(error);
  if (n.code && MISSING_RPC_CODES.has(n.code)) return true;
  const haystack = `${n.message} ${n.details ?? ""} ${n.hint ?? ""}`.toLowerCase();
  return (
    haystack.includes("could not find the function") ||
    haystack.includes("does not exist") ||
    haystack.includes("schema cache")
  );
}

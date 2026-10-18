/**
 * Pure mapping of server-computed conflict payloads (validate_schedule_version, the session
 * write RPCs) into the client Conflict shape. No database access.
 */
import { conflictMessageAr, conflictMessageEn } from "@/lib/schedule-builder/conflict-code-messages";
import type { Conflict } from "./validator";

export interface ServerVersionValidation {
  versionId: string;
  sessionCount: number;
  /** Unapproved, non-waived hard conflicts — the publish gate count. */
  hardCount: number;
  approvedCount: number;
  waivedCount: number;
  totalHardCount: number;
  softCount: number;
  eligibilityRevision: number | null;
  conflicts: Conflict[];
  hardConflicts: Conflict[];
  approvedExceptions: Conflict[];
  warnings: Conflict[];
}

export type RawConflict = {
  code?: unknown;
  severity?: unknown;
  schedule_session_id?: unknown;
  related_session_id?: unknown;
  metadata?: unknown;
  approved_exception?: unknown;
  exception_id?: unknown;
  exception_reason?: unknown;
  waived?: unknown;
  message_ar?: unknown;
  message_en?: unknown;
};

const EXTRA_AR: Record<string, string> = {
  delivery_group_conflict: "تعارض طلاب المحاضرة مع محاضرة أو معمل آخر لإحدى الدفعات المشاركة.",
};
const EXTRA_EN: Record<string, string> = {
  delivery_group_conflict: "Overlapping student membership.",
};

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Map one server conflict object to the client Conflict shape (pure). */
export function mapServerConflict(raw: RawConflict): Conflict {
  const code = str(raw.code) ?? "unknown_conflict";
  const metadata =
    raw.metadata && typeof raw.metadata === "object"
      ? { ...(raw.metadata as Record<string, unknown>) }
      : {};
  if (raw.waived === true) metadata.waived = true;
  const ar = conflictMessageAr(code, metadata);
  const en = conflictMessageEn(code, metadata);
  return {
    code,
    severity: raw.severity === "soft" ? "soft" : "hard",
    message_ar: str(raw.message_ar) ?? (ar === code ? (EXTRA_AR[code] ?? code) : ar),
    message_en: str(raw.message_en) ?? (en === code ? (EXTRA_EN[code] ?? code) : en),
    schedule_session_id: str(raw.schedule_session_id),
    related_session_id: str(raw.related_session_id),
    metadata,
    approved_exception: raw.approved_exception === true,
    exception_id: str(raw.exception_id),
    exception_reason: str(raw.exception_reason),
  };
}

/** Map the validate_schedule_version payload (pure; unit-tested). */
export function mapServerValidation(raw: unknown): ServerVersionValidation {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? (v as RawConflict[]).map(mapServerConflict) : []);
  const conflicts = list(r.conflicts);
  return {
    versionId: str(r.version_id) ?? "",
    sessionCount: num(r.session_count),
    hardCount: num(r.hard_count),
    approvedCount: num(r.approved_count),
    waivedCount: num(r.waived_count),
    totalHardCount: num(r.total_hard_count),
    softCount: num(r.soft_count),
    eligibilityRevision: r.eligibility_revision == null ? null : num(r.eligibility_revision),
    conflicts,
    hardConflicts: r.hard_conflicts
      ? list(r.hard_conflicts)
      : conflicts.filter((c) => c.severity === "hard" && !c.approved_exception),
    approvedExceptions: r.approved_exceptions
      ? list(r.approved_exceptions)
      : conflicts.filter((c) => c.severity === "hard" && c.approved_exception),
    warnings: r.warnings ? list(r.warnings) : conflicts.filter((c) => c.severity === "soft"),
  };
}

/** Arabic text for the structured errors raised by the session write RPCs. */
export function sessionWriteErrorMessageAr(message: string | null | undefined): string {
  const raw = message ?? "";
  if (raw.includes("SCHEDULE_HARD_CONFLICTS")) return "توجد تعارضات إلزامية — لم يُحفظ التغيير.";
  if (raw.includes("STALE_SESSION"))
    return "تغيرت المحاضرة منذ تحميلها. أعد التحميل ثم حاول مجدداً.";
  if (raw.includes("VERSION_LOCKED") || raw.includes("schedule_sessions are locked"))
    return "هذه النسخة معتمدة أو منشورة ولا يمكن تعديلها. أنشئ مسودة جديدة منها لإجراء التغييرات.";
  if (raw.includes("SESSION_LOCKED")) return "المحاضرة مقفلة — يجب فك القفل أولاً.";
  if (raw.includes("FORBIDDEN")) return "ليس لديك صلاحية تعديل جدول هذه الكلية.";
  if (raw.includes("OFFERING_SCOPE_MISMATCH"))
    return "المقرر المختار لا ينتمي إلى فصل هذه النسخة أو كليتها.";
  if (raw.includes("ASSIGNMENT_INSTRUCTOR_MISMATCH"))
    return "المحاضر لا يطابق الإسناد التدريسي المختار.";
  if (raw.includes("ASSIGNMENT_SCOPE_MISMATCH"))
    return "الإسناد التدريسي غير نشط أو لا يطابق المقرر المختار.";
  if (raw.includes("INVALID_SESSION_TIME")) return "وقت المحاضرة غير صالح.";
  if (raw.includes("SESSION_REQUIRED_FIELDS")) return "المقرر والمحاضر واليوم والوقت حقول مطلوبة.";
  if (raw.includes("SESSION_NOT_FOUND")) return "لم تعد المحاضرة موجودة. أعد تحميل الجدول.";
  return raw || "تعذر حفظ المحاضرة.";
}

/** Parse the conflict list carried in the DETAIL of SCHEDULE_HARD_CONFLICTS (pure). */
export function parseHardConflictDetails(details: string | null | undefined): Conflict[] {
  if (!details) return [];
  try {
    const parsed = JSON.parse(details) as unknown;
    return Array.isArray(parsed) ? (parsed as RawConflict[]).map(mapServerConflict) : [];
  } catch {
    return [];
  }
}

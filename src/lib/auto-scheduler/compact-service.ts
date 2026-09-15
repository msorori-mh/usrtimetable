import { supabase } from "@/integrations/supabase/client";
import {
  better,
  feasible,
  fingerprint,
  inputFingerprint,
  measure,
  type Snapshot,
  type Proposal,
  type Metrics,
  type Session,
} from "./compact";

import { validateJointPlan } from "./joint-model";

type ErrorLike = { message: string };
interface Query extends PromiseLike<{ data: unknown[] | null; error: ErrorLike | null }> {
  select(columns: string): Query;
  eq(column: string, value: string): Query;
  order(column: string): Query;
  range(from: number, to: number): Query;
}
const db = supabase as unknown as { from(table: string): Query };
async function rows(table: string, collegeId: string, versionId?: string) {
  const result: unknown[] = [];
  for (let offset = 0; ; offset += 500) {
    let q = db.from(table).select("*").eq("college_id", collegeId).order("id");
    if (versionId) q = q.eq("schedule_version_id", versionId);
    const { data, error } = await q.range(offset, offset + 499);
    if (error) throw new Error(error.message);
    result.push(...(data || []));
    if ((data || []).length < 500) return result;
  }
}
async function draft(collegeId: string, versionId: string) {
  const { data, error } = await supabase
    .from("schedule_versions")
    .select("id,status,eligibility_revision,updated_at")
    .eq("college_id", collegeId)
    .eq("id", versionId)
    .single();
  if (error) throw error;
  if (data.status !== "draft") throw new Error("التحسين متاح لنسخة مسودة فقط.");
  if (!Number.isSafeInteger(data.eligibility_revision) || data.eligibility_revision < 0)
    throw new Error("تعذر التحقق من مراجعة الجدول.");
  return {
    revision: String(data.eligibility_revision),
    versionUpdatedAt: data.updated_at,
  };
}
export async function loadCompactSnapshot(collegeId: string, versionId: string): Promise<Snapshot> {
  const version = await draft(collegeId, versionId);
  const names = {
    sessions: "schedule_sessions",
    cohorts: "academic_cohorts",
    groups: "operational_delivery_groups",
    members: "operational_group_members",
    sharedLectures: "shared_lecture_links",
    partitions: "cohort_student_partitions",
    assignments: "teaching_assignments",
    components: "plan_course_components",
    rooms: "rooms",
    instructors: "instructors",
    types: "instructor_types",
    availability: "instructor_availability",
    roomAvailability: "room_availability",
    roomUnavailability: "room_unavailability",
    templates: "time_slot_templates",
    settings: "scheduling_settings",
  };
  const values = await Promise.all(
    Object.entries(names).map(
      async ([key, table]) =>
        [key, await rows(table, collegeId, key === "sessions" ? versionId : undefined)] as const,
    ),
  );
  const raw = Object.fromEntries(values);
  if (raw.settings.length !== 1) throw new Error("تعذر تحديد إعدادات الجدولة.");
  const latest = await draft(collegeId, versionId);
  if (version.revision !== latest.revision || version.versionUpdatedAt !== latest.versionUpdatedAt)
    throw new Error("تغير الجدول أو موارده أثناء القراءة؛ أعد المعاينة.");
  return {
    ...raw,
    ...version,
    settings: raw.settings[0],
    sessions: (raw.sessions as Session[]).filter((s) => !s.replaced_by_split),
  } as unknown as Snapshot;
}
export interface Applied {
  applied: number | null;
  total: number;
  before: Metrics;
  after: Metrics | null;
  stopped: string | null;
  status: "saved" | "rejected" | "unknown";
  operationId: string;
  pendingRequest?: Record<string, unknown>;
  rpcName?: "apply_schedule_compaction" | "apply_schedule_relayout";
}
interface BatchResult {
  ok: boolean;
  code: string;
  applied?: number;
  operation_id?: string;
}
// These RPCs are deployed before this client. Missing RPCs fail closed; no sequential fallback.
const atomicDb = supabase as unknown as {
  rpc(
    name:
      "apply_schedule_compaction" | "apply_schedule_relayout" | "get_schedule_compaction_result",
    args: Record<string, unknown>,
  ): Promise<{
    data: BatchResult | null;
    error: { code?: string; message: string } | null;
  }>;
};
const unknownMessage =
  "تعذر تأكيد نتيجة الحفظ بسبب الاتصال. قد تكون الخطة حُفظت كاملة؛ تحقق من النتيجة قبل إعادة المعاينة.";
const rejectionMessages: Record<string, string> = {
  STALE_SNAPSHOT: "تغير الجدول أو موارده؛ أعد المعاينة.",
  STALE_SESSION: "تغيرت إحدى المحاضرات؛ أعد المعاينة.",
  VERSION_BUSY: "يجري تعديل الجدول الآن؛ أعد المحاولة بعد انتهائه.",
  VERSION_LOCKED: "نسخة الجدول لم تعد مسودة قابلة للتعديل.",
  ROOM_CLOSED: "تتعارض الخطة مع إغلاق إحدى القاعات.",
  ROOM_CLOSURE_REQUIRES_TERM_DATES: "استكمل تاريخ بداية الفصل ونهايته للتحقق من إغلاقات القاعات.",
  ATTENDANCE_DAY_LIMIT: "تزيد الخطة عدد أيام حضور المستوى عن الحد المسموح.",
};
async function sendAtomic(result: Applied, retrying = false): Promise<Applied> {
  try {
    const { data, error } = await atomicDb.rpc(
      result.rpcName ?? "apply_schedule_compaction",
      result.pendingRequest!,
    );
    if (error?.code === "PGRST202" || error?.code === "42883")
      return {
        ...result,
        applied: 0,
        status: "rejected",
        stopped: "الحفظ الذري غير متاح بعد؛ يلزم استكمال تحديث المنصة.",
      };
    if (!error && data?.ok === false && data.applied === 0) {
      // The original request may still be executing when an explicit retry meets its lock.
      if (retrying && data.code === "VERSION_BUSY") return result;
      return {
        ...result,
        applied: 0,
        status: "rejected",
        stopped:
          "لم تُحفظ الخطة؛ أُلغيت جميع تنقلاتها. " +
          (rejectionMessages[data.code] || "راجع القيود وأعد المعاينة."),
      };
    }
    if (
      !error &&
      data?.ok &&
      data.operation_id === result.operationId &&
      data.applied === result.total
    )
      return {
        ...result,
        applied: data.applied,
        status: "saved",
        stopped: null,
      };
  } catch {
    // Transport failure cannot establish whether PostgreSQL committed.
  }
  return result;
}
async function readActual(collegeId: string, versionId: string, result: Applied): Promise<Applied> {
  try {
    return {
      ...result,
      after: measure(await loadCompactSnapshot(collegeId, versionId)),
    };
  } catch {
    return {
      ...result,
      after: null,
      stopped: result.stopped || "حُفظت الخطة كاملة، لكن تعذر تحديث عرض الجدول. أعد تحميل الصفحة.",
    };
  }
}
/** Read a protected server receipt. An absent receipt does not prove that an in-flight call failed. */
export async function verifyCompactApplication(
  collegeId: string,
  versionId: string,
  previous: Applied,
): Promise<Applied> {
  let result = previous;
  try {
    const { data, error } = await atomicDb.rpc("get_schedule_compaction_result", {
      p_college_id: collegeId,
      p_version_id: versionId,
      p_operation_id: previous.operationId,
    });
    if (
      !error &&
      data?.ok &&
      data.operation_id === previous.operationId &&
      data.applied === previous.total
    )
      result = {
        ...previous,
        applied: previous.total,
        status: "saved",
        stopped: null,
      };
  } catch {
    // Keep the outcome unknown; never infer rollback from a transport failure.
  }
  return readActual(collegeId, versionId, result);
}
/** Explicit recovery reuses the exact operation ID, original revision and payload. */
export async function retryCompactApplication(
  collegeId: string,
  versionId: string,
  previous: Applied,
): Promise<Applied> {
  if (previous.status !== "unknown" || !previous.pendingRequest)
    return verifyCompactApplication(collegeId, versionId, previous);
  if (
    previous.pendingRequest.p_college_id !== collegeId ||
    previous.pendingRequest.p_version_id !== versionId
  )
    throw new Error("تغيرت نسخة الجدول؛ افتح النسخة التي أُرسلت إليها الخطة.");
  const result = await sendAtomic(previous, true);
  return result.status === "unknown"
    ? verifyCompactApplication(collegeId, versionId, result)
    : readActual(collegeId, versionId, result);
}
/** One authorized database transaction applies the complete ordered plan or rolls it all back. */
export async function applyCompactProposal(
  collegeId: string,
  versionId: string,
  proposal: Proposal,
  options: {
    signal?: AbortSignal;
    onProgress?: (applied: number, total: number) => void;
  } = {},
): Promise<Applied> {
  const fresh = await loadCompactSnapshot(collegeId, versionId);
  if (
    fingerprint(fresh.sessions) !== proposal.fingerprint ||
    inputFingerprint(fresh) !== proposal.inputFingerprint
  )
    throw new Error("تغيرت البيانات منذ المعاينة؛ أعد حساب التحسين.");
  const before = measure(fresh);
  if (!fresh.revision || !fresh.versionUpdatedAt) throw new Error("تعذر التحقق من مراجعة الجدول.");
  if (!proposal.moves.length || proposal.moves.length > 512)
    throw new Error("حجم خطة التحسين غير صالح.");
  let simulated = fresh.sessions;
  if (proposal.applicationMode === "simultaneous") {
    if (new Set(proposal.moves.map((m) => m.id)).size !== proposal.moves.length)
      throw new Error("خطة تحتوي محاضرات مكررة.");
    const moves = new Map(proposal.moves.map((m) => [m.id, m]));
    if (proposal.moves.some((m) => !fresh.sessions.some((s) => s.id === m.id)))
      throw new Error("محاضرة خارج نطاق الخطة.");
    simulated = fresh.sessions.map((s) => ({ ...s, ...moves.get(s.id) }));
    const days = proposal.attendanceSearch?.days;
    if (!days || !validateJointPlan(fresh, simulated, days))
      throw new Error("تغيرت صلاحية خطة التوزيع؛ أعد المعاينة.");
  } else {
    for (const move of proposal.moves) {
      const old = simulated.find((x) => x.id === move.id);
      if (!old) throw new Error("معاينة غير صالحة.");
      const candidate = { ...old, ...move };
      if (!feasible(fresh, simulated, candidate, old))
        throw new Error("تغيرت صلاحية أحد التنقلات؛ أعد المعاينة.");
      simulated = simulated.map((x) => (x.id === move.id ? candidate : x));
    }
  }
  if (!better(measure(fresh, simulated), before)) throw new Error("الخطة لا تحسّن النتيجة.");
  if (options.signal?.aborted) throw new Error("أُلغي التطبيق قبل إرسال الخطة؛ لم يُحفظ تغيير.");
  const operationId = crypto.randomUUID();
  let result: Applied = {
    applied: null,
    total: proposal.moves.length,
    before,
    after: null,
    status: "unknown",
    stopped: unknownMessage,
    operationId,
    rpcName:
      proposal.applicationMode === "simultaneous"
        ? "apply_schedule_relayout"
        : "apply_schedule_compaction",
    pendingRequest: {
      p_college_id: collegeId,
      p_version_id: versionId,
      p_operation_id: operationId,
      p_expected_revision: fresh.revision,
      p_expected_version_updated_at: fresh.versionUpdatedAt,
      ...(proposal.applicationMode === "simultaneous"
        ? { p_day_cap: proposal.attendanceSearch!.days }
        : {}),
      p_moves: proposal.moves.map((move) => ({
        ...move,
        expected_updated_at: fresh.sessions.find((s) => s.id === move.id)!.updated_at,
      })),
    },
  };
  // After dispatch, cancelling the UI cannot cancel a database transaction.
  result = await sendAtomic(result);
  if (result.status === "saved") options.onProgress?.(result.total, result.total);
  return result.status === "unknown"
    ? verifyCompactApplication(collegeId, versionId, result)
    : readActual(collegeId, versionId, result);
}

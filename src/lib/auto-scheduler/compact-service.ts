import { applyVersionInstructorLimits } from "./version-instructor-limits";
import { qualityBetter, qualityPlanValid, qualityRepairNonWorsening } from "./quality-search";
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
import { assertValidSchedulingPolicy } from "../scheduling/policy";

type ErrorLike = { message: string };
interface Query extends PromiseLike<{
  data: unknown[] | null;
  error: ErrorLike | null;
}> {
  select(columns: string): Query;
  eq(column: string, value: string): Query;
  in(column: string, values: string[]): Query;
  order(column: string): Query;
  range(from: number, to: number): Query;
}
const db = supabase as unknown as { from(table: string): Query };
async function rows(table: string, collegeId: string, versionId?: string) {
  const result: unknown[] = [];
  const orderKey = table === "shared_lecture_links" ? "member_group_id" : "id";
  for (let offset = 0; ; offset += 500) {
    let q = db.from(table).select("*").eq("college_id", collegeId).order(orderKey);
    if (versionId) q = q.eq("schedule_version_id", versionId);
    const { data, error } = await q.range(offset, offset + 499);
    if (error) throw new Error(error.message);
    result.push(...(data || []));
    if ((data || []).length < 500) return result;
  }
}
async function draft(collegeId: string, versionId: string) {
  const { data: records, error } = await db
    .from("schedule_versions")
    .select("id,status,eligibility_revision,updated_at,instructor_attendance_overrides")
    .eq("college_id", collegeId)
    .eq("id", versionId)
    .range(0, 0);
  if (error) throw error;
  const data = records?.[0] as {
    status: string; eligibility_revision: number; updated_at: string;
    instructor_attendance_overrides?: Record<string, number>;
  } | undefined;
  if (!data) throw new Error("تعذر تحديد نسخة الجدول.");
  if (data.status !== "draft") throw new Error("التحسين متاح لنسخة مسودة فقط.");
  if (!Number.isSafeInteger(data.eligibility_revision) || data.eligibility_revision < 0)
    throw new Error("تعذر التحقق من مراجعة الجدول.");
  return {
    instructorOverrides: data.instructor_attendance_overrides ?? {},
    revision: String(data.eligibility_revision),
    versionUpdatedAt: data.updated_at,
  };
}
export async function loadCompactSnapshot(collegeId: string, versionId: string): Promise<Snapshot> {
  const version = await draft(collegeId, versionId);
  const external = await (
    supabase as unknown as {
      rpc(
        name: string,
        args: Record<string, string>,
      ): Promise<{
        data: Snapshot["externalBusy"];
        error: ErrorLike | null;
      }>;
    }
  ).rpc("get_schedule_external_busy", {
    p_college_id: collegeId,
    p_version_id: versionId,
  });
  if (external.error || !Array.isArray(external.data))
    throw new Error("تعذر فحص ارتباطات المحاضرين في الكليات الأخرى؛ أعد المحاولة.");
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
  // Include only external instructors referenced by this college's active assignments.
  // The ordinary table reader retains RLS; unrelated university instructors are never loaded.
  const assignedIds = new Set(
    (raw.assignments as Array<{ instructor_id: string; is_active: boolean }>)
      .filter((a) => a.is_active).map((a) => a.instructor_id),
  );
  const knownIds = new Set((raw.instructors as Array<{ id: string }>).map((i) => i.id));
  const missingIds = [...assignedIds].filter((id) => !knownIds.has(id));
  for (let offset = 0; offset < missingIds.length; offset += 200) {
    const batch = missingIds.slice(offset, offset + 200);
    const extra = await db.from("instructors").select("*").in("id", batch).order("id").range(0, 199);
    if (extra.error || extra.data?.length !== batch.length)
      throw new Error("تعذر تحميل المحاضرين المرتبطين بإسنادات الكلية.");
    raw.instructors.push(...extra.data);
    const windows = await db.from("instructor_availability").select("*")
      .in("instructor_id", batch).order("id").range(0, 999);
    if (windows.error) throw new Error(windows.error.message);
    const existingWindows = new Set((raw.availability as Array<{ id: string }>).map((w) => w.id));
    raw.availability.push(...(windows.data ?? []).filter(
      (w) => !existingWindows.has((w as { id: string }).id),
    ));
    const knownTypes = new Set((raw.types as Array<{ id: string }>).map((t) => t.id));
    const typeIds = [...new Set((extra.data as Array<{ instructor_type_id: string | null }>)
      .map((i) => i.instructor_type_id).filter((id): id is string => !!id && !knownTypes.has(id)))];
    if (typeIds.length) {
      const types = await db.from("instructor_types").select("*").in("id", typeIds).order("id").range(0, 199);
      if (types.error || types.data?.length !== typeIds.length)
        throw new Error("تعذر التحقق من أنواع المحاضرين المرتبطين بالكلية.");
      raw.types.push(...types.data);
    }
  }
  raw.instructors = applyVersionInstructorLimits(
    raw.instructors as Snapshot["instructors"], version.instructorOverrides,
  );
  if (raw.settings.length !== 1) throw new Error("تعذر تحديد إعدادات الجدولة.");
  assertValidSchedulingPolicy(raw.settings[0] as Record<string, unknown>);
  const latest = await draft(collegeId, versionId);
  if (version.revision !== latest.revision || version.versionUpdatedAt !== latest.versionUpdatedAt)
    throw new Error("تغير الجدول أو موارده أثناء القراءة؛ أعد المعاينة.");
  return {
    ...raw,
    ...version,
    externalBusy: external.data ?? [],
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
      | "apply_schedule_compaction"
      | "apply_schedule_relayout"
      | "get_schedule_compaction_result",
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
    if (error?.code === "23514" && error.message.includes("INSTRUCTOR_DAILY_SESSION_LIMIT"))
      return {
        ...result,
        applied: 0,
        status: "rejected",
        stopped:
          "لم تُحفظ الخطة: الحد الأقصى ثلاث محاضرات للمحاضر في اليوم، شاملًا العام والموازي. أعد توزيع الجلسات ثم أعد المعاينة.",
      };
    if (error?.code === "23514" && error.message.includes("CROSS_COLLEGE_INSTRUCTOR_CONFLICT"))
      return {
        ...result,
        applied: 0,
        status: "rejected",
        stopped: "لم تُحفظ الخطة: يتعارض وقت محاضر مع جدول كلية أخرى. أعد المعاينة.",
      };
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
  if (proposal.qualitySearch && proposal.applicationMode !== "simultaneous")
    throw new Error("خطة التحسين تتطلب حفظًا متزامنًا كاملاً.");
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
    const days = proposal.qualitySearch?.dayCap ?? proposal.attendanceSearch?.days;
    if (
      !days ||
      (proposal.qualitySearch
        ? !qualityPlanValid(fresh, simulated, days)
        : !validateJointPlan(fresh, simulated, days))
    )
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
  if (
    !(proposal.qualitySearch
      ? qualityBetter(measure(fresh, simulated), before) ||
        (!qualityPlanValid(fresh, fresh.sessions, proposal.qualitySearch.dayCap) &&
          qualityRepairNonWorsening(measure(fresh, simulated), before))
      : better(measure(fresh, simulated), before))
  )
    throw new Error("الخطة لا تحسّن النتيجة.");
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
        ? {
            p_day_cap: proposal.qualitySearch?.dayCap ?? proposal.attendanceSearch!.days,
          }
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

export interface CompactRestorePoint {
  before: Snapshot;
  saved: Snapshot;
}
/** Only the exact post-application snapshot may be restored; intervening edits invalidate it. */
export async function restoreCompactApplication(
  collegeId: string,
  versionId: string,
  point: CompactRestorePoint,
): Promise<Applied> {
  const fresh = await loadCompactSnapshot(collegeId, versionId);
  if (
    fingerprint(fresh.sessions) !== fingerprint(point.saved.sessions) ||
    inputFingerprint(fresh) !== inputFingerprint(point.saved)
  )
    throw new Error("تغير الجدول أو موارده بعد التحسين؛ تعذر التراجع الآمن.");
  const original = new Map(point.before.sessions.map((s) => [s.id, s]));
  if (original.size !== fresh.sessions.length || fresh.sessions.some((s) => !original.has(s.id)))
    throw new Error("تغيرت محاضرات الجدول؛ تعذر التراجع الآمن.");
  const restored = fresh.sessions.map((s) => {
    const old = original.get(s.id)!;
    return {
      ...s,
      day_of_week: old.day_of_week,
      start_time: old.start_time,
      end_time: old.end_time,
      room_id: old.room_id,
    };
  });
  const cap = Math.max(
    3,
    Math.min(5, Math.max(0, ...Object.values(measure(point.before).levelDays))),
  ) as 3 | 4 | 5;
  if (!validateJointPlan(fresh, restored, cap))
    throw new Error("الجدول السابق لم يعد يحقق القيود الحالية؛ تعذر التراجع.");
  const moves = restored
    .filter((s) => {
      const old = fresh.sessions.find((x) => x.id === s.id)!;
      return (
        s.day_of_week !== old.day_of_week ||
        s.start_time !== old.start_time ||
        s.end_time !== old.end_time ||
        s.room_id !== old.room_id
      );
    })
    .map(({ id, day_of_week, start_time, end_time, room_id, updated_at }) => ({
      id,
      day_of_week,
      start_time,
      end_time,
      room_id,
      expected_updated_at: updated_at,
    }));
  if (!moves.length || moves.length > 512) throw new Error("لا توجد خطة تراجع صالحة.");
  const operationId = crypto.randomUUID();
  const pending: Applied = {
    applied: null,
    total: moves.length,
    before: measure(fresh),
    after: null,
    status: "unknown",
    stopped: unknownMessage,
    operationId,
    rpcName: "apply_schedule_relayout",
    pendingRequest: {
      p_college_id: collegeId,
      p_version_id: versionId,
      p_operation_id: operationId,
      p_expected_revision: fresh.revision,
      p_expected_version_updated_at: fresh.versionUpdatedAt,
      p_day_cap: cap,
      p_moves: moves,
    },
  };
  const result = await sendAtomic(pending);
  return result.status === "unknown"
    ? verifyCompactApplication(collegeId, versionId, result)
    : readActual(collegeId, versionId, result);
}

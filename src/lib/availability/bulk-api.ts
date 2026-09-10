import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import type { BulkAvailabilityResult, BulkUnavailabilityPlan } from "./active-days";
import { resolveWorkingDays, DEFAULT_WORKING_DAYS, planBulkUnavailability } from "./active-days";
import {
  AMBIGUOUS_RPC_HINT_AR,
  availabilityWriteMessage,
  isAmbiguousRpcError,
  isMissingRpcError,
  readableWriteError,
} from "./errors";
import { DAY_LABELS_AR } from "./active-days";

/** Active working days from operational calendar (أيام وفترات الدوام / scheduling_settings). */
export async function fetchCollegeWorkingDays(collegeId: string): Promise<number[]> {
  const { data, error } = await supabase
    .from("scheduling_settings")
    .select("working_days")
    .eq("college_id", collegeId)
    .maybeSingle();
  if (error) throw new Error(readableWriteError(error));
  return resolveWorkingDays(data?.working_days ?? DEFAULT_WORKING_DAYS);
}

function asResult(data: unknown): BulkAvailabilityResult {
  const r = (data ?? {}) as BulkAvailabilityResult;
  if (r.status !== "ok") {
    throw new Error("تعذّر تنفيذ عملية الحفظ الجماعي: لم يُعد الخادم نتيجة ناجحة.");
  }
  return r;
}

/**
 * LAUNCH-CLOSURE-01/02
 * The bulk RPCs live in a SOURCE-ONLY migration that is NOT applied on the live
 * database, so every save failed with a PostgREST "function not found" error and
 * nothing was persisted.
 *
 * Behaviour: prefer the RPC (atomic, server-side). Fall back to a direct write
 * ONLY when the function is genuinely absent (never on an ambiguous overload,
 * permission error, or constraint violation). The fallback reproduces the
 * authoritative SQL semantics documented in `active-days.ts`:
 *   - target days resolved from the same operational calendar,
 *   - the resource is confirmed to belong to the supplied college and be active,
 *   - EVERY target day validated before any DML (overlap ⇒ reject all),
 *   - the room validity window (start_date/end_date) is part of the duplicate key,
 *   - all rows inserted in a single statement,
 *   - same authorization: RLS `can_manage_college(auth.uid(), college_id)`.
 *
 * Known limitation (see docs/LAUNCH-CLOSURE-02.md): a client-side transaction
 * boundary does not exist, so two concurrent saves can both pass validation. The
 * database has no unique/exclusion constraint on these tables today, so overlap
 * uniqueness is NOT enforced at rest by either path.
 */
function dayLabel(day: number): string {
  return DAY_LABELS_AR[day] ?? String(day);
}

function planFailure(plan: Extract<BulkUnavailabilityPlan, { ok: false }>): Error {
  if (plan.reason === "overlap") {
    return new Error(
      `unavailability_overlap: يوجد تعارض زمني في يوم ${dayLabel(plan.conflictDay)}؛ لم يُحفظ أي يوم.`,
    );
  }
  if (plan.reason === "all_day_block") {
    return new Error(
      `unavailability_all_day_block: يوم ${dayLabel(plan.conflictDay)} مُغلق كاملاً مسبقاً؛ لم يُحفظ أي يوم.`,
    );
  }
  return new Error("invalid_time_range: وقت النهاية يجب أن يكون بعد وقت البداية.");
}

async function resolveTargetDays(collegeId: string, dayOfWeek: number | null): Promise<number[]> {
  if (dayOfWeek !== null) return [dayOfWeek];
  return fetchCollegeWorkingDays(collegeId);
}

/**
 * Mirrors the RPC preflight: the resource must exist, belong to the SUPPLIED
 * college, and be active. Fails closed — no write is attempted otherwise.
 */
async function assertResourceInCollege(
  table: "instructors" | "rooms",
  id: string,
  collegeId: string,
  label: string,
): Promise<void> {
  const { data, error } = await supabase
    .from(table)
    .select("id, college_id, is_active")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(readableWriteError(error));
  if (!data) throw new Error(`${label} غير موجود.`);
  if (data.college_id !== collegeId) {
    throw new Error(`${label} لا ينتمي إلى الكلّية المحددة؛ لم يُنفَّذ أي حفظ.`);
  }
  if (data.is_active !== true) {
    throw new Error(`${label} غير مُفعّل؛ لم يُنفَّذ أي حفظ.`);
  }
}

function planToResult(
  plan: Extract<BulkUnavailabilityPlan, { ok: true }>,
  collegeId: string,
  resource: string,
): BulkAvailabilityResult {
  return {
    status: "ok",
    days_targeted: plan.daysTargeted,
    days_created: plan.daysToCreate.length,
    days_unchanged: plan.daysUnchanged.length,
    college_id: collegeId,
    resource,
  };
}

async function instructorUnavailabilityFallback(input: {
  collegeId: string;
  instructorId: string;
  startTime: string;
  endTime: string;
  notes?: string | null;
  dayOfWeek: number | null;
}): Promise<BulkAvailabilityResult> {
  await assertResourceInCollege("instructors", input.instructorId, input.collegeId, "المحاضر");
  const activeDays = await resolveTargetDays(input.collegeId, input.dayOfWeek);

  const { data: existing, error: readError } = await supabase
    .from("instructor_availability")
    .select("day_of_week, start_time, end_time")
    .eq("college_id", input.collegeId)
    .eq("instructor_id", input.instructorId)
    .eq("availability_type", "unavailable")
    .eq("is_preference", false);
  if (readError) throw new Error(readableWriteError(readError));

  const plan = planBulkUnavailability({
    activeDays,
    dayOfWeek: input.dayOfWeek,
    startTime: input.startTime,
    endTime: input.endTime,
    existing: existing ?? [],
  });
  if (!plan.ok) throw planFailure(plan);

  if (plan.daysToCreate.length > 0) {
    const rows = plan.daysToCreate.map((day) => ({
      college_id: input.collegeId,
      instructor_id: input.instructorId,
      day_of_week: day,
      start_time: input.startTime,
      end_time: input.endTime,
      availability_type: "unavailable",
      is_preference: false,
      notes: input.notes ?? null,
    }));
    // Single statement ⇒ all-or-nothing for this batch.
    const { data: inserted, error: insertError } = await supabase
      .from("instructor_availability")
      .insert(rows)
      .select("id");
    if (insertError) throw new Error(availabilityWriteMessage(insertError));
    if ((inserted?.length ?? 0) !== rows.length) {
      throw new Error(
        "تعذّر تأكيد حفظ جميع الأيام المطلوبة؛ أعد تحميل البيانات والتحقق قبل إعادة المحاولة.",
      );
    }
    await logAudit({
      action: "create",
      entity: "instructor_unavailability",
      collegeId: input.collegeId,
      details: {
        instructor_id: input.instructorId,
        days: plan.daysToCreate,
        start_time: input.startTime,
        end_time: input.endTime,
        path: "direct_fallback",
      },
    });
  }

  return planToResult(plan, input.collegeId, "instructor");
}

async function roomUnavailabilityFallback(input: {
  collegeId: string;
  roomId: string;
  startTime: string;
  endTime: string;
  reason?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  dayOfWeek: number | null;
}): Promise<BulkAvailabilityResult> {
  await assertResourceInCollege("rooms", input.roomId, input.collegeId, "القاعة");
  const activeDays = await resolveTargetDays(input.collegeId, input.dayOfWeek);

  // start_date/end_date are part of the duplicate key, and null weekday/time rows
  // are whole-day closures that must not be dropped from the comparison.
  const { data: existing, error: readError } = await supabase
    .from("room_unavailability")
    .select("day_of_week, start_time, end_time, start_date, end_date")
    .eq("college_id", input.collegeId)
    .eq("room_id", input.roomId);
  if (readError) throw new Error(readableWriteError(readError));

  const plan = planBulkUnavailability({
    activeDays,
    dayOfWeek: input.dayOfWeek,
    startTime: input.startTime,
    endTime: input.endTime,
    compareDates: true,
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    existing: existing ?? [],
  });
  if (!plan.ok) throw planFailure(plan);

  if (plan.daysToCreate.length > 0) {
    const rows = plan.daysToCreate.map((day) => ({
      college_id: input.collegeId,
      room_id: input.roomId,
      day_of_week: day,
      start_time: input.startTime,
      end_time: input.endTime,
      start_date: input.startDate || null,
      end_date: input.endDate || null,
      reason: input.reason ?? null,
    }));
    const { data: inserted, error: insertError } = await supabase
      .from("room_unavailability")
      .insert(rows)
      .select("id");
    if (insertError) throw new Error(availabilityWriteMessage(insertError));
    if ((inserted?.length ?? 0) !== rows.length) {
      throw new Error(
        "تعذّر تأكيد حفظ جميع الأيام المطلوبة؛ أعد تحميل البيانات والتحقق قبل إعادة المحاولة.",
      );
    }
    await logAudit({
      action: "create",
      entity: "room_unavailability",
      collegeId: input.collegeId,
      details: {
        room_id: input.roomId,
        days: plan.daysToCreate,
        start_time: input.startTime,
        end_time: input.endTime,
        start_date: input.startDate || null,
        end_date: input.endDate || null,
        path: "direct_fallback",
      },
    });
  }

  return planToResult(plan, input.collegeId, "room");
}

/** p_day_of_week null → all active working days (server resolves). Always HARD unavailable. */
export async function upsertInstructorUnavailabilityBulk(input: {
  collegeId: string;
  instructorId: string;
  startTime: string;
  endTime: string;
  notes?: string | null;
  dayOfWeek: number | null;
}): Promise<BulkAvailabilityResult> {
  if (!input.collegeId) throw new Error("اختر كلّية أولاً.");
  const { data, error } = await supabase.rpc(
    "upsert_instructor_unavailability_for_active_days" as never,
    {
      p_instructor_id: input.instructorId,
      p_start_time: input.startTime,
      p_end_time: input.endTime,
      p_notes: input.notes ?? null,
      p_day_of_week: input.dayOfWeek,
    } as never,
  );
  if (error) {
    if (isAmbiguousRpcError(error)) {
      throw new Error(`${AMBIGUOUS_RPC_HINT_AR} (${readableWriteError(error)})`);
    }
    if (!isMissingRpcError(error)) throw new Error(availabilityWriteMessage(error));
    return instructorUnavailabilityFallback(input);
  }
  return asResult(data);
}

export async function upsertRoomUnavailabilityBulk(input: {
  collegeId: string;
  roomId: string;
  startTime: string;
  endTime: string;
  reason?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  dayOfWeek: number | null;
}): Promise<BulkAvailabilityResult> {
  if (!input.collegeId) throw new Error("اختر كلّية أولاً.");
  const { data, error } = await supabase.rpc(
    "upsert_room_unavailability_for_active_days" as never,
    {
      p_room_id: input.roomId,
      p_start_time: input.startTime,
      p_end_time: input.endTime,
      p_reason: input.reason ?? null,
      p_start_date: input.startDate || null,
      p_end_date: input.endDate || null,
      p_day_of_week: input.dayOfWeek,
    } as never,
  );
  if (error) {
    if (isAmbiguousRpcError(error)) {
      throw new Error(`${AMBIGUOUS_RPC_HINT_AR} (${readableWriteError(error)})`);
    }
    if (!isMissingRpcError(error)) throw new Error(availabilityWriteMessage(error));
    return roomUnavailabilityFallback(input);
  }
  return asResult(data);
}

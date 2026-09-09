import { supabase } from "@/integrations/supabase/client";
import { logAudit } from "@/lib/audit";
import type { BulkAvailabilityResult } from "./active-days";
import { resolveWorkingDays, DEFAULT_WORKING_DAYS, planBulkUnavailability } from "./active-days";
import { isMissingRpcError, readableWriteError } from "./errors";

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
 * LAUNCH-CLOSURE-01
 * The bulk RPCs are defined in a SOURCE-ONLY migration that is NOT applied on the
 * live database, so every save failed with a PostgREST "function not found" error
 * (surfaced as "[object Object]") and nothing was persisted.
 *
 * Behaviour now: prefer the RPC (atomic, server-side). If — and only if — the RPC
 * is absent from the server, fall back to an equivalent direct write that:
 *   - resolves target days from the same operational calendar,
 *   - pre-validates EVERY target day before any DML (overlap ⇒ reject all),
 *   - inserts all rows in a single statement (no partial application),
 *   - relies on the SAME authorization: RLS `can_manage_college(auth.uid(), college_id)`.
 * No service role, no SECURITY DEFINER, no weakened guard, no college crossing.
 */
function overlapError(dayLabelSource: number): Error {
  return new Error(`unavailability_overlap: day=${dayLabelSource}`);
}

async function resolveTargetDays(collegeId: string, dayOfWeek: number | null): Promise<number[]> {
  if (dayOfWeek !== null) return [dayOfWeek];
  return fetchCollegeWorkingDays(collegeId);
}

function planToResult(
  plan: Extract<ReturnType<typeof planBulkUnavailability>, { ok: true }>,
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
  if (!plan.ok) {
    if (plan.reason === "overlap") throw overlapError(plan.conflictDay);
    throw new Error("invalid_time_range");
  }

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
    // Single statement ⇒ all-or-nothing.
    const { error: insertError } = await supabase.from("instructor_availability").insert(rows);
    if (insertError) throw new Error(readableWriteError(insertError));
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
  const activeDays = await resolveTargetDays(input.collegeId, input.dayOfWeek);

  const { data: existing, error: readError } = await supabase
    .from("room_unavailability")
    .select("day_of_week, start_time, end_time")
    .eq("college_id", input.collegeId)
    .eq("room_id", input.roomId);
  if (readError) throw new Error(readableWriteError(readError));

  const comparable = (existing ?? [])
    .filter((r) => r.day_of_week !== null && r.start_time !== null && r.end_time !== null)
    .map((r) => ({
      day_of_week: r.day_of_week as number,
      start_time: r.start_time as string,
      end_time: r.end_time as string,
    }));

  const plan = planBulkUnavailability({
    activeDays,
    dayOfWeek: input.dayOfWeek,
    startTime: input.startTime,
    endTime: input.endTime,
    existing: comparable,
  });
  if (!plan.ok) {
    if (plan.reason === "overlap") throw overlapError(plan.conflictDay);
    throw new Error("invalid_time_range");
  }

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
    const { error: insertError } = await supabase.from("room_unavailability").insert(rows);
    if (insertError) throw new Error(readableWriteError(insertError));
    await logAudit({
      action: "create",
      entity: "room_unavailability",
      collegeId: input.collegeId,
      details: {
        room_id: input.roomId,
        days: plan.daysToCreate,
        start_time: input.startTime,
        end_time: input.endTime,
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
    if (!isMissingRpcError(error)) throw new Error(readableWriteError(error));
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
    if (!isMissingRpcError(error)) throw new Error(readableWriteError(error));
    return roomUnavailabilityFallback(input);
  }
  return asResult(data);
}

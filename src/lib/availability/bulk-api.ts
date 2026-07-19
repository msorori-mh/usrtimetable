import { supabase } from "@/integrations/supabase/client";
import type { BulkAvailabilityResult } from "./active-days";
import { resolveWorkingDays, DEFAULT_WORKING_DAYS } from "./active-days";

/** Active working days from operational calendar (أيام وفترات الدوام / scheduling_settings). */
export async function fetchCollegeWorkingDays(collegeId: string): Promise<number[]> {
  const { data, error } = await supabase
    .from("scheduling_settings")
    .select("working_days")
    .eq("college_id", collegeId)
    .maybeSingle();
  if (error) throw error;
  return resolveWorkingDays(data?.working_days ?? DEFAULT_WORKING_DAYS);
}

function asResult(data: unknown): BulkAvailabilityResult {
  const r = (data ?? {}) as BulkAvailabilityResult;
  if (r.status !== "ok") {
    throw new Error("Unavailability bulk operation did not return ok");
  }
  return r;
}

/** p_day_of_week null → all active working days (server resolves). Always HARD unavailable. */
export async function upsertInstructorUnavailabilityBulk(input: {
  instructorId: string;
  startTime: string;
  endTime: string;
  notes?: string | null;
  dayOfWeek: number | null;
}): Promise<BulkAvailabilityResult> {
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
  if (error) throw error;
  return asResult(data);
}

export async function upsertRoomUnavailabilityBulk(input: {
  roomId: string;
  startTime: string;
  endTime: string;
  reason?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  dayOfWeek: number | null;
}): Promise<BulkAvailabilityResult> {
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
  if (error) throw error;
  return asResult(data);
}

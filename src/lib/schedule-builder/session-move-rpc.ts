/**
 * Schedule Builder session-move RPC client (validate + save).
 * No direct table updates — all writes go through move_or_reschedule_schedule_session.
 */
import { supabase } from "@/integrations/supabase/client";
import type { PendingScheduleSessionChange } from "@/lib/schedule-builder/pending-change";
import { normalizeTimeHHMM } from "@/lib/schedule-builder/pending-change";
import {
  conflictMessageAr,
  enrichConflictMessages,
} from "@/lib/schedule-builder/conflict-code-messages";

export type SessionMoveConflict = {
  code: string;
  severity?: string;
  message_ar?: string;
  message_en?: string;
  schedule_session_id?: string | null;
  related_session_id?: string | null;
  approved_exception?: boolean;
  exception_id?: string | null;
  exception_reason?: string | null;
  metadata?: Record<string, unknown>;
};

export type ValidateSessionMoveResult = {
  valid: boolean;
  blocking_conflicts: SessionMoveConflict[];
  warnings: SessionMoveConflict[];
  approved_exceptions: SessionMoveConflict[];
  stale: boolean;
  normalized_proposal: {
    day_of_week: number;
    start_time: string;
    end_time: string;
    room_id: string | null;
  } | null;
  code?: string | null;
  message_ar?: string | null;
};

export type SaveSessionMoveResult = {
  ok: boolean;
  code?: string | null;
  stale: boolean;
  message_ar?: string | null;
  blocking_conflicts: SessionMoveConflict[];
  warnings: SessionMoveConflict[];
  approved_exceptions: SessionMoveConflict[];
  session?: {
    id?: string;
    day_of_week?: number;
    start_time?: string;
    end_time?: string;
    room_id?: string | null;
    updated_at?: string;
  } | null;
};

function asConflictArray(value: unknown): SessionMoveConflict[] {
  if (!Array.isArray(value)) return [];
  return (value as SessionMoveConflict[]).map((c) => enrichConflictMessages(c));
}

function resolveRpcMessageAr(
  code: string | null | undefined,
  fallback?: string | null,
): string | null {
  if (code) return conflictMessageAr(code);
  return fallback ?? null;
}

function toTimeParam(value: string): string {
  const t = normalizeTimeHHMM(value);
  return t.length === 5 ? `${t}:00` : t;
}

export function canSaveAfterValidation(result: ValidateSessionMoveResult | null): boolean {
  if (!result) return false;
  if (result.stale) return false;
  if (!result.valid) return false;
  if (result.blocking_conflicts.length > 0) return false;
  if (result.warnings.length > 0) return false;
  return true;
}

export async function validateScheduleSessionMove(
  pending: PendingScheduleSessionChange,
): Promise<ValidateSessionMoveResult> {
  const { data, error } = await supabase.rpc("validate_schedule_session_move", {
    p_session_id: pending.sessionId,
    p_expected_updated_at: pending.expectedUpdatedAt,
    p_target_day_of_week: pending.proposed.day_of_week,
    p_target_start_time: toTimeParam(pending.proposed.start_time),
    p_target_end_time: toTimeParam(pending.proposed.end_time),
    p_target_room_id: pending.proposed.room_id,
  } as never);

  if (error) {
    return {
      valid: false,
      blocking_conflicts: [],
      warnings: [],
      approved_exceptions: [],
      stale: false,
      normalized_proposal: null,
      code: "RPC_ERROR",
      message_ar: error.message || "فشل فحص التعارضات.",
    };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const code = (row.code as string | null | undefined) ?? null;
  return {
    valid: !!row.valid,
    blocking_conflicts: asConflictArray(row.blocking_conflicts),
    warnings: asConflictArray(row.warnings),
    approved_exceptions: asConflictArray(row.approved_exceptions),
    stale: !!row.stale,
    normalized_proposal:
      (row.normalized_proposal as ValidateSessionMoveResult["normalized_proposal"]) ?? null,
    code,
    message_ar: resolveRpcMessageAr(code, row.message_ar as string | null | undefined),
  };
}

export async function moveOrRescheduleScheduleSession(
  pending: PendingScheduleSessionChange,
): Promise<SaveSessionMoveResult> {
  const { data, error } = await supabase.rpc("move_or_reschedule_schedule_session", {
    p_session_id: pending.sessionId,
    p_expected_updated_at: pending.expectedUpdatedAt,
    p_target_day_of_week: pending.proposed.day_of_week,
    p_target_start_time: toTimeParam(pending.proposed.start_time),
    p_target_end_time: toTimeParam(pending.proposed.end_time),
    p_target_room_id: pending.proposed.room_id,
    p_change_reason: pending.changeReason || null,
  } as never);

  if (error) {
    return {
      ok: false,
      code: "RPC_ERROR",
      stale: false,
      message_ar: error.message || "فشل حفظ التغيير.",
      blocking_conflicts: [],
      warnings: [],
      approved_exceptions: [],
      session: null,
    };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const code = (row.code as string | null | undefined) ?? null;
  return {
    ok: !!row.ok,
    code,
    stale: !!row.stale,
    message_ar: resolveRpcMessageAr(code, row.message_ar as string | null | undefined),
    blocking_conflicts: asConflictArray(row.blocking_conflicts),
    warnings: asConflictArray(row.warnings),
    approved_exceptions: asConflictArray(row.approved_exceptions),
    session: (row.session as SaveSessionMoveResult["session"]) ?? null,
  };
}
